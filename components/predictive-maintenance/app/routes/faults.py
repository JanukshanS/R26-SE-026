"""Trouble codes for a vehicle: what is live now, and what has been seen.

Separate from the health endpoint because faults answer a different question.
Health is "how worn is this car"; this is "what is wrong with it". The health
response carries the live faults so a single request can render the dashboard,
but history and per-fault detail belong here rather than bloating that payload
on every poll.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.controllers.fault_controller import active_faults, history
from app.controllers.fault_presenter import sort_faults, to_out
from app.database import get_db
from app.schemas.trip import FaultOut

router = APIRouter()


class FaultListResponse(BaseModel):
    vehicle_id: str
    faults: List[FaultOut] = []
    # Distinguishes "no faults" from "never checked". Without it a car whose
    # adapter cannot read codes is indistinguishable from a healthy one.
    checked: bool = False


@router.get("/vehicle/{vehicle_id}/faults", response_model=FaultListResponse)
def list_faults(
    vehicle_id: str,
    include_resolved: bool = Query(False, description="Include codes no longer present"),
    db: Session = Depends(get_db),
) -> FaultListResponse:
    rows = history(db, vehicle_id) if include_resolved else active_faults(db, vehicle_id)
    faults = sort_faults([to_out(r) for r in rows])
    checked = bool(history(db, vehicle_id, limit=1))
    return FaultListResponse(vehicle_id=vehicle_id, faults=faults, checked=checked)


@router.get("/vehicle/{vehicle_id}/faults/{code}", response_model=FaultOut)
def get_fault(vehicle_id: str, code: str, db: Session = Depends(get_db)) -> FaultOut:
    wanted = code.strip().upper()
    for row in history(db, vehicle_id, limit=200):
        if row.code == wanted:
            return to_out(row)
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No record of {wanted} on {vehicle_id}.",
    )
