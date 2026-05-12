import logging
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from uuid import uuid4

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from app.config import Settings, get_settings
from app.repository import ASSET_KIND_ENHANCED, ASSET_KIND_ORIGINAL, CaptureRepository
from app.r2_metadata import build_photo_object_metadata
from app.schemas import (
    CaptureResponse,
    CaptureStatusResponse,
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
        return


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
                report_captured_at=req.report_captured_at,
                report_captured_at_display_local=req.report_captured_at_display_local,
                report_gps_lat=req.report_gps_lat,
                report_gps_lng=req.report_gps_lng,
                report_location_label=req.report_location_label,
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
    folder = "original" if kind == ASSET_KIND_ORIGINAL else "enhanced"
    key = "captures/{capture_id}/{folder}/{index:03d}-{token}{ext}".format(
        capture_id=capture_id,
        folder=folder,
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
            pass
        raise HTTPException(status_code=500, detail="Failed to save photo metadata.") from exc

    if old_r2_key and old_r2_key != key:
        try:
            storage.delete_object(str(old_r2_key))
        except Exception:
            pass

    return PhotoUploadResponse.model_validate(row)


@app.post("/captures/{capture_id}/complete", response_model=CompleteCaptureResponse)
def complete_capture(
    capture_id: str,
    settings: Settings = Depends(get_settings),
    repository: CaptureRepository = Depends(get_capture_repository),
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
