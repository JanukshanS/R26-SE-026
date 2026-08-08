"""Which routes require a bearer token.

The token-decoding matrix (expiry, issuer, audience, algorithm confusion) is
covered once in components/claims-privacy/tests/test_auth.py against the same
verification code. This file only pins the routing question: what is open and
what is closed.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.auth import require_user

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


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SUPABASE_URL", "https://testproject.supabase.co")
    app.dependency_overrides.pop(require_user, None)
    yield TestClient(app)
    app.dependency_overrides[require_user] = lambda: "test-user"


def test_health_stays_open(client: TestClient) -> None:
    """The container HEALTHCHECK curls this without credentials."""
    assert client.get("/v1/health").status_code == 200


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/v1/score", SCORE_BODY),
        ("post", "/v1/score/uncertainty", SCORE_BODY),
        ("post", "/v1/score/timeline", SCORE_BODY),
        ("get", "/v1/hotspots", None),
        ("get", "/v1/stats", None),
    ],
)
def test_data_routes_require_a_token(
    client: TestClient, method: str, path: str, body: dict | None
) -> None:
    response = getattr(client, method)(path, **({"json": body} if body else {}))
    assert response.status_code == 401, (path, response.status_code)
    assert response.headers.get("www-authenticate") == "Bearer"


def test_unconfigured_service_refuses_rather_than_allowing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert client.get("/v1/stats").status_code == 503
