"""Access control: which routes need a token, which tokens pass, which roles.

Tokens are signed with a local ES256 key and the JWKS client is fed that key
instead of fetching it, so the real verification path in src/auth.py runs
offline.
"""
from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jwt import PyJWKClient
from jwt.algorithms import ECAlgorithm

from src import auth
from src.api import app

PROJECT = "https://testproject.supabase.co"
ISSUER = f"{PROJECT}/auth/v1"
KID = "test-key"

SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())
FOREIGN_KEY = ec.generate_private_key(ec.SECP256R1())

SCORE_BODY = {
    "latitude": 6.9271,
    "longitude": 79.8612,
    "road_type": "primary",
    "total_lanes": 2,
    "lanes_blocked": 1,
    "incident_type": "breakdown",
    "hour": 8,
    "day_of_week": 0,
}

ALL_DATA_ROUTES = [
    ("post", "/v1/score", SCORE_BODY),
    ("post", "/v1/score/uncertainty", SCORE_BODY),
    ("post", "/v1/score/timeline", SCORE_BODY),
    ("get", "/v1/hotspots", None),
    ("get", "/v1/stats", None),
]
OPS_ROUTES = [route for route in ALL_DATA_ROUTES if route[1] != "/v1/score"]


def _jwks_client(url: str) -> PyJWKClient:
    jwk = ECAlgorithm.to_jwk(SIGNING_KEY.public_key(), as_dict=True)
    client = PyJWKClient(url)
    client.fetch_data = lambda: {"keys": [{**jwk, "kid": KID, "alg": "ES256", "use": "sig"}]}
    return client


def token(key=SIGNING_KEY, algorithm: str = "ES256", **overrides) -> str:
    claims = {
        "sub": "user-1",
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 600,
        "role": "authenticated",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": KID})


def ops_token(**overrides) -> str:
    return token(app_metadata={"role": "ops"}, **overrides)


def call(client: TestClient, method: str, path: str, body: dict | None, bearer: str | None = None):
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    return getattr(client, method)(path, headers=headers, **({"json": body} if body else {}))


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SUPABASE_URL", PROJECT)
    for name in ("ENV", "DEV_AUTH_BYPASS_USER_ID", "GEO_ROLE_CLAIM", "GEO_ENFORCE_ROLES"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(auth, "_jwk_client", _jwks_client)
    saved = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    yield TestClient(app)
    app.dependency_overrides.update(saved)


def test_health_stays_open(client: TestClient) -> None:
    """The container HEALTHCHECK curls this without credentials."""
    assert client.get("/v1/health").status_code == 200


@pytest.mark.parametrize("method,path,body", ALL_DATA_ROUTES)
def test_data_routes_require_a_token(
    client: TestClient, method: str, path: str, body: dict | None
) -> None:
    response = call(client, method, path, body)
    assert response.status_code == 401, (path, response.status_code)
    assert response.headers.get("www-authenticate") == "Bearer"


def test_unconfigured_service_refuses_rather_than_allowing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert client.get("/v1/stats").status_code == 503


def test_valid_token_is_accepted(client: TestClient) -> None:
    assert call(client, "post", "/v1/score", SCORE_BODY, token()).status_code == 200


@pytest.mark.parametrize(
    "bearer",
    [
        pytest.param("not-a-jwt", id="malformed"),
        pytest.param(token(key=FOREIGN_KEY), id="bad-signature"),
        pytest.param(token(exp=int(time.time()) - 60), id="expired"),
        pytest.param(token(aud="anon"), id="wrong-audience"),
        pytest.param(token(iss="https://other.supabase.co/auth/v1"), id="foreign-issuer"),
        pytest.param(token(sub=None), id="no-subject"),
        pytest.param(token(exp=None), id="no-expiry"),
        pytest.param(token(key="a-shared-secret-of-thirty-two-bytes!", algorithm="HS256"), id="hs256-forged"),
    ],
)
def test_invalid_tokens_are_rejected(client: TestClient, bearer: str) -> None:
    response = call(client, "post", "/v1/score", SCORE_BODY, bearer)
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


def test_unknown_signing_key_id_is_rejected(client: TestClient) -> None:
    forged = jwt.encode(
        {"sub": "user-1", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 600},
        FOREIGN_KEY,
        algorithm="ES256",
        headers={"kid": "someone-elses-key"},
    )
    assert call(client, "post", "/v1/score", SCORE_BODY, forged).status_code == 401


# ── Roles ────────────────────────────────────────────────────────────────────


def test_driver_can_score(client: TestClient) -> None:
    """Dispatch forwards the driver's own token to /v1/score."""
    driver = token(app_metadata={"role": "driver"})
    assert call(client, "post", "/v1/score", SCORE_BODY, driver).status_code == 200


@pytest.mark.parametrize("method,path,body", OPS_ROUTES)
@pytest.mark.parametrize(
    "bearer",
    [
        pytest.param(token(app_metadata={"role": "driver"}), id="driver"),
        pytest.param(token(app_metadata={"role": "provider"}), id="provider"),
        pytest.param(token(), id="no-role-claim"),
        pytest.param(token(user_metadata={"role": "ops"}), id="self-assigned-ops"),
    ],
)
def test_operator_routes_refuse_non_ops(
    client: TestClient, method: str, path: str, body: dict | None, bearer: str
) -> None:
    assert call(client, method, path, body, bearer).status_code == 403


@pytest.mark.parametrize("method,path,body", OPS_ROUTES)
def test_operator_routes_admit_ops(
    client: TestClient, method: str, path: str, body: dict | None
) -> None:
    assert call(client, method, path, body, ops_token()).status_code == 200


def test_role_claim_path_is_configurable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GEO_ROLE_CLAIM", "user_role")
    assert call(client, "get", "/v1/stats", None, token(user_role="ops")).status_code == 200
    assert call(client, "get", "/v1/stats", None, ops_token()).status_code == 403


def test_role_enforcement_can_be_switched_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    driver = token(app_metadata={"role": "driver"})
    assert call(client, "get", "/v1/stats", None, driver).status_code == 403
    monkeypatch.setenv("GEO_ENFORCE_ROLES", "false")
    assert call(client, "get", "/v1/stats", None, driver).status_code == 200
    assert call(client, "get", "/v1/stats", None, None).status_code == 401


# ── Development bypass ───────────────────────────────────────────────────────


@pytest.mark.parametrize("env", [None, "production", "prod", "Development-ish", ""])
def test_dev_bypass_ignored_outside_development(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, env: str | None
) -> None:
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "dev-user")
    if env is not None:
        monkeypatch.setenv("ENV", env)
    assert client.get("/v1/stats").status_code == 401


def test_dev_bypass_honoured_in_development(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "dev-user")
    assert client.get("/v1/stats").status_code == 200
    assert client.post("/v1/score", json=SCORE_BODY).status_code == 200
