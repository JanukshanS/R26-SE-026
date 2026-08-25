"""CRUD operations for the parts catalogue."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.controllers.marketplace_controller import part_to_out
from app.models import Part
from app.schemas.marketplace import PartCreate, PartOut, PartUpdate
from app.services.marketplace_mapping import VALID_COMPONENTS, parse_fitment


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_component(component: str) -> str:
    key = component.lower().strip()
    if key not in VALID_COMPONENTS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"component must be one of: {', '.join(sorted(VALID_COMPONENTS))}",
        )
    return key


def list_parts(db: Session, *, component: Optional[str] = None) -> List[PartOut]:
    query = db.query(Part).order_by(Part.component, Part.name)
    if component:
        query = query.filter(Part.component == _validate_component(component))
    return [part_to_out(row, include_admin_fields=True) for row in query.all()]


def get_part(db: Session, part_id: str) -> PartOut:
    row = db.get(Part, part_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found.")
    return part_to_out(row, include_admin_fields=True)


def create_part(db: Session, payload: PartCreate) -> PartOut:
    component = _validate_component(payload.component)
    fits_models, fits_any = parse_fitment(payload.vehicle_compatibility)
    if payload.fits_any_model:
        fits_any = True

    row = Part(
        id=str(uuid.uuid4()),
        component=component,
        name=payload.name.strip(),
        brand=payload.brand,
        part_number=payload.part_number,
        category=payload.category,
        price_lkr=payload.price_lkr,
        grade=payload.grade,
        supplier=payload.supplier,
        supplier_url=payload.supplier_url,
        fits_note=", ".join(payload.vehicle_compatibility) or None,
        fits_models=fits_models or None,
        fits_any_model=1 if fits_any else 0,
        stock_count=payload.stock_count,
        in_stock=1 if payload.in_stock else 0,
        rating=payload.rating,
        review_count=payload.review_count,
        warranty=payload.warranty,
        updated_at=_now_iso(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return part_to_out(row, include_admin_fields=True)


def update_part(db: Session, part_id: str, payload: PartUpdate) -> PartOut:
    row = db.get(Part, part_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found.")

    data = payload.model_dump(exclude_unset=True)
    if "component" in data and data["component"] is not None:
        row.component = _validate_component(data["component"])
    if "name" in data and data["name"] is not None:
        row.name = data["name"].strip()
    if "brand" in data:
        row.brand = data["brand"]
    if "part_number" in data:
        row.part_number = data["part_number"]
    if "category" in data:
        row.category = data["category"]
    if "price_lkr" in data and data["price_lkr"] is not None:
        row.price_lkr = data["price_lkr"]
    if "grade" in data:
        row.grade = data["grade"]
    if "supplier" in data:
        row.supplier = data["supplier"]
    if "supplier_url" in data:
        row.supplier_url = data["supplier_url"]
    if "vehicle_compatibility" in data:
        compat = data["vehicle_compatibility"] or []
        fits_models, fits_any = parse_fitment(compat)
        row.fits_note = ", ".join(compat) or None
        row.fits_models = fits_models or None
        if "fits_any_model" not in data:
            row.fits_any_model = 1 if fits_any else 0
    if "fits_any_model" in data and data["fits_any_model"] is not None:
        row.fits_any_model = 1 if data["fits_any_model"] else 0
    if "stock_count" in data:
        row.stock_count = data["stock_count"]
    if "in_stock" in data and data["in_stock"] is not None:
        row.in_stock = 1 if data["in_stock"] else 0
    if "rating" in data:
        row.rating = data["rating"]
    if "review_count" in data:
        row.review_count = data["review_count"]
    if "warranty" in data:
        row.warranty = data["warranty"]

    row.updated_at = _now_iso()
    db.commit()
    db.refresh(row)
    return part_to_out(row, include_admin_fields=True)


def delete_part(db: Session, part_id: str) -> None:
    row = db.get(Part, part_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found.")
    db.delete(row)
    db.commit()
