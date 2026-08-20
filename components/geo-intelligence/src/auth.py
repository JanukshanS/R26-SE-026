"""Supabase Auth (GoTrue) bearer-token verification.

Callers send the Supabase access token as ``Authorization: Bearer <jwt>``.
Tokens are ES256-signed and the public half is published at the project's JWKS
endpoint, so verification needs no shared secret — only ``SUPABASE_URL``.

Deliberately self-contained and duplicated in each Python service rather than
shared: the services build from independent Docker contexts, so a shared
package would cost more plumbing than the copy costs maintenance.
"""

import logging
import os
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# auto_error=False so a missing header arrives as None: FastAPI's default would
# answer 403, and the correct answer for "no credentials" is 401.
_bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}
_AUDIENCE = "authenticated"


def _project_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


def _dev_bypass_user_id() -> str | None:
    if os.getenv("ENV", "").strip().lower() == "production":
        return None
    return os.getenv("DEV_AUTH_BYPASS_USER_ID", "").strip() or None


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> PyJWKClient:
    """One client per JWKS URL — it caches the fetched key set for an hour."""
    return PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=3600)


def _unauthenticated(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers=_UNAUTHENTICATED_HEADERS,
    )


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Verify the bearer token and return the Supabase user id.

    Raises 503 when SUPABASE_URL is unset, so a misconfigured deploy refuses
    requests instead of serving them unauthenticated.

    Local development escape hatch: setting DEV_AUTH_BYPASS_USER_ID skips
    verification and returns that id. Ignored when ENV is production, so it
    cannot be switched on by a stray env var in a deploy.
    """
    bypass = _dev_bypass_user_id()
    if bypass:
        return bypass

    base = _project_url()
    if not base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_URL is not configured.",
        )

    if credentials is None or not credentials.credentials.strip():
        raise _unauthenticated("Missing bearer token.")

    try:
        signing_key = _jwk_client(
            f"{base}/auth/v1/.well-known/jwks.json"
        ).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256"],
            audience=_AUDIENCE,
            issuer=f"{base}/auth/v1",
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as exc:
        # Covers both a bad token and an unreachable JWKS endpoint, which the
        # client cannot tell apart. Log the cause so an outage is diagnosable
        # from the container logs rather than looking like bad credentials.
        logger.warning("Bearer token rejected: %s", exc)
        raise _unauthenticated("Invalid or expired token.") from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise _unauthenticated("Token has no subject.")
    return subject
