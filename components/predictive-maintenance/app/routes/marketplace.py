from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.controllers import garages_controller, marketplace_controller, parts_controller
from app.database import get_db
from app.schemas.marketplace import (
    ComponentMarketplace,
    MarketplaceBrowse,
    GarageCreate,
    GarageOut,
    GarageUpdate,
    PartCreate,
    PartOut,
    PartUpdate,
    PriceInsight,
)

router = APIRouter()


@router.get("/marketplace", response_model=MarketplaceBrowse)
def browse(
    component: Optional[str] = Query(None, description="Narrow to one component"),
    vehicle: Optional[str] = Query(
        None, description='Fitment filter, e.g. "Toyota Aqua". Omit for everything.'
    ),
    search: Optional[str] = Query(None, description="Match part name, brand, number, or garage"),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    limit_parts: int = 60,
    limit_garages: int = 40,
    db: Session = Depends(get_db),
) -> MarketplaceBrowse:
    """The whole store, for browsing rather than acting on a worn component."""
    return marketplace_controller.browse_marketplace(
        db,
        component=component,
        vehicle=vehicle,
        search=search,
        lat=lat,
        lon=lon,
        limit_parts=limit_parts,
        limit_garages=limit_garages,
    )


@router.get("/marketplace/{component}", response_model=ComponentMarketplace)
def component_marketplace(
    component: str,
    lat: Optional[float] = Query(None, description="Caller latitude, to rank garages by distance"),
    lon: Optional[float] = Query(None, description="Caller longitude"),
    vehicle: Optional[str] = Query(
        None,
        description='Vehicle description for fitment filtering, e.g. "Toyota Aqua". '
        "Omit to receive every part for the component, unfiltered.",
    ),
    limit_parts: int = 6,
    limit_garages: int = 5,
    db: Session = Depends(get_db),
) -> ComponentMarketplace:
    """Everything a driver needs to act on one worn component."""
    return marketplace_controller.get_component_marketplace(
        db,
        component,
        lat=lat,
        lon=lon,
        vehicle=vehicle,
        limit_parts=limit_parts,
        limit_garages=limit_garages,
    )


@router.get("/marketplace/{component}/prices", response_model=PriceInsight)
def component_prices(component: str, db: Session = Depends(get_db)) -> PriceInsight:
    """Just the observed-price benchmark, for callers that want only that."""
    from app.services.marketplace_mapping import VALID_COMPONENTS

    component = component.lower().strip()
    if component not in VALID_COMPONENTS:
        return PriceInsight(
            component=component,
            sample_size=0,
            is_reliable=False,
            note="Unknown component.",
        )
    return marketplace_controller.observed_prices(db, component)
