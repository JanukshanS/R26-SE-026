"""Per-user rate limit and the CORS allow-list."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src import api
from src.api import app
from src.auth import require_ops, require_user
from src.ratelimit import rate_limit

client = TestClient(app)


@pytest.fixture
def as_user():
    """Authenticate every request as whichever subject the test names."""
    saved = dict(app.dependency_overrides)
    app.dependency_overrides.pop(rate_limit, None)
    app.dependency_overrides[require_ops] = lambda: "ops-user"

    def login(subject: str) -> None:
        app.dependency_overrides[require_user] = lambda: subject

    yield login
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved)


def test_limit_answers_429_with_retry_after(as_user, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEO_RATE_LIMIT_PER_MINUTE", "3")
    as_user("busy-user")
    codes = [client.get("/v1/stats").status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]

    limited = client.get("/v1/stats")
    assert limited.status_code == 429
    assert 1 <= int(limited.headers["retry-after"]) <= 20


def test_limit_is_per_user(as_user, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEO_RATE_LIMIT_PER_MINUTE", "1")
    as_user("first")
    assert client.get("/v1/stats").status_code == 200
    assert client.get("/v1/stats").status_code == 429
    as_user("second")
    assert client.get("/v1/stats").status_code == 200


def test_zero_disables_the_limit(as_user, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEO_RATE_LIMIT_PER_MINUTE", "0")
    as_user("load-test")
    assert all(client.get("/v1/stats").status_code == 200 for _ in range(5))


def test_health_is_not_rate_limited(as_user, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEO_RATE_LIMIT_PER_MINUTE", "1")
    assert all(client.get("/v1/health").status_code == 200 for _ in range(3))


def _preflight(origin: str):
    return client.options(
        "/v1/score",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )


@pytest.mark.parametrize(
    "origin", ["https://kaduna.lk", "https://www.kaduna.lk", "http://localhost:3000"]
)
def test_cors_admits_platform_origins(origin: str) -> None:
    response = _preflight(origin)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", ["https://evil.example", "https://kaduna.lk.evil.example"])
def test_cors_refuses_other_origins(origin: str) -> None:
    response = _preflight(origin)
    assert "access-control-allow-origin" not in response.headers
    simple = client.get("/v1/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in simple.headers


def test_cors_origins_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", " https://a.example , https://b.example,")
    assert api._cors_origins() == ["https://a.example", "https://b.example"]
    monkeypatch.delenv("CORS_ALLOW_ORIGINS")
    assert api._cors_origins() == [
        "https://kaduna.lk",
        "https://www.kaduna.lk",
        "http://localhost:3000",
    ]
