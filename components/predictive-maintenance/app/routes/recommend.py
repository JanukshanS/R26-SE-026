"""Compare the real options and recommend one, with reasons.

WHAT THE MODEL IS DOING HERE, AND WHY IT IS A GOOD FIT: weighing five garages
against distance, rating, opening hours and labour cost, alongside three parts
at different prices and warranties, is genuinely hard to express as a scoring
rule and easy to explain in a sentence. Ranking by distance alone sends a
driver to a 2.1-star workshop; ranking by rating alone sends them across the
country. So the model gets the whole picture and argues for one option.

It also writes the one thing no rules engine here can: a plain description of
what the mechanic will actually do, which is general automotive knowledge
rather than a claim about this driver's data.

WHAT KEEPS IT HONEST:

  * It chooses from a CANDIDATE SET we supply. It is never asked what garages
    exist, only which of these is best.
  * Every id it returns is checked against that set before we believe it. A
    hallucinated garage is dropped and the response degrades to the ranked
    list, which is what would have been shown anyway.
  * Prices, distances and ratings come from the same objects the screen
    renders, so a driver can check the argument against the cards beneath it.
  * It still does not decide URGENCY. That arrives already computed from
    app/advice.py and is passed in as a fact.

The recommendation is therefore an OPINION ABOUT SUPPLIED FACTS, which a model
is good at, rather than a claim about the world, which it is not.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.advice import Advice, build_advice
from app.controllers.marketplace_controller import get_component_marketplace
from app.database import get_db
from app.routes.advice import _LABEL_TO_KEY, _plain
from app.routes.explain import _api_key, _base_url, _model
from app.schemas.marketplace import GarageOut, PartOut, PriceInsight
from app.services.knowledge import build_query, format_for_prompt, get_index
from app.routes.predict import vehicle_health
from app.services.marketplace_mapping import VALID_COMPONENTS

router = APIRouter()

# Longer than the plain rewording call: there is more to read and an actual
# comparison to make. Still bounded - a driver is waiting.
RECOMMEND_TIMEOUT_SEC = float(os.getenv("OPENAI_RECOMMEND_TIMEOUT_SEC", "20"))
MAX_OUTPUT_TOKENS = 600


class Recommendation(BaseModel):
    """The model's pick, with every reference validated against real rows."""

    garage_id: Optional[str] = None
    garage_name: Optional[str] = None
    part_id: Optional[str] = None
    part_name: Optional[str] = None
    # ONE sentence on why this garage beat the others, referring only to
    # supplied facts. Deliberately short: the screen renders it as the subtitle
    # of a "Best garage" card, not as a paragraph.
    garage_reason: str = ""
    # What the mechanic will physically do, in plain words. This is the part of
    # the answer a rules engine cannot produce - it is general automotive
    # knowledge rather than a claim about this driver's data - and it is the
    # thing a driver most often does not know when handing over the keys.
    # Framed as what a professional does, never as DIY instructions.
    how_its_done: str = ""
    # Which knowledge base passages the repair description was written from.
    # Empty when retrieval found nothing or was unavailable, in which case
    # how_its_done is the model's own knowledge and the UI says so.
    sources: List[str] = []
    # Part price plus that garage's labour, when both are known. None rather
    # than a guess - a fabricated total is worse than no total.
    estimated_total_lkr: Optional[float] = None


class ComponentPlan(BaseModel):
    """Everything the driver needs: the diagnosis, the options, and a pick."""

    advice: Advice
    text: str
    source: str
    parts: List[PartOut] = []
    garages: List[GarageOut] = []
    observed_prices: Optional[PriceInsight] = None
    # Absent when the model was unavailable or named something that does not
    # exist. The options above still stand on their own.
    recommendation: Optional[Recommendation] = None


def _system_prompt() -> str:
    """The model's whole brief.

    It writes exactly two things, and neither of them is the diagnosis. Rule 7
    is load-bearing: the driver is looking at the headline, the reasons and the
    action list on the same screen, so a model that opens by restating "your
    brake pads are worn" has spent its only two sentences telling them what
    they just read.
    """
    return "\n".join(
        [
            "You help drivers in Sri Lanka decide where to get a vehicle repair "
            "done. You are given a diagnosis that is ALREADY DECIDED, plus a "
            "list of real parts and real garages.",
            "",
            "You produce exactly two short pieces of writing.",
            "",
            "garage_reason: ONE sentence saying why the garage you picked is "
            "the best of the ones listed. Weigh distance, rating, opening hours "
            "and labour cost against each other, and name the actual trade-off "
            "when there is one - a closer garage that is rated lower, a cheaper "
            "part with a shorter warranty. Address the driver as 'you'.",
            "",
            "how_its_done: TWO OR THREE sentences describing what the mechanic "
            "will physically do during this job, and roughly how long it takes. "
            "This is so the driver understands what they are paying for and can "
            "tell whether the work was actually done. Write it as what a "
            "professional does, NOT as instructions for the driver to follow "
            "themselves. Plain words, and explain any term a driver would not "
            "already know.",
            "",
            "Absolute rules:",
            "1. Only ever reference garages and parts from the supplied lists, "
            "by their exact id. Never name a business or product not listed.",
            "2. Never invent or estimate a price, distance or rating. Use only "
            "the numbers given.",
            "3. Never change the urgency of the diagnosis or contradict it.",
            "4. If a distance is marked approximate, do not present it as exact.",
            "5. If the lists are empty, say so and recommend nothing.",
            "6. Do not claim a detail is missing when it was given to you. A "
            "field that has a value must be described accurately - if a part "
            "lists a 12 month warranty then it HAS a warranty. Only a field "
            "that is null may be called 'not stated', and 'not stated' never "
            "means 'does not have'. Never use an absence you invented as a "
            "reason for your choice.",
            "7. If REFERENCE MATERIAL is supplied below, how_its_done must be "
            "written FROM IT and must not contradict it. Prefer its wording for "
            "anything technical. If it does not cover something, leave that out "
            "rather than filling the gap from memory. When no reference material "
            "is supplied, answer from general knowledge as usual.",
            "8. DO NOT REPEAT THE DIAGNOSIS. The driver is already reading the "
            "headline, the reasons and the list of actions on the same screen, "
            "directly above your words. Restating that the part is worn, or how "
            "urgent it is, wastes the only two sentences you have. Assume they "
            "know what is wrong and have decided to fix it.",
            "",
            "Reply with JSON only, no prose outside it:",
            '{"garage_id": "<id or null>", "part_id": "<id or null>", '
            '"garage_reason": "<one sentence>", '
            '"how_its_done": "<two or three sentences>"}',
        ]
    )




def _facts(
    advice: Advice,
    parts: List[PartOut],
    garages: List[GarageOut],
    prices: Optional[PriceInsight],
    readings: Dict[str, Any],
    has_location: bool,
    reference: str = "",
) -> str:
    """Everything the model may use. Nothing else is in scope."""
    payload: Dict[str, Any] = {
        "diagnosis": {
            "component": advice.component,
            "urgency_already_decided": advice.urgency,
            "headline": advice.headline,
            "figures_are_estimated": advice.is_estimated,
        },
        "vehicle_readings": readings,
        "driver_location_known": has_location,
        "parts_available": [
            {
                "id": p.id,
                "name": p.name,
                "brand": p.brand,
                "price_lkr": p.price_lkr,
                "grade": p.grade,
                "warranty": p.warranty,
                "in_stock": p.in_stock,
                "rating": p.rating,
                "supplier": p.supplier,
                "fits": p.fits_note,
            }
            for p in parts
        ],
        "garages_available": [
            {
                "id": g.id,
                "name": g.name,
                "city": g.city,
                "distance_km": g.distance_km,
                "distance_is_approximate": bool(g.coords_are_city_level),
                "rating": g.rating,
                "reviews": g.review_count,
                "labour_lkr": g.labour_lkr,
                "opening_hours": g.opening_hours,
                "verified": g.verified,
                "speciality": g.speciality,
                "mechanics": g.mechanics,
            }
            for g in garages
        ],
    }
    if prices and prices.is_reliable:
        payload["what_other_drivers_paid_lkr"] = {
            "low": prices.low_lkr,
            "typical": prices.median_lkr,
            "high": prices.high_lkr,
            "based_on_services": prices.sample_size,
        }
    facts = json.dumps(payload, indent=2, default=str)
    if not reference:
        return facts

    # Appended as plain text rather than folded into the JSON: it is prose to
    # be read and written from, not another field to be reasoned over, and
    # keeping it visibly separate makes the boundary obvious to the model.
    return "\n\n".join(
        [
            facts,
            "REFERENCE MATERIAL (write how_its_done from these passages):",
            reference,
        ]
    )


async def _ask_model(prompt_facts: str) -> Optional[Dict[str, Any]]:
    """Return the parsed JSON reply, or None on any failure."""
    api_key = _api_key()
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=RECOMMEND_TIMEOUT_SEC) as client:
            resp = await client.post(
                f"{_base_url()}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _model(),
                    "messages": [
                        {"role": "system", "content": _system_prompt()},
                        {"role": "user", "content": prompt_facts},
                    ],
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    # Near-zero on purpose. This weighs supplied numbers against
                    # each other, so variation buys nothing and risks misreading
                    # one of them - at 0.3 it argued that a part had no warranty
                    # while a 12 month warranty sat in its own input.
                    "temperature": 0.1,
                    # Guarantees parseable output instead of prose wrapped in
                    # backticks, which would otherwise need unwrapping.
                    "response_format": {"type": "json_object"},
                },
            )
        if resp.status_code != 200:
            print(f"[recommend] OpenAI returned {resp.status_code}; no recommendation")
            return None
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as exc:  # noqa: BLE001 - every failure degrades the same way
        print(f"[recommend] unavailable, returning ranked options only: {exc}")
        return None


@router.get("/vehicle/{vehicle_id}/plan/{component}", response_model=ComponentPlan)
async def component_plan(
    vehicle_id: str,
    component: str,
    request: Request,
    lat: Optional[float] = Query(None, description="Driver latitude, to rank garages"),
    lon: Optional[float] = Query(None, description="Driver longitude"),
    vehicle: Optional[str] = Query(None, description='Fitment filter, e.g. "Toyota Aqua"'),
    recommend: bool = Query(True, description="Ask the model to pick one. False returns options only."),
    db: Session = Depends(get_db),
) -> ComponentPlan:
    """Diagnosis, real options, and a recommendation among them."""
    key = component.lower().strip()
    if key not in VALID_COMPONENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"component must be one of: {', '.join(sorted(VALID_COMPONENTS))}",
        )

    health = vehicle_health(vehicle_id, request, db)
    match = next((c for c in health.components if _LABEL_TO_KEY.get(c.component) == key), None)
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
        oil_overdue=bool(oil.is_overdue) if key == "engine" and oil else False,
        oil_km_remaining=oil.km_remaining if key == "engine" and oil else None,
    )

    # The same ranked, fitment-filtered options the screen shows. The model
    # compares what the driver can see, never a different list.
    market = get_component_marketplace(
        db, key, lat=lat, lon=lon, vehicle=vehicle, limit_parts=8, limit_garages=6
    )

    plan = ComponentPlan(
        advice=advice,
        text=_plain(advice),
        source="fallback",
        parts=market.parts,
        garages=market.garages,
        observed_prices=market.observed_prices,
    )

    if not recommend or (not market.parts and not market.garages):
        return plan

    readings = {
        "health_percent": round(match.health_pct),
        "remaining_life_km": round(match.predicted_rul_km),
        "expected_life_km": match.max_lifespan_km,
        "km_since_fitted": round(match.km_on_component) if match.km_on_component is not None else None,
        "total_vehicle_km": round(health.total_mileage_km) if health.total_mileage_km else None,
        "trips_recorded": health.trip_count,
    }

    # ── Retrieval ────────────────────────────────────────────────────────
    # The repair description was the one ungrounded claim on this screen.
    # Passages come from a corpus we wrote and can point at, and the response
    # names which ones it used, so a driver can check the guidance the same way
    # they can already check the garage and the price.
    #
    # Wrapped because a knowledge base is an enhancement, not a dependency: any
    # failure here must cost the citations, never the recommendation.
    retrieved = []
    try:
        retrieved = get_index().search(
            build_query(
                component=key,
                urgency=advice.urgency,
                headline=advice.headline,
                vehicle=vehicle,
                part_name=market.parts[0].name if market.parts else None,
            ),
            component=key,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[recommend] knowledge retrieval failed, continuing without: {exc}")

    reply = await _ask_model(
        _facts(advice, market.parts, market.garages, market.observed_prices, readings,
               has_location=lat is not None and lon is not None,
               reference=format_for_prompt(retrieved))
    )
    if not reply:
        return plan

    # ── Validate every reference before believing any of it ──────────────
    # A model that names a garage we did not supply has left the data and is
    # guessing. Dropping the id rather than the whole reply keeps a useful
    # reason when only the pick was wrong.
    garages_by_id = {g.id: g for g in market.garages}
    parts_by_id = {p.id: p for p in market.parts}

    gid = reply.get("garage_id")
    pid = reply.get("part_id")
    garage = garages_by_id.get(str(gid)) if gid else None
    part = parts_by_id.get(str(pid)) if pid else None

    if gid and not garage:
        print(f"[recommend] model named unknown garage {gid!r} - dropped")
    if pid and not part:
        print(f"[recommend] model named unknown part {pid!r} - dropped")

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
        # Only claim a source when there was one AND the model wrote something
        # to attribute to it. Citing passages beside an empty field would be a
        # provenance claim about text that does not exist.
        sources=[r.passage.citation for r in retrieved] if how_its_done else [],
        estimated_total_lkr=total,
    )
    plan.source = "llm"
    return plan
