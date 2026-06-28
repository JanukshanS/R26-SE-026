from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

import psycopg
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from app.config import Settings, get_settings
from app.repository import CaptureRepository
from app.schemas import (
    CaptureResponse,
    CaptureStatusResponse,
    CompleteCaptureResponse,
    PhotoUploadResponse,
)
from app.storage import R2Storage

app = FastAPI(title="Guided Camera API", version="0.1.0")


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
    return CaptureRepository(settings.database_url or "")


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
        CaptureRepository(settings.database_url or "").ensure_schema()
    except Exception:
        # Avoid hard-failing app boot in local dev; endpoint calls will still return clear errors.
        return


@app.post("/captures", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def create_capture(
    repository: CaptureRepository = Depends(get_capture_repository),
) -> CaptureResponse:
    try:
        return CaptureResponse.model_validate(repository.create_capture())
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to create capture session.") from exc


@app.post(
    "/captures/{capture_id}/photos",
    response_model=PhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_capture_photo(
    capture_id: str,
    photo_index: int = Form(..., ge=0),
    photo: UploadFile = File(...),
    gps_lat: Optional[float] = Form(None),
    gps_lng: Optional[float] = Form(None),
    gps_alt: Optional[float] = Form(None),
    gps_accuracy: Optional[float] = Form(None, ge=0),
    captured_at_client: Optional[datetime] = Form(None),
    repository: CaptureRepository = Depends(get_capture_repository),
    storage: R2Storage = Depends(get_r2_storage),
) -> PhotoUploadResponse:
    capture = repository.get_capture(capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture session not found.")
    if capture["status"] != "uploading":
        raise HTTPException(status_code=409, detail="Capture session is not accepting uploads.")

    file_bytes = await photo.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded photo is empty.")

    extension = Path(photo.filename or "capture.jpg").suffix or ".jpg"
    key = "captures/{capture_id}/{index:03d}-{token}{ext}".format(
        capture_id=capture_id,
        index=photo_index,
        token=uuid4().hex,
        ext=extension,
    )

    try:
        storage.upload_bytes(key=key, body=file_bytes, content_type=photo.content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to upload photo to object storage.") from exc

    try:
        row = repository.insert_photo(
            capture_id=capture_id,
            photo_index=photo_index,
            r2_key=key,
            content_type=photo.content_type or "application/octet-stream",
            byte_size=len(file_bytes),
            gps_lat=gps_lat,
            gps_lng=gps_lng,
            gps_alt=gps_alt,
            gps_accuracy=gps_accuracy,
            captured_at_client=captured_at_client,
        )
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(
            status_code=409,
            detail="A photo with this index already exists in the capture session.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to save photo metadata.") from exc

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

    photo_count = repository.count_photos(capture_id)
    if photo_count < settings.min_capture_photos:
        raise HTTPException(
            status_code=400,
            detail="Not enough photos uploaded. Minimum required: {count}.".format(
                count=settings.min_capture_photos
            ),
        )

    updated = repository.mark_capture_processing(capture_id)
    if not updated:
        raise HTTPException(status_code=409, detail="Capture session could not be completed.")

    return CompleteCaptureResponse(
        id=updated["id"],
        status=updated["status"],
        created_at=updated["created_at"],
        completed_at=updated["completed_at"],
        uploaded_photo_count=photo_count,
    )


@app.get("/captures/{capture_id}/status", response_model=CaptureStatusResponse)
def capture_status(
    capture_id: str,
    repository: CaptureRepository = Depends(get_capture_repository),
) -> CaptureStatusResponse:
    capture = repository.get_capture(capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture session not found.")

    photo_count = repository.count_photos(capture_id)
    return CaptureStatusResponse(
        id=capture["id"],
        status=capture["status"],
        created_at=capture["created_at"],
        completed_at=capture["completed_at"],
        uploaded_photo_count=photo_count,
    )
