"""CRUD tests for parts and garages admin catalogue."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import require_ops, require_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SUPABASE_URL", "https://testproject.supabase.co")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_user] = lambda: "driver-user"
    app.dependency_overrides[require_ops] = lambda: "ops-user"

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_parts_crud_round_trip(client: TestClient) -> None:
    create = client.post(
        "/admin/parts",
        json={
            "name": "Test Brake Pads",
            "component": "brake",
            "price_lkr": 15000,
            "brand": "Toyota",
            "vehicle_compatibility": ["Toyota Aqua"],
            "in_stock": True,
        },
    )
    assert create.status_code == 201, create.text
    part = create.json()
    part_id = part["id"]
    assert part["name"] == "Test Brake Pads"
    assert part["component"] == "brake"

    listing = client.get("/admin/parts?component=brake")
    assert listing.status_code == 200
    assert any(row["id"] == part_id for row in listing.json())

    update = client.put(
        f"/admin/parts/{part_id}",
        json={"price_lkr": 14000, "in_stock": False},
    )
    assert update.status_code == 200
    assert update.json()["price_lkr"] == 14000
    assert update.json()["in_stock"] is False

    delete = client.delete(f"/admin/parts/{part_id}")
    assert delete.status_code == 204
    assert client.get(f"/admin/parts/{part_id}").status_code == 404


def test_garages_crud_round_trip(client: TestClient) -> None:
    create = client.post(
        "/admin/garages",
        json={
            "name": "Test Garage",
            "city": "Colombo",
            "address": "1 Test Road",
            "services": ["Brake Service", "Oil Change"],
            "verified": True,
        },
    )
    assert create.status_code == 201, create.text
    garage = create.json()
    garage_id = garage["id"]
    assert garage["name"] == "Test Garage"
    assert "brake" in garage["services"]

    update = client.put(
        f"/admin/garages/{garage_id}",
        json={"labour_lkr": 3500, "rating": 4.5},
    )
    assert update.status_code == 200
    assert update.json()["labour_lkr"] == 3500

    delete = client.delete(f"/admin/garages/{garage_id}")
    assert delete.status_code == 204


def test_marketplace_lists_created_part(client: TestClient) -> None:
    create = client.post(
        "/admin/parts",
        json={
            "name": "Marketplace Oil Filter",
            "component": "engine",
            "price_lkr": 5200,
            "vehicle_compatibility": ["Toyota Corolla"],
        },
    )
    assert create.status_code == 201

    market = client.get("/marketplace/engine")
    assert market.status_code == 200
    names = [p["name"] for p in market.json()["parts"]]
    assert "Marketplace Oil Filter" in names


def test_admin_routes_require_ops(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    app.dependency_overrides.pop(require_ops, None)
    monkeypatch.setattr("app.auth._fetch_profile_role", lambda _uid, _tok: "driver")
    response = client.get("/admin/parts", headers={"Authorization": "Bearer fake-token"})
    assert response.status_code in (401, 403)
