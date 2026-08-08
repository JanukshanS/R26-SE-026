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

    # --- Supabase Auth (bearer-token verification) ---
    # Project URL only, e.g. https://abcdefgh.supabase.co — the JWKS endpoint
    # publishes the public keys, so no secret is needed to verify tokens.
    supabase_url: Optional[str] = None
    supabase_jwt_audience: str = "authenticated"

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
    def auth_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_url.strip())

    @property
    def _supabase_base(self) -> str:
        return (self.supabase_url or "").strip().rstrip("/")

    @property
    def jwks_url(self) -> str:
        return f"{self._supabase_base}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        return f"{self._supabase_base}/auth/v1"

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
