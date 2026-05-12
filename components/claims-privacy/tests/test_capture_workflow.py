from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, get_capture_repository, get_r2_storage, get_settings
from app.repository import ASSET_KIND_ENHANCED, ASSET_KIND_ORIGINAL


class FakeRepository:
    def __init__(self) -> None:
        self.captures: Dict[str, Dict[str, Any]] = {}
        self.photos: Dict[str, List[Dict[str, Any]]] = {}

    def ensure_schema(self) -> None:
        return

    def create_capture(self, **kwargs: Any) -> Dict[str, Any]:
        capture_id = "capture-1"
        row = {
            "id": capture_id,
            "status": "uploading",
            "created_at": datetime.now(timezone.utc),
            "completed_at": None,
            "claimant_name": kwargs.get("claimant_name"),
            "claimant_nic": kwargs.get("claimant_nic"),
            "claimant_licence_number": kwargs.get("claimant_licence_number"),
            "report_captured_at": kwargs.get("report_captured_at"),
            "report_captured_at_display_local": kwargs.get("report_captured_at_display_local"),
            "report_gps_lat": kwargs.get("report_gps_lat"),
            "report_gps_lng": kwargs.get("report_gps_lng"),
            "report_location_label": kwargs.get("report_location_label"),
        }
        self.captures[capture_id] = row
        self.photos[capture_id] = []
        return row

    def get_capture(self, capture_id: str) -> Optional[Dict[str, Any]]:
        return self.captures.get(capture_id)

    def get_photo_row(
        self,
        capture_id: str,
        photo_index: int,
        asset_kind: str,
    ) -> Optional[Dict[str, Any]]:
        for row in self.photos.get(capture_id, []):
            if row["photo_index"] == photo_index and row["asset_kind"] == asset_kind:
                return row
        return None

    def upsert_photo(
        self,
        capture_id: str,
        photo_index: int,
        asset_kind: str,
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
        bucket = self.photos[capture_id]
        for i, row in enumerate(bucket):
            if row["photo_index"] == photo_index and row["asset_kind"] == asset_kind:
                bucket[i] = {
                    **row,
                    "r2_key": r2_key,
                    "content_type": content_type,
                    "byte_size": byte_size,
                    "received_at_server": datetime.now(timezone.utc),
                }
                return bucket[i]
        row = {
            "id": "photo-{kind}-{index}".format(kind=asset_kind, index=photo_index),
            "capture_id": capture_id,
            "photo_index": photo_index,
            "asset_kind": asset_kind,
            "r2_key": r2_key,
            "content_type": content_type,
            "byte_size": byte_size,
            "received_at_server": datetime.now(timezone.utc),
        }
        bucket.append(row)
        return row

    def count_photos(self, capture_id: str) -> int:
        return len(self.photos.get(capture_id, []))

    def count_photos_by_kind(self, capture_id: str, asset_kind: str) -> int:
        return sum(1 for r in self.photos.get(capture_id, []) if r["asset_kind"] == asset_kind)

    def count_originals_missing_enhancement(self, capture_id: str) -> int:
        originals = [r for r in self.photos.get(capture_id, []) if r["asset_kind"] == ASSET_KIND_ORIGINAL]
        missing = 0
        for o in originals:
            if not self.get_photo_row(capture_id, o["photo_index"], ASSET_KIND_ENHANCED):
                missing += 1
        return missing

    def mark_capture_processing(self, capture_id: str) -> Optional[Dict[str, Any]]:
        row = self.captures.get(capture_id)
        if not row or row["status"] != "uploading":
            return None
        row["status"] = "processing"
        row["completed_at"] = datetime.now(timezone.utc)
        return row


class FakeStorage:
    deleted: List[str] = []

    def upload_bytes(
        self,
        key: str,
        body: bytes,
        content_type: Optional[str],
        metadata: Optional[Dict[str, str]] = None,
    ) -> None:
        _ = (key, body, content_type, metadata)

    def delete_object(self, key: str) -> None:
        FakeStorage.deleted.append(key)


def test_capture_create_upload_complete_and_status() -> None:
    fake_repo = FakeRepository()
    fake_storage = FakeStorage()
    FakeStorage.deleted = []

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
        data={"photo_index": "0", "asset_kind": ASSET_KIND_ORIGINAL},
        files={"photo": ("0.jpg", b"image-bytes-1", "image/jpeg")},
    )
    assert upload_1.status_code == 201
    assert upload_1.json()["asset_kind"] == ASSET_KIND_ORIGINAL
    assert "original" in upload_1.json()["r2_key"]

    upload_2 = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "1", "asset_kind": ASSET_KIND_ORIGINAL},
        files={"photo": ("1.jpg", b"image-bytes-2", "image/jpeg")},
    )
    assert upload_2.status_code == 201

    bad_enhanced = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "5", "asset_kind": ASSET_KIND_ENHANCED},
        files={"photo": ("5.jpg", b"enh", "image/jpeg")},
    )
    assert bad_enhanced.status_code == 400

    enh_0 = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "0", "asset_kind": ASSET_KIND_ENHANCED},
        files={"photo": ("0e.jpg", b"enhanced-bytes", "image/jpeg")},
    )
    assert enh_0.status_code == 201
    assert enh_0.json()["asset_kind"] == ASSET_KIND_ENHANCED
    assert "enhanced" in enh_0.json()["r2_key"]

    status_mid = client.get("/captures/{capture_id}/status".format(capture_id=capture_id))
    assert status_mid.status_code == 200
    mid = status_mid.json()
    assert mid["original_photo_count"] == 2
    assert mid["enhanced_photo_count"] == 1
    assert mid["originals_meet_minimum"] is True
    assert mid["enhancement_complete"] is False

    enh_1 = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "1", "asset_kind": ASSET_KIND_ENHANCED},
        files={"photo": ("1e.jpg", b"enhanced-2", "image/jpeg")},
    )
    assert enh_1.status_code == 201

    status_done = client.get("/captures/{capture_id}/status".format(capture_id=capture_id))
    assert status_done.json()["enhancement_complete"] is True

    complete_response = client.post("/captures/{capture_id}/complete".format(capture_id=capture_id))
    assert complete_response.status_code == 200
    body = complete_response.json()
    assert body["status"] == "processing"
    assert body["uploaded_photo_count"] == 2
    assert body["uploaded_enhanced_count"] == 2

    status_response = client.get("/captures/{capture_id}/status".format(capture_id=capture_id))
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["status"] == "processing"
    assert status_body["uploaded_photo_count"] == 4
    assert status_body["original_photo_count"] == 2
    assert status_body["enhanced_photo_count"] == 2

    app.dependency_overrides.clear()


def test_video_upload_uses_mp4_extension_when_filename_is_jpg() -> None:
    """Mobile multipart often uses a .jpg filename while Content-Type is video/mp4."""
    fake_repo = FakeRepository()
    fake_storage = FakeStorage()

    app.dependency_overrides[get_capture_repository] = lambda: fake_repo
    app.dependency_overrides[get_r2_storage] = lambda: fake_storage
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="postgresql://unit:test@localhost:5432/test",
        r2_access_key_id="k",
        r2_secret_access_key="s",
        r2_bucket_name="b",
        r2_endpoint_url="https://example.r2.local",
        min_capture_photos=2,
    )

    client = TestClient(app)
    create_response = client.post("/captures")
    assert create_response.status_code == 201
    capture_id = create_response.json()["id"]

    upload_vid = client.post(
        "/captures/{capture_id}/photos".format(capture_id=capture_id),
        data={"photo_index": "9", "asset_kind": ASSET_KIND_ORIGINAL},
        files={"photo": ("wrong-name.jpg", b"\x00\x00\x00\x18ftypmp42", "video/mp4")},
    )
    assert upload_vid.status_code == 201
    key = upload_vid.json()["r2_key"]
    assert key.endswith(".mp4"), key
    assert upload_vid.json()["content_type"] == "video/mp4"

    app.dependency_overrides.clear()
