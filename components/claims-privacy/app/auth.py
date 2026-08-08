"""Supabase Auth (GoTrue) bearer-token verification.

The mobile app signs in with Supabase and sends the resulting access token as
``Authorization: Bearer <jwt>``. Tokens are ES256-signed; the public half is
published at the project's JWKS endpoint, so verification needs no shared
secret — only the project URL.

``current_user_id`` is the dependency endpoints use. It returns the Supabase
user id (the token's ``sub`` claim), which is the only identity the API trusts.
Anything the client sends in a body or query string is claimant-supplied data,
not identity.
"""

import logging
from functools import lru_cache
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# auto_error=False so a missing header reaches us as None: FastAPI's default
# would answer 403, and the correct answer for "no credentials" is 401.
_bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}


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


def current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> str:
    """Verify the bearer token and return the Supabase user id.

    Raises 503 when the service has no SUPABASE_URL, so a misconfigured deploy
    refuses requests instead of serving them unauthenticated.
    """
    if not settings.auth_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_URL is not configured.",
        )

    if credentials is None or not credentials.credentials.strip():
        raise _unauthenticated("Missing bearer token.")

    try:
        signing_key = _jwk_client(settings.jwks_url).get_signing_key_from_jwt(
            credentials.credentials
        )
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256"],
            audience=settings.supabase_jwt_audience,
            issuer=settings.jwt_issuer,
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
