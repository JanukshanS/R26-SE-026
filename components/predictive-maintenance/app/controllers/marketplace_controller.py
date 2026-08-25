"""Marketplace read logic: parts, garages, and observed prices."""
from __future__ import annotations

import math
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Garage, Part, ServiceRecord
from app.schemas.marketplace import (
    MarketplaceBrowse,
    ComponentMarketplace,
    GarageOut,
    PartOut,
    PriceInsight,
)
from app.services.marketplace_mapping import VALID_COMPONENTS, split_csv

MIN_OBSERVATIONS_FOR_RANGE = 3
MIN_PLAUSIBLE_LKR = 200.0
MAX_PLAUSIBLE_LKR = 2_000_000.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.asin(math.sqrt(a))


def part_fits_vehicle(part: Part, vehicle_desc: Optional[str]) -> bool:
    if not vehicle_desc:
        return True
    if not part.fits_models:
        return bool(part.fits_any_model)

    desc = vehicle_desc.strip().lower()
    if not desc:
        return True

    listed = [m.strip() for m in part.fits_models.split(",") if m.strip()]
    for model in listed:
        if model in desc or desc in model:
            return True
        if part.fits_any_model and model and model.split()[0] in desc:
            return True
    return False


def percentile(sorted_values: List[float], fraction: float) -> float:
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1)))))
    return sorted_values[idx]


def observed_prices(db: Session, component: str) -> PriceInsight:
    rows = (
        db.query(ServiceRecord.cost_lkr)
        .filter(ServiceRecord.component == component)
        .filter(ServiceRecord.cost_lkr.isnot(None))
        .all()
    )
    values = sorted(
        float(r[0])
        for r in rows
        if r[0] is not None and MIN_PLAUSIBLE_LKR <= float(r[0]) <= MAX_PLAUSIBLE_LKR
    )

    if len(values) < MIN_OBSERVATIONS_FOR_RANGE:
        return PriceInsight(
            component=component,
            sample_size=len(values),
            is_reliable=False,
            note=(
                "Not enough logged services yet to show a typical price. "
                "Every service a driver records makes this more accurate."
            ),
        )

    return PriceInsight(
        component=component,
        sample_size=len(values),
        low_lkr=round(percentile(values, 0.10), 0),
        median_lkr=round(percentile(values, 0.50), 0),
        high_lkr=round(percentile(values, 0.90), 0),
        is_reliable=True,
        note=f"Based on {len(values)} services logged by drivers.",
    )


def part_to_out(part: Part, *, include_admin_fields: bool = False) -> PartOut:
    return PartOut(
        id=part.id,
        component=part.component,
        name=part.name,
        brand=part.brand,
        fits_note=part.fits_note,
        price_lkr=part.price_lkr,
        grade=part.grade,
        supplier=part.supplier,
        supplier_url=part.supplier_url,
        in_stock=bool(part.in_stock),
        # Warranty, part number and review count are BUYING information, not
        # administrative detail. Gating them behind include_admin_fields left
        # drivers - and the recommendation model, which sees the same objects -
        # unable to tell a 12 month warranty from none at all. The model duly
        # reported "warranty not stated" and argued from it, which read as a
        # hallucination until the payload was checked: it was reporting what it
        # was given, and what it was given had been blanked here.
        #
        # A part number is what a driver quotes at a counter, so it is arguably
        # the single most useful field on the card.
        part_number=part.part_number,
        warranty=part.warranty,
        review_count=part.review_count,
        rating=part.rating,
        # These genuinely are internal: raw supplier category and the fitment
        # matching strings, which exist to drive filtering rather than to be
        # read. stock_count is admin-only because in_stock already answers the
        # only question a driver asks.
        category=part.category if include_admin_fields else None,
        fits_models=part.fits_models if include_admin_fields else None,
        fits_any_model=bool(part.fits_any_model) if include_admin_fields else False,
        stock_count=part.stock_count if include_admin_fields else None,
    )


def garage_to_out(
    garage: Garage,
    *,
    distance_km: Optional[float] = None,
    include_admin_fields: bool = False,
) -> GarageOut:
    return GarageOut(
        id=garage.id,
        name=garage.name,
        address=garage.address,
        city=garage.city,
        area=garage.area if include_admin_fields else None,
        latitude=garage.latitude,
        longitude=garage.longitude,
        phone=garage.phone,
        email=garage.email if include_admin_fields else None,
        services=split_csv(garage.services),
        services_raw=garage.services_raw if include_admin_fields else None,
        speciality=garage.speciality if include_admin_fields else None,
        mechanics=garage.mechanics if include_admin_fields else None,
        rating=garage.rating,
        review_count=garage.review_count if include_admin_fields else None,
        labour_lkr=garage.labour_lkr,
        opening_hours=garage.opening_hours,
        verified=bool(garage.verified),
        coords_are_city_level=bool(garage.coords_are_city_level) if include_admin_fields else False,
        distance_km=distance_km,
    )


def get_component_marketplace(
    db: Session,
    component: str,
    *,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    vehicle: Optional[str] = None,
    limit_parts: int = 6,
    limit_garages: int = 5,
) -> ComponentMarketplace:
    component = component.lower().strip()
    if component not in VALID_COMPONENTS:
        return ComponentMarketplace(
            component=component,
            parts=[],
            garages=[],
            observed_prices=PriceInsight(
                component=component,
                sample_size=0,
                is_reliable=False,
                note="Unknown component.",
            ),
        )

    candidates = (
        db.query(Part)
        .filter(Part.component == component)
        .order_by(Part.in_stock.desc(), Part.price_lkr.asc())
        .all()
    )
    fitting = [p for p in candidates if part_fits_vehicle(p, vehicle)]
    parts = fitting[: max(1, min(limit_parts, 20))]

    all_garages = db.query(Garage).all()
    matching = [g for g in all_garages if component in split_csv(g.services)]

    garage_out: List[GarageOut] = []
    for g in matching:
        distance = None
        if lat is not None and lon is not None and g.latitude is not None and g.longitude is not None:
            distance = round(haversine_km(lat, lon, g.latitude, g.longitude), 1)
        garage_out.append(garage_to_out(g, distance_km=distance))

    if lat is not None and lon is not None:
        garage_out.sort(key=lambda g: (g.distance_km is None, g.distance_km or 0.0))
    else:
        garage_out.sort(key=lambda g: (-(g.rating or 0.0), g.name))
    garage_out = garage_out[: max(1, min(limit_garages, 20))]

    insight = observed_prices(db, component)

    estimated_total = None
    if parts:
        cheapest = min(p.price_lkr for p in parts)
        labours = sorted(g.labour_lkr for g in garage_out if g.labour_lkr is not None)
        labour = percentile(labours, 0.50) if labours else 0.0
        estimated_total = round(cheapest + labour, 0)

    return ComponentMarketplace(
        component=component,
        parts=[part_to_out(p) for p in parts],
        garages=garage_out,
        observed_prices=insight,
        estimated_total_lkr=estimated_total,
    )


def browse_marketplace(
    db: Session,
    *,
    component: Optional[str] = None,
    vehicle: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    search: Optional[str] = None,
    limit_parts: int = 60,
    limit_garages: int = 40,
) -> MarketplaceBrowse:
    """The whole store, optionally narrowed.

    Fitment filtering still applies when a vehicle is supplied, for the same
    reason it does on the component screen: a part that cannot go on the
    driver's car is not a browsing result, it is a wrong answer that only
    reveals itself at the counter. `filtered_to_vehicle` is echoed back so the
    UI can say which car the list belongs to instead of leaving the driver to
    assume.
    """
    parts_query = db.query(Part)
    if component:
        key = component.lower().strip()
        if key not in VALID_COMPONENTS:
            # An unknown category yields an empty shelf rather than an error:
            # the surrounding screen is still perfectly usable.
            return MarketplaceBrowse(parts=[], garages=[], components=[])
        parts_query = parts_query.filter(Part.component == key)

    candidates = parts_query.order_by(
        Part.in_stock.desc(), Part.component, Part.price_lkr.asc()
    ).all()

    fitting = [p for p in candidates if part_fits_vehicle(p, vehicle)]

    if search:
        needle = search.strip().lower()
        if needle:
            # Name, brand and part number: the three things someone actually
            # types. Part number especially - it is what a garage quotes.
            fitting = [
                p for p in fitting
                if needle in (p.name or "").lower()
                or needle in (p.brand or "").lower()
                or needle in (p.part_number or "").lower()
            ]

    parts = [part_to_out(p) for p in fitting[: max(1, min(limit_parts, 200))]]

    # Component chips are built from what survived the filters, so the UI never
    # offers a category that would open onto an empty list.
    present: List[str] = []
    for p in parts:
        if p.component not in present:
            present.append(p.component)

    garage_rows = db.query(Garage).all()
    if component:
        key = component.lower().strip()
        garage_rows = [g for g in garage_rows if key in split_csv(g.services)]
    if search:
        needle = search.strip().lower()
        if needle:
            garage_rows = [
                g for g in garage_rows
                if needle in (g.name or "").lower()
                or needle in (g.city or "").lower()
                or needle in (g.services_raw or "").lower()
            ]

    garages: List[GarageOut] = []
    for g in garage_rows:
        distance = None
        if lat is not None and lon is not None and g.latitude is not None and g.longitude is not None:
            distance = round(haversine_km(lat, lon, g.latitude, g.longitude), 1)
        garages.append(garage_to_out(g, distance_km=distance))

    if lat is not None and lon is not None:
        garages.sort(key=lambda g: (g.distance_km is None, g.distance_km or 0.0))
    else:
        # Verified first, then best rated. Without a location, distance is
        # meaningless and an arbitrary order would read as a ranking.
        garages.sort(key=lambda g: (not g.verified, -(g.rating or 0.0), g.name))

    return MarketplaceBrowse(
        parts=parts,
        garages=garages[: max(1, min(limit_garages, 200))],
        components=present,
        filtered_to_vehicle=vehicle or None,
    )
