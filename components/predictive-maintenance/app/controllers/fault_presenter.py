"""Turning stored codes into what the driver reads.

Kept apart from fault_controller (which owns the write path) because this is
where the catalogue is joined back on. The stored row holds only what was true
at read time - code, status, when. Titles, causes and consequences come from
the catalogue at RENDER time, so editing the catalogue improves every fault
already recorded rather than only new ones.
"""
from __future__ import annotations

import json
from typing import Dict, List, Optional

from app.models.fault import DTCEvent
from app.schemas.trip import FaultOut
from app.services.fault_catalogue import SEVERITIES, lookup


def to_out(row: DTCEvent) -> FaultOut:
    info = lookup(row.code)

    frame: Optional[Dict[str, float]] = None
    if row.freeze_frame:
        try:
            parsed = json.loads(row.freeze_frame)
            if isinstance(parsed, dict):
                frame = {k: v for k, v in parsed.items() if isinstance(v, (int, float))}
        except ValueError:
            frame = None

    leads_to: List[str] = []
    cost_multiplier: Optional[float] = None
    if info and info.leads_to:
        leads_to = [c.damage for c in info.leads_to]
        # The largest multiplier across consequences: the strongest reason to
        # act is the one worth quoting, not an average of several.
        multipliers = [c.cost_multiplier for c in info.leads_to if c.cost_multiplier]
        cost_multiplier = max(multipliers) if multipliers else None

    return FaultOut(
        code=row.code,
        title=info.title if info else f"Unrecognised code {row.code}",
        component=row.component,
        severity=row.severity,
        status=row.status,
        likely_causes=list(info.likely_causes) if info else [],
        leads_to=leads_to,
        cost_multiplier=cost_multiplier,
        first_seen_at=row.first_seen_at,
        last_seen_at=row.last_seen_at,
        times_seen=row.times_seen or 1,
        recurrences=row.recurrences or 0,
        is_generic=bool(info.is_generic) if info else True,
        freeze_frame=frame,
    )


# How a fault severity maps onto the urgency vocabulary in app/advice.py.
_SEVERITY_TO_URGENCY = {"urgent": "critical", "soon": "soon", "monitor": "monitor"}

_URGENCY_RANK = {"unknown": 0, "healthy": 1, "monitor": 2, "soon": 3, "critical": 4}


def escalated_urgency(wear_urgency: str, faults: List[FaultOut]) -> str:
    """The higher of the wear urgency and anything the faults demand.

    WHY ESCALATE URGENCY BUT NOT HEALTH. health_pct means "how much life is
    left", and a misfire does not consume brake pad life - moving that number
    would corrupt the only figure the wear model is entitled to state. But a
    component with a live urgent fault is not "Good" in any sense the driver
    cares about, so the urgency, which is what the screen shouts with, does
    move. This mirrors the existing overdue-oil override in app/advice.py
    rather than inventing a second mechanism.
    """
    best = wear_urgency
    for fault in faults:
        candidate = _SEVERITY_TO_URGENCY.get(fault.severity)
        if candidate and _URGENCY_RANK.get(candidate, 0) > _URGENCY_RANK.get(best, 0):
            best = candidate
    return best


def sort_faults(faults: List[FaultOut]) -> List[FaultOut]:
    """Most serious first, then most recently seen."""
    order = {level: i for i, level in enumerate(SEVERITIES)}
    return sorted(
        faults,
        key=lambda f: (order.get(f.severity, len(SEVERITIES)), f.last_seen_at or ""),
    )
