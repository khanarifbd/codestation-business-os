from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.core.roles import SYSTEM_ROLE_SUPER_ADMIN
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    GoogleLoginRequest,
    LoginRequest,
    RefreshTokenRequest,
    SignUpRequest,
    TokenPair,
    UserRead,
)
from app.services.activity_log import record_activity
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityError,
    GoogleIdentityUnavailableError,
    verify_google_id_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        user=UserRead.model_validate(user),
    )


def _record_google_failure(
    db: DbSession,
    request: Request,
    *,
    message: str,
    outcome: str = "failure",
    user: User | None = None,
) -> None:
    record_activity(
        db,
        action="auth.google.failed",
        scope="auth",
        actor_user_id=user.id if user is not None else None,
        actor_type="user" if user is not None else "anonymous",
        entity_type="user" if user is not None else None,
        entity_id=user.id if user is not None else None,
        outcome=outcome,
        message=message,
        metadata={"provider": "google"},
        request=request,
    )
    db.commit()


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
            "is_verified": user.is_verified,
            "provider": "password",
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
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
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
            metadata={"email": email, "provider": "password"},
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
            metadata={"email": email, "provider": "password"},
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
        metadata={"provider": "password"},
        request=request,
    )
    db.commit()
    return _token_pair(user)


@router.post("/google", response_model=TokenPair)
def google_login(payload: GoogleLoginRequest, request: Request, db: DbSession) -> TokenPair:
    try:
        identity = verify_google_id_token(payload.credential)
    except GoogleIdentityConfigurationError as exc:
        _record_google_failure(db, request, message="Google sign-in is not configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured for this deployment",
        ) from exc
    except GoogleIdentityUnavailableError as exc:
        _record_google_failure(db, request, message="Google identity verification is unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is temporarily unavailable. Please try again.",
        ) from exc
    except GoogleIdentityError as exc:
        _record_google_failure(db, request, message="Google credential verification failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to verify your Google account",
        ) from exc

    user = db.scalar(select(User).where(User.google_subject == identity.subject))
    linked_now = False
    created_now = False

    if user is None:
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is not None:
            if user.system_role == SYSTEM_ROLE_SUPER_ADMIN:
                _record_google_failure(
                    db,
                    request,
                    message="Google sign-in is disabled for platform super admin accounts",
                    user=user,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Platform super admin accounts must use password sign-in",
                )
            if not user.is_active:
                _record_google_failure(
                    db,
                    request,
                    message="Google login blocked because the account is inactive",
                    user=user,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This account is inactive",
                )
            if user.google_subject and user.google_subject != identity.subject:
                _record_google_failure(
                    db,
                    request,
                    message="Google account does not match the linked identity",
                    user=user,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is already linked to a different Google account",
                )
            if not identity.email_is_google_authoritative:
                _record_google_failure(
                    db,
                    request,
                    message="Existing non-Google-hosted email requires password sign-in before Google linking",
                    user=user,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "This email already has a Business OS account. Sign in with your password. "
                        "For non-Gmail and non-Google-Workspace addresses, Google is not auto-linked."
                    ),
                )
            user.google_subject = identity.subject
            user.is_verified = True
            linked_now = True
            record_activity(
                db,
                action="auth.google.linked",
                scope="auth",
                actor_user_id=user.id,
                entity_type="user",
                entity_id=user.id,
                message="Google identity linked to existing user",
                metadata={"provider": "google", "hosted_domain": identity.hosted_domain},
                request=request,
            )
        else:
            user = User(
                email=identity.email,
                full_name=identity.full_name,
                password_hash=None,
                google_subject=identity.subject,
                is_verified=True,
            )
            db.add(user)
            db.flush()
            created_now = True
            record_activity(
                db,
                action="auth.user.created",
                scope="auth",
                actor_user_id=user.id,
                actor_type="user",
                entity_type="user",
                entity_id=user.id,
                message="User account created with Google",
                after={
                    "id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                    "system_role": user.system_role,
                    "is_active": user.is_active,
                    "is_verified": user.is_verified,
                    "provider": "google",
                },
                request=request,
            )
    else:
        if user.system_role == SYSTEM_ROLE_SUPER_ADMIN:
            _record_google_failure(
                db,
                request,
                message="Google sign-in is disabled for platform super admin accounts",
                user=user,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Platform super admin accounts must use password sign-in",
            )
        if not user.is_active:
            _record_google_failure(
                db,
                request,
                message="Google login blocked because the account is inactive",
                user=user,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is inactive",
            )
        if not user.is_verified:
            user.is_verified = True

    record_activity(
        db,
        action="auth.login.succeeded",
        scope="auth",
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        message="User signed in with Google",
        metadata={
            "provider": "google",
            "linked_now": linked_now,
            "created_now": created_now,
            "hosted_domain": identity.hosted_domain,
        },
        request=request,
    )
    db.commit()
    db.refresh(user)
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
