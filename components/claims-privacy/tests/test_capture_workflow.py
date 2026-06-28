from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, get_capture_repository, get_r2_storage, get_settings


class FakeRepository:
    def __init__(self) -> None:
        self.captures: Dict[str, Dict[str, Any]] = {}
        self.photos: Dict[str, list[Dict[str, Any]]] = {}

    def create_capture(self) -> Dict[str, Any]:
        capture_id = "capture-1"
        row = {
            "id": capture_id,
            "status": "uploading",
            "created_at": datetime.now(timezone.utc),
            "completed_at": None,
        }
        self.captures[capture_id] = row
        self.photos[capture_id] = []
        return row

    def get_capture(self, capture_id: str) -> Optional[Dict[str, Any]]:
        return self.captures.get(capture_id)

    def insert_photo(
        self,
        capture_id: str,
        photo_index: int,
        r2_key: str,
        content_type: str,
        byte_size: int,
        gps_lat: Optional[float],
        gps_lng: Optional[float],
        gps_alt: Optional[float],
        gps_accuracy: Optional[float],
        captured_at_client: Optional[datetime],
    ) -> Dict[str, Any]:
        _ = (gps_lat, gps_lng, gps_alt, gps_accuracy, captured_at_client)
        existing_indices = {row["photo_index"] for row in self.photos[capture_id]}
        if photo_index in existing_indices:
            raise ValueError("duplicate photo index")
        row = {
            "id": "photo-{index}".format(index=photo_index),
            "capture_id": capture_id,
            "photo_index": photo_index,
            "r2_key": r2_key,
            "content_type": content_type,
            "byte_size": byte_size,
            "received_at_server": datetime.now(timezone.utc),
        }
        self.photos[capture_id].append(row)
        return row

    def count_photos(self, capture_id: str) -> int:
        return len(self.photos.get(capture_id, []))

    def mark_capture_processing(self, capture_id: str) -> Optional[Dict[str, Any]]:
        row = self.captures.get(capture_id)
        if not row or row["status"] != "uploading":
            return None
        row["status"] = "processing"
        row["completed_at"] = datetime.now(timezone.utc)
        return row


class FakeStorage:
    def upload_bytes(self, key: str, body: bytes, content_type: Optional[str]) -> None:
        _ = (key, body, content_type)


def test_capture_create_upload_complete_and_status() -> None:
    fake_repo = FakeRepository()
    fake_storage = FakeStorage()

    def override_repo() -> FakeRepository:
        return fake_repo

    def override_storage() -> FakeStorage:
        return fake_storage

    def override_settings() -> Settings:
        return Settings(
            database_url="postgresql://unit:test@localhost:5432/test",
            r2_access_key_id="k",
            r2_secret_access_key="s",
            r2_bucket_name="b",
            r2_endpoint_url="https://example.r2.local",
            min_capture_photos=2,
        )

    app.dependency_overrides[get_capture_repository] = override_repo
    app.dependency_overrides[get_r2_storage] = override_storage
    app.dependency_overrides[get_settings] = override_settings

    client = TestClient(app)

    create_response = client.post("/captures")
    assert create_response.status_code == 201
    capture_id = create_response.json()["id"]

    upload_1 = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "0"},
        files={"photo": ("0.jpg", b"image-bytes-1", "image/jpeg")},
    )
    assert upload_1.status_code == 201

    upload_2 = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "1"},
        files={"photo": ("1.jpg", b"image-bytes-2", "image/jpeg")},
    )
    assert upload_2.status_code == 201

    complete_response = client.post("/captures/{capture_id}/complete".format(capture_id=capture_id))
    assert complete_response.status_code == 200
    body = complete_response.json()
    assert body["status"] == "processing"
    assert body["uploaded_photo_count"] == 2

    status_response = client.get("/captures/{capture_id}/status".format(capture_id=capture_id))
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["status"] == "processing"
    assert status_body["uploaded_photo_count"] == 2

    app.dependency_overrides.clear()

