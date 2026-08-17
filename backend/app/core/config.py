from functools import lru_cache

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
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    google_oauth_client_id: str = ""
    super_admin_email: str = ""
    super_admin_password: str = ""
    super_admin_name: str = "CodeStation AI Super Admin"
    local_storage_path: str = "./data/uploads"
    max_document_upload_mb: int = 20
    project_credential_encryption_key: str = "development-only-project-credential-key"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
