from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CaptureResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None


class PhotoUploadResponse(BaseModel):
    id: str
    capture_id: str
    photo_index: int
    r2_key: str
    content_type: str
    byte_size: int
    received_at_server: datetime


class CompleteCaptureResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: datetime
    uploaded_photo_count: int


class CaptureStatusResponse(BaseModel):
    id: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    uploaded_photo_count: int = Field(ge=0)
