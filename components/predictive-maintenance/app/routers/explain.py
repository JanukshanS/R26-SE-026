"""Optional LLM layer that REWORDS advice. It never decides anything.

WHAT THIS IS FOR: `advice.py` produces correct, checkable, slightly mechanical
text. This turns it into something that reads like a person explaining the car
to its owner, and can weave in context the rules do not handle gracefully -
that most of this driver's mileage is stop-start city traffic, say, which is
why the pads went early.

WHAT IT IS NOT ALLOWED TO DO, and why the prompt and the response handling
both enforce it:

  * It does not decide urgency. That arrives already computed, and a model
    that occasionally downgrades "replace now" to "looks fine" on worn brakes
    is a safety defect, not a phrasing one.
  * It does not produce prices, part numbers or fitment. Those come from the
    catalogue and from what drivers actually paid. An invented price is a
    support ticket; an invented part number is a wasted trip to a garage.
  * It is never on the critical path. No key, no network, a timeout, a
    malformed reply - every one of those falls back to the deterministic text,
    which was always going to be shown if this failed anyway.

THE API KEY LIVES HERE, SERVER-SIDE, AND ONLY HERE. It must never reach the
mobile app: anything prefixed EXPO_PUBLIC_ is compiled into the JS bundle
inside the APK and is extractable by anyone who unpacks it. That is the same
reason the Supabase password was never put there either.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.advice import Advice

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_BASE = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

# Short: a driver is waiting on a screen, and a slow explanation is worse than
# a plain one. Past this we serve the deterministic text instead.
REQUEST_TIMEOUT_SEC = float(os.getenv("OPENAI_TIMEOUT_SEC", "8"))

# Caps the bill and keeps the answer to something readable on a phone.
MAX_OUTPUT_TOKENS = 320


class ExplainRequest(BaseModel):
    """Everything the model is allowed to see.

    Deliberately a narrow, already-computed summary rather than raw telemetry:
    the model's job is to phrase a conclusion, not to reach one, so it is given
    the conclusion and the few facts that justify it.
    """

    component: str
    urgency: str
    headline: str
    detail: str
    actions: List[str]
    reasons: List[str]
    is_estimated: bool = False

    # Optional colour that makes the wording specific to this driver.
    health_pct: Optional[float] = None
    predicted_rul_km: Optional[float] = None
    km_on_component: Optional[float] = None
    max_lifespan_km: Optional[int] = None
    dominant_driving: Optional[str] = None   # e.g. "city stop-start", "highway"
    observed_price_note: Optional[str] = None


class ExplainResponse(BaseModel):
    text: str
    # "llm" when the model answered, "fallback" when the deterministic text was
    # used. Surfaced so the UI can label it, and so a silent outage is visible
    # in logs rather than looking like the feature was never enabled.
    source: str
    model: Optional[str] = None


def _fallback_text(req: ExplainRequest) -> str:
    """The deterministic wording, assembled into one readable block."""
    parts = [req.headline, "", req.detail]
    if req.actions:
        parts.append("")
        parts.extend(f"- {a}" for a in req.actions)
    return "\n".join(parts).strip()


def _system_prompt() -> str:
    return (
        "You explain vehicle maintenance to ordinary drivers in Sri Lanka. "
        "You will receive a diagnosis that has ALREADY been decided by a "
        "predictive model. Your only job is to express it clearly and warmly.\n\n"
        "Rules, all of them absolute:\n"
        "1. Never change the urgency or contradict the diagnosis. If it says "
        "the part needs replacing now, your text must say so plainly.\n"
        "2. Never invent prices, part numbers, brands, torque figures, or "
        "specifications. If cost is not supplied, do not mention a number.\n"
        "3. Never claim something is safe or unsafe beyond what the diagnosis "
        "states.\n"
        "4. If the input says the figures are estimated, say so.\n"
        "5. Plain language, short sentences, no jargon dumps. Two short "
        "paragraphs at most, then the actions as a short list.\n"
        "6. Write for the car's owner, second person, no greeting or sign-off."
    )


def _user_prompt(req: ExplainRequest) -> str:
    facts: Dict[str, Any] = {
        "component": req.component,
        "urgency_decided_by_model": req.urgency,
        "headline": req.headline,
        "detail": req.detail,
        "recommended_actions": req.actions,
        "supporting_reasons": req.reasons,
        "figures_are_estimated": req.is_estimated,
    }
    if req.health_pct is not None:
        facts["health_percent"] = round(req.health_pct)
    if req.predicted_rul_km is not None:
        facts["remaining_life_km"] = round(req.predicted_rul_km)
    if req.km_on_component is not None:
        facts["km_since_fitted"] = round(req.km_on_component)
    if req.max_lifespan_km is not None:
        facts["expected_life_km"] = req.max_lifespan_km
    if req.dominant_driving:
        facts["typical_driving"] = req.dominant_driving
    if req.observed_price_note:
        facts["what_other_drivers_paid"] = req.observed_price_note

    return (
        "Rewrite this diagnosis for the driver. Use only these facts:\n\n"
        + json.dumps(facts, indent=2)
    )


@router.post("/explain", response_model=ExplainResponse)
async def explain(req: ExplainRequest) -> ExplainResponse:
    """Reword a diagnosis. Falls back to the supplied text on any failure."""
    if not OPENAI_API_KEY:
        # Not an error: the feature is simply not configured, and the caller
        # gets exactly what it would have shown anyway.
        return ExplainResponse(text=_fallback_text(req), source="fallback")

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
            resp = await client.post(
                f"{OPENAI_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_MODEL,
                    "messages": [
                        {"role": "system", "content": _system_prompt()},
                        {"role": "user", "content": _user_prompt(req)},
                    ],
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    # Low but not zero: enough variation to sound human,
                    # little enough to stay on the supplied facts.
                    "temperature": 0.4,
                },
            )
        if resp.status_code != 200:
            print(f"[explain] OpenAI returned {resp.status_code}; using fallback text")
            return ExplainResponse(text=_fallback_text(req), source="fallback")

        body = resp.json()
        text = (body["choices"][0]["message"]["content"] or "").strip()
        if not text:
            return ExplainResponse(text=_fallback_text(req), source="fallback")

        return ExplainResponse(text=text, source="llm", model=OPENAI_MODEL)

    except Exception as exc:  # noqa: BLE001 - any failure means fall back
        # Deliberately broad: a timeout, a DNS failure, a shape change in the
        # response all have the same correct handling, and none of them should
        # ever stop a driver seeing their diagnosis.
        print(f"[explain] falling back to deterministic text: {exc}")
        return ExplainResponse(text=_fallback_text(req), source="fallback")


@router.get("/explain/status")
def explain_status() -> Dict[str, Any]:
    """Whether the LLM layer is configured. Never returns the key itself."""
    return {
        "configured": bool(OPENAI_API_KEY),
        "model": OPENAI_MODEL if OPENAI_API_KEY else None,
        "note": (
            "Set OPENAI_API_KEY on the SERVER to enable. It must never be set "
            "as an EXPO_PUBLIC_* variable - those are compiled into the mobile "
            "bundle and are readable by anyone who unpacks the APK."
        ),
    }
