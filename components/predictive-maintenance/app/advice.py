"""Turning component health into something a driver can act on.

WHY THIS IS RULES AND NOT A LANGUAGE MODEL: the numbers here decide whether
someone keeps driving on worn brakes. A model that occasionally phrases
"replace these now" as "these look fine" is not a wording bug, it is a safety
one. So the DECISION - urgency, what to do, how soon - is computed here from
the same figures the health screen already shows: deterministically, offline,
and identically every time.

`routers/explain.py` may then hand this output to an LLM to phrase more warmly
for a specific driver. That layer can only ever REWORD what this module
decided; it is never asked what the driver should do, and the app falls back to
these strings verbatim whenever it is unavailable.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel

# Fractions of a component's OWN expected life at which each urgency begins.
#
# Not one shared kilometre threshold: 2,000 km left on brake pads (rated
# 40,000) is an urgent booking, while 2,000 km left on an engine (rated
# 150,000) means something quite different. Floors stop a short-lived part
# producing "book it this week" when only 40 km remain.
_URGENT_FRACTION = 0.05
_SOON_FRACTION = 0.15
_URGENT_FLOOR_KM = 500.0
_SOON_FLOOR_KM = 1500.0

# Human labels, kept out of the UI so the app and any LLM prompt agree.
_COMPONENT_LABEL = {
    "engine": "Engine",
    "brake": "Brake pads",
    "tire": "Tyres",
    "battery": "Battery",
}

# True when the label is grammatically plural, so headlines agree
# ("Brake pads need" vs "Engine needs").
_LABEL_IS_PLURAL = {
    "engine": False,
    "brake": True,
    "tire": True,
    "battery": False,
}

_ACTION_VERB = {
    "engine": "an engine service",
    "brake": "new brake pads",
    "tire": "new tyres",
    "battery": "a new battery",
}


class Advice(BaseModel):
    """A recommendation, plus the reasoning that produced it.

    `reasons` exists so the screen never states a conclusion it cannot justify.
    Every entry is derived from a value the driver can also see, which is what
    keeps the advice checkable rather than oracular.
    """

    component: str
    urgency: str            # critical | soon | monitor | healthy | unknown
    headline: str           # one line, safe to show on its own
    detail: str             # a short paragraph
    actions: List[str]      # concrete next steps, most important first
    reasons: List[str]      # why we concluded this
    # True when the underlying figures are inferred rather than measured, so
    # the UI can mark the whole card as an estimate instead of a finding.
    is_estimated: bool = False


def _km(value: Optional[float]) -> str:
    """Format kilometres the way the rest of the app does."""
    if value is None:
        return "unknown"
    if value >= 1000:
        return f"{value:,.0f} km"
    return f"{value:.0f} km"


def build_advice(
    component: str,
    health_pct: float,
    status: str,
    predicted_rul_km: float,
    max_lifespan_km: int,
    km_on_component: Optional[float] = None,
    is_estimated: Optional[bool] = None,
    rul_source: Optional[str] = None,
    baseline_basis: Optional[str] = None,
    oil_overdue: bool = False,
    oil_km_remaining: Optional[float] = None,
) -> Advice:
    """Decide what to tell the driver about one component.

    Every argument is a value the health endpoint already returns, so this adds
    interpretation without adding a second source of truth.
    """
    label = _COMPONENT_LABEL.get(component, component.title())
    needs = _ACTION_VERB.get(component, "a replacement")
    plural = _LABEL_IS_PLURAL.get(component, True)
    verb_need = "need" if plural else "needs"
    verb_are = "are" if plural else "is"
    reasons: List[str] = []
    estimated = bool(is_estimated)

    # ── No data ──────────────────────────────────────────────────────────
    if status == "No data":
        return Advice(
            component=component,
            urgency="unknown",
            headline=f"No readings for your {label.lower()} yet",
            detail=(
                "Nothing has been measured on this vehicle yet, so there is no "
                "health figure to report. Connect an OBD-II adapter and drive "
                "normally - a score appears once there are enough readings to "
                "mean anything."
            ),
            actions=[
                "Pair your OBD-II adapter from the home screen",
                "Drive as usual - trips record automatically once the engine starts",
            ],
            reasons=["No trips have been recorded for this vehicle."],
            is_estimated=False,
        )

    # ── Thresholds, relative to this component's own life ────────────────
    urgent_at = max(_URGENT_FLOOR_KM, max_lifespan_km * _URGENT_FRACTION)
    soon_at = max(_SOON_FLOOR_KM, max_lifespan_km * _SOON_FRACTION)

    if predicted_rul_km <= urgent_at:
        urgency = "critical"
    elif predicted_rul_km <= soon_at:
        urgency = "soon"
    elif health_pct < 60:
        urgency = "monitor"
    else:
        urgency = "healthy"

    # Engine oil is a service INTERVAL, not a wear life, so it can override an
    # otherwise-healthy engine: the engine is fine, the oil is not.
    if component == "engine" and oil_overdue:
        urgency = "critical" if urgency in ("healthy", "monitor") else urgency
        reasons.append("Engine oil is past its change interval.")
    elif component == "engine" and oil_km_remaining is not None and oil_km_remaining < 500:
        if urgency in ("healthy", "monitor"):
            urgency = "soon"
        reasons.append(f"Engine oil is due in about {_km(oil_km_remaining)}.")

    # ── Reasoning the driver can check against the numbers on screen ─────
    reasons.append(f"Health is {health_pct:.0f}% ({status}).")
    reasons.append(f"About {_km(predicted_rul_km)} of useful life remaining.")

    if km_on_component is not None:
        reasons.append(
            f"This part has covered {_km(km_on_component)} of its "
            f"{max_lifespan_km:,} km expected life."
        )

    # Being explicit about WHICH signal produced the number matters: the two can
    # disagree, and a driver who sees a figure move without explanation stops
    # trusting all of them.
    if rul_source == "wear":
        reasons.append("Based on distance covered since the part was fitted.")
    elif rul_source == "model":
        reasons.append("Based on sensor readings from your recent driving.")

    if estimated:
        reasons.append(
            "The fitting date was estimated, not recorded, so this is an "
            "approximation."
            if baseline_basis in ("inferred_schedule", "inferred_original")
            else "Some inputs are estimated, so treat this as approximate."
        )

    # ── What to actually do ──────────────────────────────────────────────
    if urgency == "critical":
        headline = f"{label} {verb_need} attention now"
        detail = (
            f"There is roughly {_km(predicted_rul_km)} of life left. Book "
            f"{needs} in the next few days rather than waiting for symptoms - "
            f"leaving it costs more once other parts start wearing too."
        )
        actions = [
            f"Book {needs} this week",
            "Compare prices and nearby garages below",
        ]
    elif urgency == "soon":
        headline = f"{label} will {verb_need if plural else 'need'} replacing soon"
        detail = (
            f"About {_km(predicted_rul_km)} remaining. Nothing is wrong today, "
            f"but this is the point to start planning - prices and appointment "
            f"slots are easier to choose when you are not stuck."
        )
        actions = [
            f"Plan for {needs} in the next month or two",
            "Check prices below so the cost is not a surprise",
        ]
    elif urgency == "monitor":
        headline = f"{label} {verb_are} wearing, but not urgent"
        detail = (
            f"Health is down to {health_pct:.0f}% with roughly "
            f"{_km(predicted_rul_km)} left. Worth keeping an eye on; no action "
            f"needed yet."
        )
        actions = ["Keep driving as normal", "Re-check after a few more trips"]
    elif urgency == "healthy":
        headline = f"{label} {verb_are} in good shape"
        detail = (
            f"Health is {health_pct:.0f}% with around {_km(predicted_rul_km)} "
            f"of life left. Nothing to do."
        )
        actions = ["No action needed"]
    else:
        headline = f"{label}: not enough information"
        detail = "There is not enough data yet to judge this component."
        actions = ["Record a few more trips"]

    # Oil gets its own concrete step, since "service the engine" is vaguer than
    # the thing actually needed.
    if component == "engine" and oil_overdue:
        actions.insert(0, "Change the engine oil - it is overdue")

    return Advice(
        component=component,
        urgency=urgency,
        headline=headline,
        detail=detail,
        actions=actions,
        reasons=reasons,
        is_estimated=estimated,
    )
