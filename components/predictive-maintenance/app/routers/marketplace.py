"""Parts, garages, and what a repair actually costs.

THE INTERESTING PART IS THE PRICE. A catalogue can only report what a supplier
is asking. `service_records` already holds what drivers ACTUALLY PAID - every
logged service carries `cost_lkr` and `garage_name`, collected for the wear
model's benefit and never read for anything else. Aggregating it turns a
by-product into the most trustworthy number on the screen: not a list price,
but a range real people were charged for this component.

Both are returned, clearly separated. A catalogue price is a quote; an observed
price is evidence. Presenting either as the other would mislead, so neither is
silently merged into a single "price".
"""
from __future__ import annotations

import math
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Garage, Part, ServiceRecord

router = APIRouter()

VALID_COMPONENTS = {"engine", "brake", "tire", "battery"}

# Below this many observations a range is noise, not a benchmark. Two drivers
# who happened to use the same expensive garage would otherwise set the
# "typical" price for everyone.
MIN_OBSERVATIONS_FOR_RANGE = 3

# Prices outside this band are almost certainly a typo (a missing decimal, or
# a whole invoice logged against one part). Left in, they would drag a median
# far enough to make the whole figure useless.
MIN_PLAUSIBLE_LKR = 200.0
MAX_PLAUSIBLE_LKR = 2_000_000.0


# ── Response shapes ────────────────────────────────────────────────────────

class PartOut(BaseModel):
    id: str
    component: str
    name: str
    brand: Optional[str] = None
    fits_note: Optional[str] = None
    price_lkr: float
    grade: Optional[str] = None
    supplier: Optional[str] = None
    supplier_url: Optional[str] = None
    in_stock: bool = True


class GarageOut(BaseModel):
    id: str
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    services: List[str] = []
    rating: Optional[float] = None
    labour_lkr: Optional[float] = None
    opening_hours: Optional[str] = None
    verified: bool = False
    # Straight-line km from the caller, present only when coordinates were given.
    distance_km: Optional[float] = None


class PriceInsight(BaseModel):
    """What drivers actually paid, from their own logged service records."""

    component: str
    sample_size: int
    low_lkr: Optional[float] = None
    median_lkr: Optional[float] = None
    high_lkr: Optional[float] = None
    # False when there were too few records to say anything useful. The caller
    # must not render a range in that case - one observation is an anecdote.
    is_reliable: bool = False
    note: str = ""


class ComponentMarketplace(BaseModel):
    component: str
    parts: List[PartOut]
    garages: List[GarageOut]
    observed_prices: PriceInsight
    # Cheapest catalogue part plus typical labour: a single "what am I in for"
    # figure. None when we have neither.
    estimated_total_lkr: Optional[float] = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance. Straight-line, not driving distance.

    Deliberately not a routing call: this only ranks a short list and shows a
    rough "how far", and a network round trip per garage would cost far more
    than the accuracy is worth. The field is named distance_km rather than
    drive_km so the UI does not imply it is a route.
    """
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.asin(math.sqrt(a))


def part_fits_vehicle(part: Part, vehicle_desc: Optional[str]) -> bool:
    """Would this part actually go on this car?

    Offering Honda City brake pads to a Toyota Aqua owner is worse than
    offering nothing: it looks like a recommendation, and the driver finds out
    it is wrong at the counter. So the default is to EXCLUDE unless the
    fitment text supports the match.

    `vehicle_desc` is whatever the app knows - typically "Toyota Aqua". With no
    description at all we cannot filter, so everything is returned and the UI
    is expected to say the list is unfiltered.

    Matching is deliberately simple substring work over a supplier's advisory
    free text. It is not a compatibility matrix and must not be presented as
    one; `fits_note` is always returned so a driver can check for themselves.
    """
    if not vehicle_desc:
        return True
    if not part.fits_models:
        # No fitment stated. Universal consumables are usually flagged
        # fits_any_model; anything else with no fitment is an unknown, and an
        # unknown must not be shown as compatible.
        return bool(part.fits_any_model)

    desc = vehicle_desc.strip().lower()
    if not desc:
        return True

    listed = [m.strip() for m in part.fits_models.split(",") if m.strip()]
    for model in listed:
        # Either direction counts: the catalogue may hold "toyota aqua" while
        # the app knows "aqua", or the reverse.
        if model in desc or desc in model:
            return True
        # A marque-wide listing ("toyota") matches any Toyota, but ONLY when
        # the row was flagged as marque-wide - otherwise "toyota corolla"
        # parts would match every Toyota ever made.
        if part.fits_any_model and model and model.split()[0] in desc:
            return True
    return False


def _split_services(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _percentile(sorted_values: List[float], fraction: float) -> float:
    """Nearest-rank percentile. Exact enough for a handful of observations."""
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1)))))
    return sorted_values[idx]


def observed_prices(db: Session, component: str) -> PriceInsight:
    """Aggregate what drivers actually paid for this component.

    Reads `service_records.cost_lkr` - a field the app already collects when a
    driver logs a service, and which nothing else has ever read back.
    """
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

    # 10th/90th rather than min/max: one unusually cheap or expensive job
    # should not define the range shown to everyone.
    return PriceInsight(
        component=component,
        sample_size=len(values),
        low_lkr=round(_percentile(values, 0.10), 0),
        median_lkr=round(_percentile(values, 0.50), 0),
        high_lkr=round(_percentile(values, 0.90), 0),
        is_reliable=True,
        note=f"Based on {len(values)} services logged by drivers.",
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

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
    component = component.lower().strip()
    if component not in VALID_COMPONENTS:
        # 200 with empty lists rather than 404: an unknown component is a
        # client bug, and blanking the section is friendlier on a screen that
        # is otherwise showing useful health data.
        return ComponentMarketplace(
            component=component,
            parts=[],
            garages=[],
            observed_prices=PriceInsight(
                component=component, sample_size=0, is_reliable=False,
                note="Unknown component.",
            ),
        )

    # Fitment is filtered in Python rather than SQL: `fits_models` is advisory
    # free text from a supplier, and the marque-wide rule needs the
    # fits_any_model flag alongside it. A LIKE would be both slower to read and
    # easy to get subtly wrong.
    candidates = (
        db.query(Part)
        .filter(Part.component == component)
        .order_by(Part.in_stock.desc(), Part.price_lkr.asc())
        .all()
    )
    fitting = [p for p in candidates if part_fits_vehicle(p, vehicle)]
    parts = fitting[: max(1, min(limit_parts, 20))]

    # Garages are filtered in Python: `services` is a small comma-separated
    # string and the table is reference data, so a LIKE across it would be
    # both slower to read and easy to get subtly wrong ("tire" matching
    # "tire,battery" is fine, but also matching a hypothetical "retire").
    all_garages = db.query(Garage).all()
    matching = [g for g in all_garages if component in _split_services(g.services)]

    garage_out: List[GarageOut] = []
    for g in matching:
        distance = None
        if lat is not None and lon is not None and g.latitude is not None and g.longitude is not None:
            distance = round(_haversine_km(lat, lon, g.latitude, g.longitude), 1)
        garage_out.append(
            GarageOut(
                id=g.id,
                name=g.name,
                address=g.address,
                city=g.city,
                latitude=g.latitude,
                longitude=g.longitude,
                phone=g.phone,
                services=_split_services(g.services),
                rating=g.rating,
                labour_lkr=g.labour_lkr,
                opening_hours=g.opening_hours,
                verified=bool(g.verified),
                distance_km=distance,
            )
        )

    # Nearest first when we know where the driver is; otherwise best-rated,
    # since distance is meaningless without a location and an arbitrary order
    # would look like a ranking that isn't one.
    if lat is not None and lon is not None:
        garage_out.sort(key=lambda g: (g.distance_km is None, g.distance_km or 0.0))
    else:
        garage_out.sort(key=lambda g: (-(g.rating or 0.0), g.name))
    garage_out = garage_out[: max(1, min(limit_garages, 20))]

    insight = observed_prices(db, component)

    # Cheapest in-stock part plus the median labour of the garages shown.
    estimated_total = None
    if parts:
        cheapest = min(p.price_lkr for p in parts)
        labours = sorted(g.labour_lkr for g in garage_out if g.labour_lkr is not None)
        labour = _percentile(labours, 0.50) if labours else 0.0
        estimated_total = round(cheapest + labour, 0)

    return ComponentMarketplace(
        component=component,
        parts=[
            PartOut(
                id=p.id,
                component=p.component,
                name=p.name,
                brand=p.brand,
                fits_note=p.fits_note,
                price_lkr=p.price_lkr,
                grade=p.grade,
                supplier=p.supplier,
                supplier_url=p.supplier_url,
                in_stock=bool(p.in_stock),
            )
            for p in parts
        ],
        garages=garage_out,
        observed_prices=insight,
        estimated_total_lkr=estimated_total,
    )


@router.get("/marketplace/{component}/prices", response_model=PriceInsight)
def component_prices(component: str, db: Session = Depends(get_db)) -> PriceInsight:
    """Just the observed-price benchmark, for callers that want only that."""
    component = component.lower().strip()
    if component not in VALID_COMPONENTS:
        return PriceInsight(
            component=component, sample_size=0, is_reliable=False,
            note="Unknown component.",
        )
    return observed_prices(db, component)
