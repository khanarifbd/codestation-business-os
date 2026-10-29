from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CodeStation Business OS API"
    app_version: str = "0.5.0"
    environment: str = "development"
    database_url: str = (
        "postgresql+psycopg://business_os:change_me@localhost:5432/"
        "codestation_business_os"
    )
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_recycle_seconds: int = 1800
    cors_origins: str = "http://localhost:3000"
    jwt_secret_key: str = "development-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=30, ge=1, le=1440)
    refresh_token_expire_minutes: int = Field(default=240, ge=5, le=10080)
    session_idle_timeout_minutes: int = Field(default=240, ge=5, le=10080)
    email_verification_token_expire_hours: int = 24
    password_reset_token_expire_minutes: int = 30
    passkey_challenge_expire_minutes: int = 5
    public_app_url: str = "http://localhost:3000"
    public_api_url: str = "http://localhost:8000"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "no-reply@codestationai.com"
    smtp_from_name: str = "CodeStation AI Business OS"
    smtp_use_starttls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 10
    google_oauth_client_id: str = ""
    super_admin_email: str = ""
    super_admin_password: str = ""
    super_admin_name: str = "CodeStation AI Super Admin"
    local_storage_path: str = "./data/uploads"
    max_document_upload_mb: int = 20
    project_credential_encryption_key: str = "development-only-project-credential-key"
    stripe_connect_client_id_test: str = ""
    stripe_connect_client_id_live: str = ""
    stripe_secret_key_test: str = ""
    stripe_secret_key_live: str = ""
    stripe_oauth_redirect_uri: str = ""
    payment_gateway_encryption_key: str = ""
    stripe_live_collection_enabled: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    @model_validator(mode="after")
    def require_safe_deployed_jwt_key(self) -> "Settings":
        """Fail closed for known unsafe deployment keys without rotating them.

        Length is only a minimum safety check, not proof of entropy. Operators
        must generate and retain a cryptographically random signing secret.
        Explicit local development/test configuration remains compatible.
        """
        if self.environment.lower().strip() not in {"production", "staging"}:
            return self
        key = self.jwt_secret_key.strip()
        minimum_bytes = {"HS256": 32, "HS384": 48, "HS512": 64}.get(self.jwt_algorithm, 32)
        if (
            not key
            or key.lower().startswith(("development-only", "replace_with_"))
            or len(key.encode("utf-8")) < minimum_bytes
        ):
            raise ValueError(
                "Production/staging JWT_SECRET_KEY must be a securely generated "
                f"non-placeholder secret of at least {minimum_bytes} bytes"
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host.strip() and self.smtp_from_email.strip())

    @property
    def require_account_email_delivery(self) -> bool:
        return self.environment.lower().strip() in {"staging", "production"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
