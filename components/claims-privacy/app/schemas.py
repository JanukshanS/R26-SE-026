from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CreateCaptureRequest(BaseModel):
    """Optional claimant + report snapshot (same moment as “Captured and submitted” in the app)."""

    claimant_name: Optional[str] = Field(default=None, max_length=200)
    claimant_nic: Optional[str] = Field(default=None, max_length=32)
    claimant_licence_number: Optional[str] = Field(default=None, max_length=64)
    report_captured_at: Optional[datetime] = None
    report_captured_at_display_local: Optional[str] = Field(
        default=None,
        max_length=240,
        description="Human-readable local time from the device (e.g. same line as Captured and Submitted); stored for R2 metadata.",
    )
    report_gps_lat: Optional[float] = None
    report_gps_lng: Optional[float] = None
    report_location_label: Optional[str] = Field(default=None, max_length=2000)


class CaptureResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None


class PhotoUploadResponse(BaseModel):
    id: str
    capture_id: str
    photo_index: int
    asset_kind: str = Field(
        description="`original` = camera file; `enhanced` = low-light output (same photo_index as its original).",
    )
    r2_key: str
    content_type: str
    byte_size: int
    received_at_server: datetime


class CompleteCaptureResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: datetime
    uploaded_photo_count: int = Field(
        description="Original (camera) assets; this count gates POST /complete.",
    )
    uploaded_enhanced_count: int = Field(ge=0, description="Enhanced assets on this capture.")


class CaptureStatusResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    uploaded_photo_count: int = Field(ge=0, description="All rows: original + enhanced.")
    original_photo_count: int = Field(ge=0)
    enhanced_photo_count: int = Field(ge=0)
    originals_meet_minimum: bool = Field(
        description="True when original_photo_count >= server min_capture_photos.",
    )
    enhancement_complete: bool = Field(
        description="True when every original has a matching enhanced row (same photo_index).",
    )
