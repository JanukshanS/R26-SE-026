"""Bearer-token verification.

Signs tokens with a locally generated P-256 key and swaps in a stub JWKS
client, so the real decode path — algorithms, audience, issuer, required
claims — is exercised without any network access to Supabase.
"""

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth as auth_module
from app.auth import current_user_id
from app.config import Settings

PROJECT_URL = "https://testproject.supabase.co"
USER_ID = "22222222-2222-4222-8222-222222222222"

_signing_key = ec.generate_private_key(ec.SECP256R1())


class _StubJWKClient:
    """Stands in for PyJWKClient — serves the public half of _signing_key."""

    def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
        _ = token
        return SimpleNamespace(key=_signing_key.public_key())


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_module, "_jwk_client", lambda url: _StubJWKClient())


def _settings(**overrides: object) -> Settings:
    return Settings(supabase_url=PROJECT_URL, **overrides)  # type: ignore[arg-type]


def _token(key: object = _signing_key, algorithm: str = "ES256", **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": f"{PROJECT_URL}/auth/v1",
        "aud": "authenticated",
        "sub": USER_ID,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm=algorithm)  # type: ignore[arg-type]


def _verify(token: str | None, settings: Settings | None = None) -> str:
    credentials = (
        None if token is None
        else HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    )
    return current_user_id(credentials=credentials, settings=settings or _settings())


def _status_of(token: str | None, settings: Settings | None = None) -> int:
    with pytest.raises(HTTPException) as excinfo:
        _verify(token, settings)
    return excinfo.value.status_code


def test_valid_token_returns_subject() -> None:
    assert _verify(_token()) == USER_ID


def test_missing_credentials_is_401_not_403() -> None:
    with pytest.raises(HTTPException) as excinfo:
        _verify(None)
    assert excinfo.value.status_code == 401
    assert excinfo.value.headers == {"WWW-Authenticate": "Bearer"}


def test_empty_token_is_rejected() -> None:
    assert _status_of("   ") == 401


def test_expired_token_is_rejected() -> None:
    now = int(time.time())
    assert _status_of(_token(exp=now - 1, iat=now - 3600)) == 401


def test_token_from_another_project_is_rejected() -> None:
    assert _status_of(_token(iss="https://evil.supabase.co/auth/v1")) == 401


def test_wrong_audience_is_rejected() -> None:
    assert _status_of(_token(aud="anon")) == 401


def test_token_without_subject_is_rejected() -> None:
    assert _status_of(_token(sub=None)) == 401


def test_symmetrically_forged_token_is_rejected() -> None:
    """Algorithm confusion: an HS256 token must not be accepted for an ES256 key."""
    forged = _token(key="x" * 32, algorithm="HS256")
    assert _status_of(forged) == 401


def test_signature_from_a_different_key_is_rejected() -> None:
    other = ec.generate_private_key(ec.SECP256R1())
    assert _status_of(_token(key=other)) == 401


def test_unconfigured_service_refuses_rather_than_allowing() -> None:
    assert _status_of(_token(), Settings(supabase_url=None)) == 503


def test_derived_urls_tolerate_a_trailing_slash() -> None:
    settings = Settings(supabase_url=f"{PROJECT_URL}/")
    assert settings.jwks_url == f"{PROJECT_URL}/auth/v1/.well-known/jwks.json"
    assert settings.jwt_issuer == f"{PROJECT_URL}/auth/v1"
