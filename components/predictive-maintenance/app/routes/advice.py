"""What to do about a component, in words a driver can act on.

THIS IS THE PIECE THAT WAS MISSING. `app/advice.py` could turn health figures
into a recommendation and `routes/explain.py` could reword one, but nothing
ever produced an Advice in the first place - `build_advice` was never called,
and /explain expected its caller to somehow already hold the diagnosis. The
mobile app cannot compute one: the thresholds, the oil-interval override and
the estimate disclosure all live here on purpose, so that a phone with a stale
bundle can never disagree with the server about whether a brake pad is
dangerous.

So this endpoint owns the whole path: read the same health the health screen
reads, decide, and optionally hand the decision to a language model to say more
warmly. The decision itself is never the model's - see routes/explain.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.advice import Advice, build_advice
from app.database import get_db
from app.routes.explain import ExplainRequest, explain
from app.routes.predict import vehicle_health
from app.services.marketplace_mapping import VALID_COMPONENTS

router = APIRouter()

# The health endpoint reports components under display names; the rest of the
# app keys them by these short forms.
_LABEL_TO_KEY = {
    "Engine": "engine",
    "Brake Pads": "brake",
    "Tires": "tire",
    "Battery": "battery",
}


class ComponentAdvice(BaseModel):
    """A recommendation, plus optional friendlier prose for the same thing."""

    advice: Advice
    # The LLM's wording when it was available, otherwise the deterministic text
    # assembled from the advice. Always populated, so a caller can render this
    # field alone and never has to decide what to do about a missing model.
    text: str
    # "llm" or "fallback". Surfaced so the UI can label AI-written prose, and
    # so a silent outage shows up in logs rather than looking like the feature
    # was never switched on.
    source: str


@router.get("/vehicle/{vehicle_id}/advice/{component}", response_model=ComponentAdvice)
async def component_advice(
    vehicle_id: str,
    component: str,
    request: Request,
    enhance: bool = Query(
        True,
        description="Ask the language model to reword. Falls back silently when "
        "unavailable; set false to force the deterministic text.",
    ),
    db: Session = Depends(get_db),
) -> ComponentAdvice:
    """Decide what the driver should do about one component."""
    key = component.lower().strip()
    if key not in VALID_COMPONENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"component must be one of: {', '.join(sorted(VALID_COMPONENTS))}",
        )

    # Reuse the health endpoint rather than recomputing. Two code paths that
    # both decide how worn a part is would eventually disagree, and the screen
    # would show a health figure that its own advice contradicts.
    health = vehicle_health(vehicle_id, request, db)

    match = next(
        (c for c in health.components if _LABEL_TO_KEY.get(c.component) == key),
        None,
    )
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No health data for {component} on {vehicle_id}.",
        )

    oil = health.engine_oil
    advice = build_advice(
        component=key,
        health_pct=match.health_pct,
        status=match.status,
        predicted_rul_km=match.predicted_rul_km,
        max_lifespan_km=match.max_lifespan_km,
        km_on_component=match.km_on_component,
        is_estimated=match.is_estimated,
        rul_source=match.rul_source,
        baseline_basis=match.baseline_basis,
        # Oil is a service interval rather than a wear life, and can make an
        # otherwise-healthy engine urgent.
        oil_overdue=bool(oil.is_overdue) if key == "engine" and oil else False,
        oil_km_remaining=oil.km_remaining if key == "engine" and oil else None,
    )

    if not enhance:
        return ComponentAdvice(advice=advice, text=_plain(advice), source="fallback")

    # The model only ever rewords what was decided above. It cannot change the
    # urgency, and any failure returns the same deterministic text.
    reworded = await explain(
        ExplainRequest(
            component=advice.component,
            urgency=advice.urgency,
            headline=advice.headline,
            detail=advice.detail,
            actions=advice.actions,
            reasons=advice.reasons,
            is_estimated=advice.is_estimated,
            health_pct=match.health_pct,
            predicted_rul_km=match.predicted_rul_km,
            km_on_component=match.km_on_component,
            max_lifespan_km=match.max_lifespan_km,
        )
    )
    return ComponentAdvice(advice=advice, text=reworded.text, source=reworded.source)


def _plain(advice: Advice) -> str:
    parts = [advice.headline, "", advice.detail]
    if advice.actions:
        parts.append("")
        parts.extend(f"- {a}" for a in advice.actions)
    return "\n".join(parts).strip()
