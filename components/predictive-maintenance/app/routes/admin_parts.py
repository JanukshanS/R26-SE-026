from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.auth import require_ops
from app.controllers import parts_controller
from app.database import get_db
from app.schemas.marketplace import PartCreate, PartOut, PartUpdate

router = APIRouter(prefix="/admin/parts", tags=["Admin — Parts"])


@router.get("", response_model=List[PartOut])
def list_parts(
    component: Optional[str] = None,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> List[PartOut]:
    return parts_controller.list_parts(db, component=component)


@router.get("/{part_id}", response_model=PartOut)
def get_part(
    part_id: str,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> PartOut:
    return parts_controller.get_part(db, part_id)


@router.post("", response_model=PartOut, status_code=status.HTTP_201_CREATED)
def create_part(
    payload: PartCreate,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> PartOut:
    return parts_controller.create_part(db, payload)


@router.put("/{part_id}", response_model=PartOut)
def update_part(
    part_id: str,
    payload: PartUpdate,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> PartOut:
    return parts_controller.update_part(db, part_id, payload)


@router.delete("/{part_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_part(
    part_id: str,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> Response:
    parts_controller.delete_part(db, part_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
