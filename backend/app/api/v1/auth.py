from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.core.roles import SYSTEM_ROLE_SUPER_ADMIN
from app.core.security import (
    create_access_token,
    create_email_verification_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token_claims,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    AuthActionAccepted,
    EmailVerificationRequest,
    EmailVerificationResendRequest,
    ForgotPasswordRequest,
    GoogleLoginRequest,
    LoginRequest,
    RefreshTokenRequest,
    ResetPasswordRequest,
    SignUpRequest,
    TokenPair,
    UserRead,
)
from app.services.account_email import (
    AccountEmailDeliveryError,
    account_email_delivery_available,
    send_email_verification,
    send_password_reset,
)
from app.services.activity_log import record_activity
from app.services.auth_rate_limit import enforce_auth_rate_limit
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityError,
    GoogleIdentityUnavailableError,
    verify_google_id_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _token_pair(user: User) -> TokenPair:
    version = int(user.auth_token_version or 0)
    return TokenPair(
        access_token=create_access_token(user.id, version),
        refresh_token=create_refresh_token(user.id, version),
        user=UserRead.model_validate(user),
    )


def _email_matches(user: User, token_email: str | None) -> bool:
    return bool(token_email and token_email == user.email.lower().strip())


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


@router.post("/signup", response_model=AuthActionAccepted, status_code=status.HTTP_201_CREATED)
def signup(payload: SignUpRequest, request: Request, db: DbSession) -> AuthActionAccepted:
    email = payload.email.lower().strip()
    enforce_auth_rate_limit(
        request,
        action="signup",
        limit=5,
        window_seconds=3600,
        identity=email,
    )
    if not account_email_delivery_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account email delivery is not configured for this deployment",
        )

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
        is_verified=False,
    )
    db.add(user)
    db.flush()
    verification_token = create_email_verification_token(
        user.id,
        user.email,
        int(user.auth_token_version or 0),
    )
    try:
        delivered = send_email_verification(
            email=user.email,
            full_name=user.full_name,
            token=verification_token,
        )
    except AccountEmailDeliveryError as exc:
        db.rollback()
        record_activity(
            db,
            action="auth.signup.email_failed",
            scope="auth",
            actor_type="anonymous",
            outcome="failure",
            message="Signup email verification delivery failed",
            metadata={"email": email},
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to send the verification email. Please try again later.",
        ) from exc

    record_activity(
        db,
        action="auth.user.created",
        scope="auth",
        actor_user_id=user.id,
        actor_type="user",
        entity_type="user",
        entity_id=user.id,
        message="Password user account created pending email verification",
        after={
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "system_role": user.system_role,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "provider": "password",
        },
        metadata={"verification_email_delivered": delivered},
        request=request,
    )
    db.commit()
    return AuthActionAccepted(
        message="Account created. Check your email and verify the address before signing in."
    )


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenPair:
    email = payload.email.lower().strip()
    enforce_auth_rate_limit(
        request,
        action="login",
        limit=10,
        window_seconds=600,
        identity=email,
    )
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
    if not user.is_verified:
        record_activity(
            db,
            action="auth.login.blocked",
            scope="auth",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            outcome="failure",
            message="Password login blocked pending email verification",
            metadata={"email": email, "provider": "password", "reason": "email_unverified"},
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email address before signing in. You can resend the verification email from the sign-in page.",
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
    enforce_auth_rate_limit(request, action="google_login", limit=30, window_seconds=600)
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
def refresh(payload: RefreshTokenRequest, request: Request, db: DbSession) -> TokenPair:
    enforce_auth_rate_limit(request, action="refresh", limit=120, window_seconds=600)
    try:
        claims = decode_token_claims(payload.refresh_token, "refresh")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    user = db.get(User, claims.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is inactive or no longer exists",
        )
    if claims.token_version != int(user.auth_token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This session has been revoked. Sign in again.",
        )
    return _token_pair(user)


@router.post("/verification/resend", response_model=AuthActionAccepted, status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    payload: EmailVerificationResendRequest,
    request: Request,
    db: DbSession,
) -> AuthActionAccepted:
    email = payload.email.lower().strip()
    enforce_auth_rate_limit(
        request,
        action="verification_resend",
        limit=5,
        window_seconds=3600,
        identity=email,
    )
    if not account_email_delivery_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account email delivery is not configured for this deployment",
        )

    user = db.scalar(select(User).where(User.email == email))
    delivered = False
    if user is not None and user.is_active and user.password_hash is not None and not user.is_verified:
        token = create_email_verification_token(
            user.id,
            user.email,
            int(user.auth_token_version or 0),
        )
        try:
            delivered = send_email_verification(
                email=user.email,
                full_name=user.full_name,
                token=token,
            )
        except AccountEmailDeliveryError:
            record_activity(
                db,
                action="auth.verification.email_failed",
                scope="auth",
                actor_type="anonymous",
                entity_type="user",
                entity_id=user.id,
                outcome="failure",
                message="Email verification resend delivery failed",
                request=request,
            )
            db.commit()
            return AuthActionAccepted(
                message="If the account needs verification, a verification email will be sent."
            )

    record_activity(
        db,
        action="auth.verification.requested",
        scope="auth",
        actor_type="anonymous",
        entity_type="user" if user is not None else None,
        entity_id=user.id if user is not None else None,
        message="Email verification requested",
        metadata={"delivered": delivered},
        request=request,
    )
    db.commit()
    return AuthActionAccepted(
        message="If the account needs verification, a verification email will be sent."
    )


@router.post("/verify-email", response_model=AuthActionAccepted)
def verify_email(
    payload: EmailVerificationRequest,
    request: Request,
    db: DbSession,
) -> AuthActionAccepted:
    enforce_auth_rate_limit(request, action="verify_email", limit=20, window_seconds=3600)
    try:
        claims = decode_token_claims(payload.token, "email_verify")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = db.get(User, claims.user_id)
    if (
        user is None
        or not user.is_active
        or claims.token_version != int(user.auth_token_version or 0)
        or not _email_matches(user, claims.email)
    ):
        raise HTTPException(status_code=400, detail="This verification link is invalid or expired")

    if not user.is_verified:
        user.is_verified = True
        record_activity(
            db,
            action="auth.email.verified",
            scope="auth",
            actor_user_id=user.id,
            actor_type="user",
            entity_type="user",
            entity_id=user.id,
            message="Password account email verified",
            request=request,
        )
        db.commit()
    return AuthActionAccepted(message="Email verified. You can now sign in.")


@router.post("/forgot-password", response_model=AuthActionAccepted, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: DbSession,
) -> AuthActionAccepted:
    email = payload.email.lower().strip()
    enforce_auth_rate_limit(
        request,
        action="forgot_password",
        limit=5,
        window_seconds=3600,
        identity=email,
    )
    if not account_email_delivery_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account email delivery is not configured for this deployment",
        )

    user = db.scalar(select(User).where(User.email == email))
    delivered = False
    if user is not None and user.is_active and user.password_hash is not None:
        token = create_password_reset_token(
            user.id,
            user.email,
            int(user.auth_token_version or 0),
        )
        try:
            delivered = send_password_reset(
                email=user.email,
                full_name=user.full_name,
                token=token,
            )
        except AccountEmailDeliveryError:
            record_activity(
                db,
                action="auth.password_reset.email_failed",
                scope="auth",
                actor_type="anonymous",
                entity_type="user",
                entity_id=user.id,
                outcome="failure",
                message="Password reset email delivery failed",
                request=request,
            )
            db.commit()
            return AuthActionAccepted(
                message="If an eligible account exists, password reset instructions will be sent."
            )

    record_activity(
        db,
        action="auth.password_reset.requested",
        scope="auth",
        actor_type="anonymous",
        entity_type="user" if user is not None else None,
        entity_id=user.id if user is not None else None,
        message="Password reset requested",
        metadata={"delivered": delivered},
        request=request,
    )
    db.commit()
    return AuthActionAccepted(
        message="If an eligible account exists, password reset instructions will be sent."
    )


@router.post("/reset-password", response_model=AuthActionAccepted)
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    db: DbSession,
) -> AuthActionAccepted:
    enforce_auth_rate_limit(request, action="reset_password", limit=10, window_seconds=3600)
    try:
        claims = decode_token_claims(payload.token, "password_reset")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user = db.get(User, claims.user_id)
    if (
        user is None
        or not user.is_active
        or user.password_hash is None
        or claims.token_version != int(user.auth_token_version or 0)
        or not _email_matches(user, claims.email)
    ):
        raise HTTPException(status_code=400, detail="This password reset link is invalid or expired")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="New password must be different from the current password")

    previous_version = int(user.auth_token_version or 0)
    user.password_hash = hash_password(payload.new_password)
    user.is_verified = True
    user.auth_token_version = previous_version + 1
    record_activity(
        db,
        action="auth.password_reset.completed",
        scope="auth",
        actor_user_id=user.id,
        actor_type="user",
        entity_type="user",
        entity_id=user.id,
        message="User reset their password; existing sessions were revoked",
        metadata={
            "sessions_invalidated": True,
            "token_version_before": previous_version,
            "token_version_after": user.auth_token_version,
        },
        request=request,
    )
    db.commit()
    return AuthActionAccepted(message="Password reset successfully. Sign in with your new password.")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    previous_version = int(current_user.auth_token_version or 0)
    current_user.auth_token_version = previous_version + 1
    record_activity(
        db,
        action="auth.logout",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User signed out and revoked existing sessions",
        metadata={
            "sessions_invalidated": True,
            "token_version_before": previous_version,
            "token_version_after": current_user.auth_token_version,
        },
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
