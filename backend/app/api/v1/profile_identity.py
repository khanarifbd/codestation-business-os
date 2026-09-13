from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentUser, DbSession
from app.models.user import User
from app.schemas.profile_identity import SignInIdentitiesRead, UsernameUpdateRequest
from app.services.activity_log import record_activity
from app.services.user_identity import validate_username

router = APIRouter(prefix="/profile/identities", tags=["User Profile"])


def _identity_read(user: User) -> SignInIdentitiesRead:
    return SignInIdentitiesRead(
        email=user.email,
        email_verified=user.is_verified,
        username=user.username,
        google_connected=user.google_subject is not None,
        has_password=user.password_hash is not None,
    )


def _record_username_failure(
    db: DbSession,
    request: Request,
    current_user: CurrentUser,
    *,
    reason: str,
) -> None:
    record_activity(
        db,
        action="auth.username.update_failed",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        outcome="failure",
        message="Username update rejected",
        metadata={"reason": reason},
        request=request,
    )
    db.commit()


@router.get("", response_model=SignInIdentitiesRead)
def get_sign_in_identities(current_user: CurrentUser) -> SignInIdentitiesRead:
    return _identity_read(current_user)


@router.patch("/username", response_model=SignInIdentitiesRead)
def update_username(
    payload: UsernameUpdateRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> SignInIdentitiesRead:
    try:
        username = validate_username(payload.username)
    except ValueError as exc:
        _record_username_failure(
            db,
            request,
            current_user,
            reason="invalid_format",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if username == current_user.username:
        return _identity_read(current_user)

    if username is not None:
        existing_user_id = db.scalar(
            select(User.id).where(
                User.username == username,
                User.id != current_user.id,
            )
        )
        if existing_user_id is not None:
            _record_username_failure(
                db,
                request,
                current_user,
                reason="username_taken",
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This username is already in use",
            )

    previous_username = current_user.username
    current_user.username = username
    record_activity(
        db,
        action="auth.username.updated",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User updated their username login identity",
        before={"username": previous_username},
        after={"username": username},
        metadata={"login_identity_changed": True},
        request=request,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _record_username_failure(
            db,
            request,
            current_user,
            reason="username_conflict",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This username is already in use",
        ) from exc

    db.refresh(current_user)
    return _identity_read(current_user)
