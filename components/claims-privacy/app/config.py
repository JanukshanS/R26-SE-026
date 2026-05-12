from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Loads from environment and optional `.env` in the backend working directory."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- PostgreSQL (SQLAlchemy / async drivers use this URL) ---
    database_url: Optional[str] = None

    # --- Cloudflare R2 (S3-compatible API) ---
    r2_account_id: Optional[str] = None
    r2_access_key_id: Optional[str] = None
    r2_secret_access_key: Optional[str] = None
    r2_bucket_name: Optional[str] = None
    r2_endpoint_url: Optional[str] = None
    r2_public_base_url: Optional[str] = None
    min_capture_photos: int = 5

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url and self.database_url.strip())

    @property
    def effective_database_url(self) -> Optional[str]:
        """URL for psycopg (libpq). Strips SQLAlchemy driver prefixes like ``+asyncpg``."""
        raw = (self.database_url or "").strip()
        if not raw:
            return None
        for prefix in ("postgresql+asyncpg://", "postgres+asyncpg://"):
            if raw.startswith(prefix):
                return "postgresql://" + raw[len(prefix) :]
        return raw

    @property
    def r2_configured(self) -> bool:
        return bool(
            self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket_name
            and self.r2_endpoint_url
        )


def get_settings() -> Settings:
    return Settings()
