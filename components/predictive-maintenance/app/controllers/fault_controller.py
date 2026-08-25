"""Recording trouble codes as they come and go, and reporting the live ones.

THE CENTRAL RULE HERE: an empty list of codes is not the same thing as a
healthy car. A dongle that failed to answer, a trip recorded before the code
read was added, or an adapter that does not support mode 03 all produce no
codes - and treating any of them as "no faults" would clear a real fault off
the screen and tell the driver everything was fine.

So resolution only ever happens on a read the client explicitly confirmed
succeeded (`dtc_read_ok`). Without that flag, this module can add codes and
refresh existing ones, but it will never close one.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.fault import DTCEvent
from app.services.fault_catalogue import FaultInfo, SEVERITIES, lookup

# A pending code that keeps failing eventually confirms. Until it does it is
# reported, but never at the severity its confirmed form would carry - it has
# failed one drive cycle, which is a reason to watch rather than to act.
_PENDING_CEILING = "soon"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _capped_severity(info: Optional[FaultInfo], status: str) -> str:
    """Severity for this sighting, held down while the code is only pending."""
    base = info.severity if info else "monitor"
    if status != "pending":
        return base
    # Take whichever is less alarming: the catalogue value or the ceiling.
    order = {level: i for i, level in enumerate(SEVERITIES)}
    return base if order[base] > order[_PENDING_CEILING] else _PENDING_CEILING


def record_codes(
    db: Session,
    *,
    vehicle_id: str,
    trip_id: Optional[str],
    codes: Sequence[dict],
    read_ok: bool,
    odometer_km: Optional[float] = None,
    freeze_frames: Optional[Dict[str, dict]] = None,
) -> Dict[str, int]:
    """Fold one trip's codes into the stored state.

    `codes` is a sequence of {"code": "P0301", "status": "confirmed"}.
    Returns counts of what changed, for the ingest log line.

    Nothing here raises on bad input: a malformed code is skipped. A trip
    upload must never fail because the diagnostics half of the payload was
    strange, since the trip itself is the thing the driver actually recorded.
    """
    now = _now()
    seen_codes: set[str] = set()
    opened = refreshed = returned = resolved = 0

    for entry in codes or []:
        raw = str((entry or {}).get("code") or "").strip().upper()
        info = lookup(raw)
        if info is None:
            continue

        status = str((entry or {}).get("status") or "confirmed").strip().lower()
        if status not in ("confirmed", "pending", "permanent"):
            status = "confirmed"

        seen_codes.add(raw)
        frame = (freeze_frames or {}).get(raw)

        row = (
            db.query(DTCEvent)
            .filter(DTCEvent.vehicle_id == vehicle_id, DTCEvent.code == raw)
            .order_by(DTCEvent.id.desc())
            .first()
        )

        if row is None:
            db.add(
                DTCEvent(
                    vehicle_id=vehicle_id,
                    code=raw,
                    status=status,
                    component=info.component,
                    severity=_capped_severity(info, status),
                    first_seen_at=now,
                    last_seen_at=now,
                    times_seen=1,
                    recurrences=0,
                    first_trip_id=trip_id,
                    last_trip_id=trip_id,
                    freeze_frame=json.dumps(frame) if frame else None,
                    first_seen_km=odometer_km,
                )
            )
            opened += 1
            continue

        if row.resolved_at is not None:
            # It came back. Reopening the same row rather than starting a
            # fresh one is what preserves the history that makes recurrence
            # visible at all.
            row.resolved_at = None
            row.recurrences = (row.recurrences or 0) + 1
            returned += 1
        else:
            refreshed += 1

        row.status = status
        row.severity = _capped_severity(info, status)
        row.component = info.component
        row.last_seen_at = now
        row.last_trip_id = trip_id
        row.times_seen = (row.times_seen or 0) + 1
        if frame and not row.freeze_frame:
            # Keep the FIRST frame: it describes the conditions that caused the
            # fault, which a later snapshot of a recurring fault does not.
            row.freeze_frame = json.dumps(frame)

    # Only a confirmed-good read may close a fault. See the module docstring.
    if read_ok:
        open_rows = (
            db.query(DTCEvent)
            .filter(DTCEvent.vehicle_id == vehicle_id, DTCEvent.resolved_at.is_(None))
            .all()
        )
        for row in open_rows:
            if row.code not in seen_codes:
                row.resolved_at = now
                resolved += 1

    db.commit()
    return {
        "opened": opened,
        "refreshed": refreshed,
        "returned": returned,
        "resolved": resolved,
    }


def active_faults(db: Session, vehicle_id: str) -> List[DTCEvent]:
    """Live faults, most serious first, then most recently seen."""
    rows = (
        db.query(DTCEvent)
        .filter(DTCEvent.vehicle_id == vehicle_id, DTCEvent.resolved_at.is_(None))
        .all()
    )
    order = {level: i for i, level in enumerate(SEVERITIES)}
    rows.sort(key=lambda r: (order.get(r.severity, len(SEVERITIES)), r.last_seen_at or ""))
    return rows


def faults_by_component(db: Session, vehicle_id: str) -> Dict[str, List[DTCEvent]]:
    """Live faults grouped by the component they belong to."""
    grouped: Dict[str, List[DTCEvent]] = {}
    for row in active_faults(db, vehicle_id):
        grouped.setdefault(row.component, []).append(row)
    return grouped


def history(db: Session, vehicle_id: str, limit: int = 50) -> List[DTCEvent]:
    """Everything ever recorded, live and resolved, newest first."""
    return (
        db.query(DTCEvent)
        .filter(DTCEvent.vehicle_id == vehicle_id)
        .order_by(DTCEvent.last_seen_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
