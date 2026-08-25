from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.auth import require_ops
from app.controllers import garages_controller
from app.database import get_db
from app.schemas.marketplace import GarageCreate, GarageOut, GarageUpdate

router = APIRouter(prefix="/admin/garages", tags=["Admin — Garages"])


@router.get("", response_model=List[GarageOut])
def list_garages(
    city: Optional[str] = None,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> List[GarageOut]:
    return garages_controller.list_garages(db, city=city)


@router.get("/{garage_id}", response_model=GarageOut)
def get_garage(
    garage_id: str,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> GarageOut:
    return garages_controller.get_garage(db, garage_id)


@router.post("", response_model=GarageOut, status_code=status.HTTP_201_CREATED)
def create_garage(
    payload: GarageCreate,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> GarageOut:
    return garages_controller.create_garage(db, payload)


@router.put("/{garage_id}", response_model=GarageOut)
def update_garage(
    garage_id: str,
    payload: GarageUpdate,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> GarageOut:
    return garages_controller.update_garage(db, garage_id, payload)


@router.delete("/{garage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_garage(
    garage_id: str,
    db: Session = Depends(get_db),
    _ops: str = Depends(require_ops),
) -> Response:
    garages_controller.delete_garage(db, garage_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
