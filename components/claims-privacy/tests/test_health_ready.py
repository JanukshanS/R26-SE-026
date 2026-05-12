from fastapi.testclient import TestClient

from app.main import app


def test_health_ready_not_configured(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "")
    monkeypatch.setenv("R2_BUCKET_NAME", "")
    monkeypatch.setenv("R2_ENDPOINT_URL", "")

    client = TestClient(app)
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"postgres": False, "r2": False}


def test_health_ready_postgres_configured(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "")
    monkeypatch.setenv("R2_BUCKET_NAME", "")
    monkeypatch.setenv("R2_ENDPOINT_URL", "")

    client = TestClient(app)
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["postgres"] is True
    assert body["r2"] is False
