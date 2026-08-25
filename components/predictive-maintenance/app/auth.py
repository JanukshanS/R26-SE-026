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

# Tolerance for clock skew between this machine and Supabase's auth servers,
# applied to the iat/exp/nbf checks below.
#
# WHY THIS EXISTS: PyJWT's default leeway is zero, so ANY skew — even a few
# seconds — makes a freshly issued, entirely valid token look "not yet valid"
# (iat in the "future") or already expired. This is not a hypothetical: it
# surfaced on the dev machine running this service, whose clock is
# unsynchronized and drifting off the local CMOS clock (`w32tm /query /status`
# reports "Leap Indicator: 3 (not synchronized)", "Source: Local CMOS Clock").
# Every request failed with "Invalid or expired token" despite a correct
# token, correct signature, and correct audience — the only thing wrong was
# the verifying machine's idea of what time it is.
#
# 120s is generous next to a typical NTP-synced server's sub-second drift, but
# still tiny next to the token's own hour-long lifetime, so it costs nothing
# against a genuinely expired or forged token while making verification
# robust on a machine whose clock cannot be trusted.
_CLOCK_LEEWAY_SEC = int(os.getenv("JWT_CLOCK_LEEWAY_SEC", "120"))


def _project_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


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
    """
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
            leeway=_CLOCK_LEEWAY_SEC,
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


def _decode_token(credentials: HTTPAuthorizationCredentials) -> dict:
    """Return verified JWT claims for the bearer token."""
    base = _project_url()
    if not base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_URL is not configured.",
        )
    try:
        signing_key = _jwk_client(
            f"{base}/auth/v1/.well-known/jwks.json"
        ).get_signing_key_from_jwt(credentials.credentials)
        return jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256"],
            audience=_AUDIENCE,
            issuer=f"{base}/auth/v1",
            options={"require": ["exp", "sub"]},
            leeway=_CLOCK_LEEWAY_SEC,
        )
    except jwt.PyJWTError as exc:
        logger.warning("Bearer token rejected: %s", exc)
        raise _unauthenticated("Invalid or expired token.") from exc


def _fetch_profile_role(user_id: str, token: str) -> str | None:
    """Read the caller's role from Supabase profiles via REST + caller JWT."""
    import httpx

    base = _project_url()
    anon = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not base or not anon:
        return None
    url = f"{base}/rest/v1/profiles"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": anon,
        "Accept": "application/json",
    }
    params = {"id": f"eq.{user_id}", "select": "role"}
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(url, headers=headers, params=params)
        if response.status_code != 200:
            logger.warning("Profile role lookup failed: %s", response.status_code)
            return None
        rows = response.json()
        if isinstance(rows, list) and rows:
            role = rows[0].get("role")
            return role if isinstance(role, str) else None
    except httpx.HTTPError as exc:
        logger.warning("Profile role lookup error: %s", exc)
    return None


def require_ops(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Verify bearer token and require an ops account for admin catalogue writes."""
    if credentials is None or not credentials.credentials.strip():
        raise _unauthenticated("Missing bearer token.")

    claims = _decode_token(credentials)
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise _unauthenticated("Token has no subject.")

    role = _fetch_profile_role(subject, credentials.credentials.strip())
    if role == "ops":
        return subject

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Ops role required for this action.",
    )
