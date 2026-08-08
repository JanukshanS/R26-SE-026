"""Which routes require a bearer token.

The token-decoding matrix (expiry, issuer, audience, algorithm confusion) is
covered once in components/claims-privacy/tests/test_auth.py against the same
verification code. This file only pins the routing question: what is open and
what is closed.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SUPABASE_URL", "https://testproject.supabase.co")
    with TestClient(app) as test_client:
        yield test_client


def test_health_stays_open(client: TestClient) -> None:
    """Also a regression guard: /health reads app.state.models, so it breaks if
    the registry stops exposing what the handler needs."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["models_loaded"], list)


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/process-trip"),
        ("get", "/vehicles/summary"),
        ("post", "/predict/best"),
        ("get", "/models/metrics"),
        ("get", "/vehicle/abc/rul"),
    ],
)
def test_router_routes_require_a_token(client: TestClient, method: str, path: str) -> None:
    response = getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert response.status_code == 401, (path, response.status_code)
    assert response.headers.get("www-authenticate") == "Bearer"


def test_unconfigured_service_refuses_rather_than_allowing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert client.get("/models/metrics").status_code == 503
