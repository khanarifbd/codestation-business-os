from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    RefreshTokenRequest,
    SignUpRequest,
    TokenPair,
    UserRead,
)
from app.services.activity_log import record_activity

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        user=UserRead.model_validate(user),
    )


@router.post("/signup", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def signup(payload: SignUpRequest, request: Request, db: DbSession) -> TokenPair:
    email = payload.email.lower().strip()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        record_activity(
            db,
            action="auth.signup.rejected",
            scope="auth",
            actor_type="anonymous",
            outcome="failure",
            message="Signup rejected because the email already exists",
            metadata={"email": email},
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    record_activity(
        db,
        action="auth.user.created",
        scope="auth",
        actor_user_id=user.id,
        actor_type="user",
        entity_type="user",
        entity_id=user.id,
        message="User account created",
        after={
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "system_role": user.system_role,
            "is_active": user.is_active,
        },
        request=request,
    )
    db.commit()
    db.refresh(user)
    return _token_pair(user)


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenPair:
    email = payload.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        record_activity(
            db,
            action="auth.login.failed",
            scope="auth",
            actor_user_id=user.id if user is not None else None,
            actor_type="user" if user is not None else "anonymous",
            entity_type="user" if user is not None else None,
            entity_id=user.id if user is not None else None,
            outcome="failure",
            message="Invalid email or password",
            metadata={"email": email},
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.is_active:
        record_activity(
            db,
            action="auth.login.blocked",
            scope="auth",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            outcome="failure",
            message="Login blocked because the account is inactive",
            metadata={"email": email},
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive",
        )

    record_activity(
        db,
        action="auth.login.succeeded",
        scope="auth",
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        message="User signed in",
        request=request,
    )
    db.commit()
    return _token_pair(user)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshTokenRequest, db: DbSession) -> TokenPair:
    try:
        user_id = decode_token(payload.refresh_token, "refresh")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is inactive or no longer exists",
        )
    return _token_pair(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    record_activity(
        db,
        action="auth.logout",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User signed out",
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
