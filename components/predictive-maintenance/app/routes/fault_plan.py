"""What to do about one specific fault code, wherever it belongs.

WHY THIS EXISTS SEPARATELY FROM /plan/{component}. That endpoint answers "this
part is worn, what now?" and is anchored to a wear prediction. A fault has no
wear prediction - a cylinder misfire is not a percentage of anything - and a
third of the codes we catalogue (transmission, evaporative, fuel cap) map to no
component at all, so there is no component screen to send them to.

Rather than leave those as a dead end in the UI, this gives every fault the
same treatment: what it is, what it leads to, where to get it fixed, and what
the mechanic will actually do. The wear context is included when the fault does
map to a component, and simply absent when it does not, instead of the whole
page being unavailable.

The honesty rules are identical to routes/recommend.py: the model chooses from
a candidate set we supply, every id it returns is validated against real rows,
and the CONSEQUENCE is looked up from app/services/fault_catalogue.py rather
than generated - because "this will damage your catalytic converter" is a claim
a driver spends money on.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.controllers.fault_controller import history
from app.controllers.fault_presenter import to_out
from app.controllers.marketplace_controller import get_component_marketplace
from app.database import get_db
from app.routes.predict import _LABEL_TO_KEY, vehicle_health
from app.routes.recommend import Recommendation, _ask_model, _facts
from app.schemas.marketplace import GarageOut, PartOut, PriceInsight
from app.schemas.trip import ComponentHealth, FaultOut
from app.services.knowledge import build_query, format_for_prompt, get_index
from app.services.marketplace_mapping import VALID_COMPONENTS

router = APIRouter()

# Which marketplace to search for a fault that maps to no component of ours.
# "engine" is the bucket general-repair workshops land in (see
# SERVICE_TO_COMPONENT), so it is the closest thing to "a garage that could
# look at this" without inventing a category.
UNMAPPED_GARAGE_PROXY = "engine"


class FaultPlan(BaseModel):
    """Everything the driver needs about one fault."""

    fault: FaultOut
    # The wear reading for the component this fault belongs to, when it belongs
    # to one. None for transmission, evaporative and similar codes - absent
    # rather than faked, so the UI omits the section instead of showing zeros.
    component_health: Optional[ComponentHealth] = None
    parts: List[PartOut] = []
    garages: List[GarageOut] = []
    observed_prices: Optional[PriceInsight] = None
    recommendation: Optional[Recommendation] = None
    # "llm" or "fallback", so the UI can label generated prose and a silent
    # outage shows up as a missing card rather than looking switched off.
    source: str = "fallback"


class _FaultAsAdvice:
    """Adapts a FaultOut to the handful of attributes _facts reads.

    Not a subclass of Advice: an Advice asserts a wear urgency computed from a
    remaining-life figure, and a fault has none. Duck-typing the four fields
    _facts actually touches keeps the payload identical without pretending the
    fault came from the wear model.
    """

    def __init__(self, fault: FaultOut):
        self.component = fault.component
        self.urgency = fault.severity
        self.headline = fault.title
        # A code is a measurement the ECU stored, never an estimate.
        self.is_estimated = False


@router.get("/vehicle/{vehicle_id}/fault/{code}/plan", response_model=FaultPlan)
async def fault_plan(
    vehicle_id: str,
    code: str,
    request: Request,
    lat: Optional[float] = Query(None, description="Driver latitude, to rank garages"),
    lon: Optional[float] = Query(None, description="Driver longitude"),
    vehicle: Optional[str] = Query(None, description="Fitment filter, e.g. Toyota Aqua"),
    recommend: bool = Query(
        True, description="Ask the model to pick one. False returns options only."
    ),
    db: Session = Depends(get_db),
) -> FaultPlan:
    wanted = code.strip().upper()

    row = next((r for r in history(db, vehicle_id, limit=200) if r.code == wanted), None)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No record of {wanted} on {vehicle_id}.",
        )
    fault = to_out(row)

    plan = FaultPlan(fault=fault)

    # Wear context, when this fault belongs to a component we model. Wrapped
    # because health needs trips and models to be available, and a fault page
    # must still open on a vehicle that has neither.
    if fault.component in VALID_COMPONENTS:
        try:
            health = vehicle_health(vehicle_id, request, db)
            plan.component_health = next(
                (
                    c
                    for c in health.components
                    if _LABEL_TO_KEY.get(c.component) == fault.component
                ),
                None,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[fault_plan] no wear context for {vehicle_id}/{wanted}: {exc}")

    market_key = (
        fault.component if fault.component in VALID_COMPONENTS else UNMAPPED_GARAGE_PROXY
    )
    market = get_component_marketplace(
        db, market_key, lat=lat, lon=lon, vehicle=vehicle, limit_parts=8, limit_garages=6
    )
    plan.garages = market.garages
    plan.observed_prices = market.observed_prices
    # Parts are only offered for a fault that maps to a component we stock for.
    # Showing brake pads beside a transmission code would be a wrong answer
    # dressed as a suggestion.
    plan.parts = market.parts if fault.component in VALID_COMPONENTS else []

    if not recommend or (not plan.parts and not plan.garages):
        return plan

    retrieved = []
    try:
        retrieved = get_index().search(
            build_query(
                component=market_key,
                urgency=fault.severity,
                headline=fault.title,
                vehicle=vehicle,
                fault_code=fault.code,
                fault_title=fault.title,
            ),
            component=market_key,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[fault_plan] knowledge retrieval failed, continuing without: {exc}")

    readings = {
        "component_health_percent": (
            round(plan.component_health.health_pct) if plan.component_health else None
        ),
        "fault_seen_on_trips": fault.times_seen,
        "came_back_after_being_cleared": bool(fault.recurrences),
    }

    reply = await _ask_model(
        _facts(
            _FaultAsAdvice(fault),
            plan.parts,
            plan.garages,
            plan.observed_prices,
            readings,
            has_location=lat is not None and lon is not None,
            reference=format_for_prompt(retrieved),
            faults=[fault],
        )
    )
    if not reply:
        return plan

    # Validate every reference before believing any of it, exactly as
    # routes/recommend.py does - a model that names a garage we did not supply
    # has left the data and is guessing.
    garages_by_id = {g.id: g for g in plan.garages}
    parts_by_id = {p.id: p for p in plan.parts}
    gid, pid = reply.get("garage_id"), reply.get("part_id")
    garage = garages_by_id.get(str(gid)) if gid else None
    part = parts_by_id.get(str(pid)) if pid else None

    if gid and not garage:
        print(f"[fault_plan] model named unknown garage {gid!r} - dropped")
    if pid and not part:
        print(f"[fault_plan] model named unknown part {pid!r} - dropped")

    garage_reason = str(reply.get("garage_reason") or "").strip()
    how_its_done = str(reply.get("how_its_done") or "").strip()
    if not garage_reason and not how_its_done and not garage and not part:
        return plan

    total = None
    if part is not None and garage is not None and garage.labour_lkr is not None:
        total = round(part.price_lkr + garage.labour_lkr, 0)

    plan.recommendation = Recommendation(
        garage_id=garage.id if garage else None,
        garage_name=garage.name if garage else None,
        part_id=part.id if part else None,
        part_name=part.name if part else None,
        garage_reason=garage_reason,
        how_its_done=how_its_done,
        sources=[r.passage.citation for r in retrieved] if how_its_done else [],
        estimated_total_lkr=total,
    )
    plan.source = "llm"
    return plan
