"""Load the supplied garage directory into the `garages` table.

Run:  python -m scripts.seed_garages data/garages.json

TWO THINGS THE SOURCE DATA DOES NOT CONTAIN, and how each is handled:

COORDINATES. The directory gives an address and a city but no latitude or
longitude, and distance ranking needs them. Rather than invent per-address
coordinates, each garage is placed at its CITY CENTRE and flagged
`coords_are_city_level = 1`. That is enough to answer "which of these is
nearest me", which is all the ranking claims to do, and the flag stops the UI
implying door-to-door precision it does not have. Geocoding the actual street
addresses later would only need this column set back to 0.

LABOUR COST. Not supplied, so it stays NULL. The marketplace endpoint already
treats a missing labour figure as "ask the garage" and omits it from the
estimated total, which is the honest outcome - a fabricated fitting charge
would be indistinguishable on screen from a real quote.

The script is idempotent: re-running it updates existing rows by id rather
than duplicating them, so a corrected directory can simply be re-applied.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from app.database import Base, SessionLocal, engine
from app.migrations import ensure_columns
from app.models import Garage

# City centres, to a few decimal places. Public reference points, not invented
# per-garage positions - see the note above.
CITY_COORDS: Dict[str, tuple[float, float]] = {
    "colombo": (6.9271, 79.8612),
    "matara": (5.9485, 80.5353),
    "kandy": (7.2906, 80.6337),
    "galle": (6.0535, 80.2210),
    "hambantota": (6.1241, 81.1185),
    "nuwara eliya": (6.9497, 80.7891),
    "negombo": (7.2083, 79.8358),
    "matale": (7.4675, 80.6234),
}

# Maps the garage's own service wording onto the four components this app
# models. Deliberately explicit rather than fuzzy-matched: a driver sent to a
# garage that cannot actually do the job has wasted a trip, so every phrase
# here was read and mapped by hand.
#
# Entries that map to nothing are intentional. "AC Repair", "Transmission
# Repair", "Suspension Repair" and "Wheel Alignment" are real services this
# app has no health model for, so they are shown to the driver via
# `services_raw` but never used to claim the garage can replace brake pads.
SERVICE_TO_COMPONENT: Dict[str, List[str]] = {
    # engine
    "oil change": ["engine"],
    "engine repair": ["engine"],
    "engine service": ["engine"],
    "engine overhaul": ["engine"],
    "diesel repair": ["engine"],
    "general repair": ["engine"],
    # brake
    "brake service": ["brake"],
    "brake repair": ["brake"],
    # tire
    "tyre service": ["tire"],
    "tire service": ["tire"],
    # battery
    "battery service": ["battery"],
    "battery repair": ["battery"],
    "ev diagnostics": ["battery"],
    "hybrid diagnostics": ["battery"],
    "hybrid repair": ["battery", "engine"],
    "electrical repair": ["battery"],
    "electrical service": ["battery"],
}


def map_services(names: List[str]) -> List[str]:
    """Component keys this garage can actually work on."""
    out: List[str] = []
    for raw in names:
        for key in SERVICE_TO_COMPONENT.get(raw.strip().lower(), []):
            if key not in out:
                out.append(key)
    return out


def seed(path: Path) -> None:
    entries = json.loads(path.read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)
    # create_all makes MISSING TABLES but never adds a column to a table
    # that already exists, and this table may predate the newer columns
    # (an earlier server start would have created it). Same additive
    # guard the service runs on boot.
    ensure_columns(engine, Garage)
    now = datetime.now(timezone.utc).isoformat()

    db = SessionLocal()
    inserted = updated = 0
    unmapped: set[str] = set()
    try:
        for e in entries:
            loc = e.get("location", {}) or {}
            city = (loc.get("city") or "").strip()
            coords = CITY_COORDS.get(city.lower())
            if coords is None:
                print(f"  ! no coordinates known for city {city!r} "
                      f"({e.get('name')}) - stored without a position")

            raw_services = e.get("services", []) or []
            components = map_services(raw_services)
            for raw in raw_services:
                if raw.strip().lower() not in SERVICE_TO_COMPONENT:
                    unmapped.add(raw)

            if not components:
                print(f"  ! {e.get('name')!r} maps to no serviceable component "
                      f"- it will not appear for any component")

            gid = str(e["id"])
            row = db.get(Garage, gid)
            if row is None:
                row = Garage(id=gid)
                db.add(row)
                inserted += 1
            else:
                updated += 1

            row.name = e.get("name")
            row.address = loc.get("address")
            row.city = city or None
            row.area = loc.get("area")
            row.latitude = coords[0] if coords else None
            row.longitude = coords[1] if coords else None
            row.coords_are_city_level = 1 if coords else 0
            row.phone = e.get("phone")
            row.email = e.get("email")
            row.services = ",".join(components) if components else None
            row.services_raw = ", ".join(raw_services) if raw_services else None
            row.speciality = ", ".join(e.get("speciality", []) or []) or None
            row.mechanics = e.get("mechanics")
            row.review_count = e.get("reviews")
            row.rating = e.get("rating")
            row.opening_hours = e.get("opening_hours")
            row.verified = 1 if e.get("is_verified") else 0
            # Not supplied by the directory. Left NULL on purpose.
            row.labour_lkr = None
            row.updated_at = now

        db.commit()
    finally:
        db.close()

    print(f"\nSeeded {inserted} new, updated {updated} existing garage(s).")
    if unmapped:
        print("\nService names with no component mapping (shown to drivers, "
              "but not used for matching):")
        for name in sorted(unmapped):
            print(f"  - {name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    seed(Path(sys.argv[1]))
