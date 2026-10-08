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
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# auto_error=False so a missing header arrives as None: FastAPI's default would
# answer 403, and the correct answer for "no credentials" is 401.
_bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}
_AUDIENCE = "authenticated"
OPS_ROLE = "ops"


def _project_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


def _dev_bypass_user_id() -> str | None:
    if os.getenv("ENV", "").strip().lower() != "development":
        return None
    return os.getenv("DEV_AUTH_BYPASS_USER_ID", "").strip() or None


def _role_claim_path() -> str:
    """Dotted path to the platform role inside the access token.

    Supabase puts ``role: "authenticated"`` at the top level (the Postgres role)
    and copies signup metadata into ``user_metadata``, which the user can rewrite
    with ``auth.updateUser``. Neither may be used here; the default points at
    ``app_metadata``, which only the service role or an access-token hook can set.
    """
    return os.getenv("GEO_ROLE_CLAIM", "app_metadata.role").strip()


def _roles_enforced() -> bool:
    """Whether ops-only routes check the role claim.

    On by default. A project whose access tokens do not yet carry the role
    (no custom access-token hook) sets GEO_ENFORCE_ROLES=false so operators are
    not locked out of hotspots and stats while the hook is being enabled.
    """
    return os.getenv("GEO_ENFORCE_ROLES", "true").strip().lower() not in {"false", "0", "no"}


def _claim(claims: dict, path: str):
    value = claims
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


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
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Verify the bearer token and return the Supabase user id.

    Raises 503 when SUPABASE_URL is unset, so a misconfigured deploy refuses
    requests instead of serving them unauthenticated.

    Local development escape hatch: setting DEV_AUTH_BYPASS_USER_ID skips
    verification and returns that id. Honoured only when ENV is exactly
    "development", so an unset or mistyped ENV keeps authentication on.

    The verified claims are kept on ``request.state.claims`` for role checks.
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
    request.state.claims = claims
    return subject


def require_ops(request: Request, user: str = Depends(require_user)) -> str:
    """Admit only callers whose token carries the ops role.

    A token without the claim is refused, not treated as a default role, so a
    project that has not yet configured the claim locks these routes rather
    than opening them. The dev bypass is treated as ops.
    """
    if _dev_bypass_user_id() or not _roles_enforced():
        return user
    role = _claim(getattr(request.state, "claims", {}), _role_claim_path())
    if role != OPS_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This route requires the ops role.",
        )
    return user
