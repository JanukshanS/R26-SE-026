"""CRUD operations for the garage directory."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.controllers.marketplace_controller import garage_to_out
from app.models import Garage
from app.schemas.marketplace import GarageCreate, GarageOut, GarageUpdate
from app.services.marketplace_mapping import CITY_COORDS, map_garage_services


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _apply_coords(row: Garage, city: Optional[str], lat: Optional[float], lon: Optional[float], city_level: bool) -> None:
    if lat is not None and lon is not None:
        row.latitude = lat
        row.longitude = lon
        row.coords_are_city_level = 1 if city_level else 0
        return
    coords = CITY_COORDS.get((city or "").strip().lower())
    if coords:
        row.latitude, row.longitude = coords
        row.coords_are_city_level = 1
    else:
        row.latitude = None
        row.longitude = None
        row.coords_are_city_level = 0


def list_garages(db: Session, *, city: Optional[str] = None) -> List[GarageOut]:
    query = db.query(Garage).order_by(Garage.city, Garage.name)
    if city:
        query = query.filter(Garage.city.ilike(f"%{city.strip()}%"))
    return [garage_to_out(row, include_admin_fields=True) for row in query.all()]


def get_garage(db: Session, garage_id: str) -> GarageOut:
    row = db.get(Garage, garage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Garage not found.")
    return garage_to_out(row, include_admin_fields=True)


def create_garage(db: Session, payload: GarageCreate) -> GarageOut:
    raw_services = payload.services or []
    components = map_garage_services(raw_services)

    row = Garage(
        id=str(uuid.uuid4()),
        name=payload.name.strip(),
        address=payload.address,
        city=payload.city,
        area=payload.area,
        phone=payload.phone,
        email=payload.email,
        services=",".join(components) if components else None,
        services_raw=", ".join(raw_services) if raw_services else None,
        speciality=", ".join(payload.speciality) if payload.speciality else None,
        mechanics=payload.mechanics,
        review_count=payload.review_count,
        rating=payload.rating,
        labour_lkr=payload.labour_lkr,
        opening_hours=payload.opening_hours,
        verified=1 if payload.verified else 0,
        updated_at=_now_iso(),
    )
    _apply_coords(row, payload.city, payload.latitude, payload.longitude, payload.coords_are_city_level)
    db.add(row)
    db.commit()
    db.refresh(row)
    return garage_to_out(row, include_admin_fields=True)


def update_garage(db: Session, garage_id: str, payload: GarageUpdate) -> GarageOut:
    row = db.get(Garage, garage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Garage not found.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = data["name"].strip()
    if "address" in data:
        row.address = data["address"]
    if "city" in data:
        row.city = data["city"]
    if "area" in data:
        row.area = data["area"]
    if "phone" in data:
        row.phone = data["phone"]
    if "email" in data:
        row.email = data["email"]
    if "services" in data and data["services"] is not None:
        raw_services = data["services"]
        components = map_garage_services(raw_services)
        row.services = ",".join(components) if components else None
        row.services_raw = ", ".join(raw_services) if raw_services else None
    if "speciality" in data and data["speciality"] is not None:
        row.speciality = ", ".join(data["speciality"]) if data["speciality"] else None
    if "mechanics" in data:
        row.mechanics = data["mechanics"]
    if "review_count" in data:
        row.review_count = data["review_count"]
    if "rating" in data:
        row.rating = data["rating"]
    if "labour_lkr" in data:
        row.labour_lkr = data["labour_lkr"]
    if "opening_hours" in data:
        row.opening_hours = data["opening_hours"]
    if "verified" in data and data["verified"] is not None:
        row.verified = 1 if data["verified"] else 0

    if any(k in data for k in ("latitude", "longitude", "city", "coords_are_city_level")):
        lat = data.get("latitude", row.latitude)
        lon = data.get("longitude", row.longitude)
        city = data.get("city", row.city)
        city_level = data.get("coords_are_city_level", bool(row.coords_are_city_level))
        _apply_coords(row, city, lat, lon, bool(city_level))

    row.updated_at = _now_iso()
    db.commit()
    db.refresh(row)
    return garage_to_out(row, include_admin_fields=True)


def delete_garage(db: Session, garage_id: str) -> None:
    row = db.get(Garage, garage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Garage not found.")
    db.delete(row)
    db.commit()
