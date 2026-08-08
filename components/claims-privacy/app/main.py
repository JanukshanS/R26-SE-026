import logging
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional
from uuid import uuid4

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from app.config import Settings, get_settings
from app.repository import ASSET_KIND_ENHANCED, ASSET_KIND_ORIGINAL, CaptureRepository
from app.r2_metadata import build_parent_folder_name, build_photo_object_metadata
from app.schemas import (
    CaptureResponse,
    CaptureStatusResponse,
    ClaimSummary,
    CompleteCaptureResponse,
    CreateCaptureRequest,
    PhotoUploadResponse,
)
from app.storage import R2Storage

logger = logging.getLogger(__name__)

app = FastAPI(title="Guided Camera API", version="0.1.0")

AssetKind = Literal["original", "enhanced"]

_VIDEO_CT_TO_EXT = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".webm",
}
_IMAGE_CT_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
}
_KNOWN_SUFFIX = frozenset({".jpg", ".jpeg", ".png", ".heic", ".heif", ".mp4", ".mov", ".m4v", ".webm"})
_VIDEO_SUFFIX = frozenset({".mp4", ".mov", ".m4v", ".webm"})
_IMAGE_SUFFIX = frozenset({".jpg", ".jpeg", ".png", ".heic", ".heif"})


def _infer_upload_extension(filename: Optional[str], content_type: Optional[str]) -> str:
    """Pick R2 key suffix from filename; fall back to Content-Type (mobile clients often send wrong names)."""
    suffix = Path((filename or "").strip()).suffix.lower()
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("video/"):
        if suffix in _VIDEO_SUFFIX:
            return suffix
        return _VIDEO_CT_TO_EXT.get(ct, ".mp4")
    if ct.startswith("image/"):
        if suffix in _IMAGE_SUFFIX:
            return suffix
        return _IMAGE_CT_TO_EXT.get(ct, ".jpg")
    if suffix in _KNOWN_SUFFIX:
        return suffix
    return ".jpg"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready(settings: Settings = Depends(get_settings)) -> dict[str, bool]:
    """Reports whether required env is present (no secret values returned)."""
    return {
        "postgres": settings.database_configured,
        "r2": settings.r2_configured,
    }


def get_capture_repository(settings: Settings = Depends(get_settings)) -> CaptureRepository:
    if not settings.database_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is not configured.",
        )
    return CaptureRepository(settings.effective_database_url or "")


def get_r2_storage(settings: Settings = Depends(get_settings)) -> R2Storage:
    if not settings.r2_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="R2 settings are not fully configured.",
        )
    return R2Storage(
        endpoint_url=settings.r2_endpoint_url or "",
        access_key_id=settings.r2_access_key_id or "",
        secret_access_key=settings.r2_secret_access_key or "",
        bucket_name=settings.r2_bucket_name or "",
    )


@app.on_event("startup")
def ensure_capture_schema() -> None:
    settings = get_settings()
    if not settings.database_configured:
        return
    try:
        CaptureRepository(settings.effective_database_url or "").ensure_schema()
    except Exception:
        logger.exception(
            "Could not run capture DB migrations on startup. "
            "Check DATABASE_URL (use postgresql:// for this app, not postgresql+asyncpg://) "
            "and that Postgres is reachable."
        )
        raise


@app.post("/captures", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def create_capture(
    body: Optional[CreateCaptureRequest] = Body(default=None),
    repository: CaptureRepository = Depends(get_capture_repository),
) -> CaptureResponse:
    try:
        req = body if body is not None else CreateCaptureRequest()
        return CaptureResponse.model_validate(
            repository.create_capture(
                claimant_name=req.claimant_name,
                claimant_nic=req.claimant_nic,
                claimant_licence_number=req.claimant_licence_number,
                vehicle_model=req.vehicle_model,
                policy_number=req.policy_number,
                vehicle_reg_no=req.vehicle_reg_no,
                report_captured_at=req.report_captured_at,
                report_captured_at_display_local=req.report_captured_at_display_local,
                report_gps_lat=req.report_gps_lat,
                report_gps_lng=req.report_gps_lng,
                report_location_label=req.report_location_label,
                insurer_call_at=req.insurer_call_at,
                insurer_call_captured_at_display_local=req.insurer_call_captured_at_display_local,
                insurer_call_gps_lat=req.insurer_call_gps_lat,
                insurer_call_gps_lng=req.insurer_call_gps_lng,
                insurer_call_location_permission=req.insurer_call_location_permission,
                insurer_call_location_label=req.insurer_call_location_label,
                guided_capture_started_at=req.guided_capture_started_at,
                guided_capture_start_captured_at_display_local=req.guided_capture_start_captured_at_display_local,
                guided_capture_start_gps_lat=req.guided_capture_start_gps_lat,
                guided_capture_start_gps_lng=req.guided_capture_start_gps_lng,
                guided_capture_start_location_permission=req.guided_capture_start_location_permission,
                guided_capture_start_location_label=req.guided_capture_start_location_label,
            )
        )
    except Exception as exc:
        logger.exception("create_capture failed")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create capture session: {exc!s}",
        ) from exc


@app.post(
    "/captures/{capture_id}/photos",
    response_model=PhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_capture_photo(
    capture_id: str,
    photo_index: int = Form(..., ge=0),
    asset_kind: str = Form("original"),
    photo_slot: str = Form("walkaround"),
    photo: UploadFile = File(...),
    gps_lat: Optional[float] = Form(None),
    gps_lng: Optional[float] = Form(None),
    gps_alt: Optional[float] = Form(None),
    gps_accuracy: Optional[float] = Form(None, ge=0),
    captured_at_client: Optional[datetime] = Form(None),
    repository: CaptureRepository = Depends(get_capture_repository),
    storage: R2Storage = Depends(get_r2_storage),
) -> PhotoUploadResponse:
    if asset_kind not in (ASSET_KIND_ORIGINAL, ASSET_KIND_ENHANCED):
        raise HTTPException(
            status_code=400,
            detail="asset_kind must be 'original' or 'enhanced'.",
        )
    kind: AssetKind = asset_kind  # type: ignore[assignment]

    capture = repository.get_capture(capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture session not found.")
    if capture["status"] != "uploading":
        raise HTTPException(status_code=409, detail="Capture session is not accepting uploads.")

    if kind == ASSET_KIND_ENHANCED:
        parent = repository.get_photo_row(capture_id, photo_index, ASSET_KIND_ORIGINAL)
        if not parent:
            raise HTTPException(
                status_code=400,
                detail="Upload the original for this photo_index before uploading enhanced.",
            )

    file_bytes = await photo.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded photo is empty.")

    extension = _infer_upload_extension(photo.filename, photo.content_type)
    parent = build_parent_folder_name(
        capture.get("claimant_name"),  # type: ignore[arg-type]
        capture.get("claimant_nic"),   # type: ignore[arg-type]
        capture.get("created_at"),
    )
    if photo_slot == "user-verification":
        subfolder = "step-2-fraud-validation/user-verification"
    elif photo_slot == "third-party":
        subfolder = "step-2-fraud-validation/third-party"
    else:
        subfolder = "step-1-photos-uploaded"
    if kind == ASSET_KIND_ENHANCED:
        subfolder += "/enhanced"
    key = "{parent}/{subfolder}/{index:03d}-{token}{ext}".format(
        parent=parent,
        subfolder=subfolder,
        index=photo_index,
        token=uuid4().hex,
        ext=extension,
    )

    existing = repository.get_photo_row(capture_id, photo_index, kind)
    old_r2_key: Optional[str] = existing["r2_key"] if existing else None  # type: ignore[index]

    try:
        meta = build_photo_object_metadata(
            capture,
            photo_index=photo_index,
            asset_kind=kind,
            gps_lat=gps_lat,
            gps_lng=gps_lng,
            gps_accuracy=gps_accuracy,
            captured_at_client=captured_at_client,
        )
        storage.upload_bytes(
            key=key,
            body=file_bytes,
            content_type=photo.content_type,
            metadata=meta or None,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to upload photo to object storage.") from exc

    try:
        row = repository.upsert_photo(
            capture_id=capture_id,
            photo_index=photo_index,
            asset_kind=kind,
            r2_key=key,
            content_type=photo.content_type or "application/octet-stream",
            byte_size=len(file_bytes),
            gps_lat=gps_lat,
            gps_lng=gps_lng,
            gps_alt=gps_alt,
            gps_accuracy=gps_accuracy,
            captured_at_client=captured_at_client,
        )
    except Exception as exc:
        try:
            storage.delete_object(key)
        except Exception:
            logger.warning("R2 rollback failed — orphaned object left in R2: %s", key)
        raise HTTPException(status_code=500, detail="Failed to save photo metadata.") from exc

    if old_r2_key and old_r2_key != key:
        try:
            storage.delete_object(str(old_r2_key))
        except Exception:
            logger.warning("Failed to delete superseded R2 object — orphaned: %s", old_r2_key)

    return PhotoUploadResponse.model_validate(row)


def _ts(v: object) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _num(v: object) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _write_locations_to_r2(capture: dict, storage: R2Storage) -> None:
    """Writes locations/locations.json into the claim folder. Best-effort — caller catches."""
    import json as _json

    locations_payload = {
        "insurer_call": {
            "captured_at": _ts(capture.get("insurer_call_at")),
            "captured_at_display_local": _ts(capture.get("insurer_call_captured_at_display_local")),
            "gps_lat": _num(capture.get("insurer_call_gps_lat")),
            "gps_lng": _num(capture.get("insurer_call_gps_lng")),
            "location_permission": _ts(capture.get("insurer_call_location_permission")),
            "location_label": _ts(capture.get("insurer_call_location_label")),
        },
        "guided_capture_started": {
            "captured_at": _ts(capture.get("guided_capture_started_at")),
            "captured_at_display_local": _ts(capture.get("guided_capture_start_captured_at_display_local")),
            "gps_lat": _num(capture.get("guided_capture_start_gps_lat")),
            "gps_lng": _num(capture.get("guided_capture_start_gps_lng")),
            "location_permission": _ts(capture.get("guided_capture_start_location_permission")),
            "location_label": _ts(capture.get("guided_capture_start_location_label")),
        },
        "report_submitted": {
            "captured_at": _ts(capture.get("report_captured_at")),
            "captured_at_display_local": _ts(capture.get("report_captured_at_display_local")),
            "gps_lat": _num(capture.get("report_gps_lat")),
            "gps_lng": _num(capture.get("report_gps_lng")),
            "location_label": _ts(capture.get("report_location_label")),
        },
    }
    parent = build_parent_folder_name(
        capture.get("claimant_name"),  # type: ignore[arg-type]
        capture.get("claimant_nic"),   # type: ignore[arg-type]
        capture.get("created_at"),
    )
    storage.upload_bytes(
        key=f"{parent}/locations/locations.json",
        body=_json.dumps(locations_payload, indent=2).encode(),
        content_type="application/json",
    )


@app.post("/captures/{capture_id}/complete", response_model=CompleteCaptureResponse)
def complete_capture(
    capture_id: str,
    settings: Settings = Depends(get_settings),
    repository: CaptureRepository = Depends(get_capture_repository),
    storage: R2Storage = Depends(get_r2_storage),
) -> CompleteCaptureResponse:
    capture = repository.get_capture(capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture session not found.")
    if capture["status"] != "uploading":
        raise HTTPException(status_code=409, detail="Capture session is already completed.")

    original_count = repository.count_photos_by_kind(capture_id, ASSET_KIND_ORIGINAL)
    if original_count < settings.min_capture_photos:
        raise HTTPException(
            status_code=400,
            detail="Not enough original photos uploaded. Minimum required: {count}.".format(
                count=settings.min_capture_photos
            ),
        )

    updated = repository.mark_capture_processing(capture_id)
    if not updated:
        raise HTTPException(status_code=409, detail="Capture session could not be completed.")

    try:
        _write_locations_to_r2(capture, storage)
    except Exception:
        logger.exception("Failed to write locations.json to R2 — continuing anyway")

    enhanced_count = repository.count_photos_by_kind(capture_id, ASSET_KIND_ENHANCED)

    return CompleteCaptureResponse(
        id=updated["id"],
        status=updated["status"],
        created_at=updated["created_at"],
        completed_at=updated["completed_at"],
        uploaded_photo_count=original_count,
        uploaded_enhanced_count=enhanced_count,
    )


@app.get("/captures/{capture_id}/status", response_model=CaptureStatusResponse)
def capture_status(
    capture_id: str,
    settings: Settings = Depends(get_settings),
    repository: CaptureRepository = Depends(get_capture_repository),
) -> CaptureStatusResponse:
    capture = repository.get_capture(capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture session not found.")

    total = repository.count_photos(capture_id)
    original_count = repository.count_photos_by_kind(capture_id, ASSET_KIND_ORIGINAL)
    enhanced_count = repository.count_photos_by_kind(capture_id, ASSET_KIND_ENHANCED)
    missing_enh = repository.count_originals_missing_enhancement(capture_id)

    originals_meet_minimum = original_count >= settings.min_capture_photos
    enhancement_complete = original_count > 0 and missing_enh == 0

    return CaptureStatusResponse(
        id=capture["id"],
        status=capture["status"],
        created_at=capture["created_at"],
        completed_at=capture["completed_at"],
        uploaded_photo_count=total,
        original_photo_count=original_count,
        enhanced_photo_count=enhanced_count,
        originals_meet_minimum=originals_meet_minimum,
        enhancement_complete=enhancement_complete,
    )


@app.get("/claims", response_model=List[ClaimSummary])
def list_my_claims(
    nic: str,
    repository: CaptureRepository = Depends(get_capture_repository),
) -> List[ClaimSummary]:
    """A driver's claim history, listed by claimant NIC — used by the mobile app's My Claims screen."""
    rows = repository.list_captures_by_nic(nic)
    return [ClaimSummary.model_validate(row) for row in rows]
