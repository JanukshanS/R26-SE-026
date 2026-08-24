"""Load the supplied parts catalogue into the `parts` table.

Run:  python -m scripts.seed_parts data/parts.json

THE MAPPING IS THE WHOLE JOB. A supplier feed is organised by what it sells
("Filters", "Electrical", "AC & Cooling"); this app is organised by the four
components it can predict wear for. The two do not line up, and the failure
mode of guessing is a driver being shown an irrelevant part for a component
they are worried about.

So `CATEGORY_TO_COMPONENT` is deliberately narrow and hand-checked, and
anything it does not recognise is REPORTED and stored without a component
rather than filed under a plausible-looking one. A cabin air filter is not an
engine part; an OBD scanner is not a part at all.

FITMENT MATTERS AS MUCH AS CATEGORY. Nearly every row names the models it
fits, and suggesting Honda City brake pads to a Toyota Aqua owner is worse
than suggesting nothing. Model names are stored lowercased in `fits_models`
for matching; rows that fit a whole marque ("Toyota Vehicles") set
`fits_any_model` so they can match loosely without that looseness applying to
model-specific parts.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from app.database import Base, SessionLocal, engine
from app.migrations import ensure_columns
from app.models import Part

# Supplier category -> the component this app models.
#
# Only mappings that are unambiguous appear here. Notable exclusions and why:
#   Suspension, AC & Cooling  - real parts, but no wear model for them
#   Diagnostics               - a tool, not a part for any component
# "Filters" and "Electrical" are absent on purpose: both contain a mix (a
# cabin filter is not an engine part, an alternator is not a battery), so they
# are decided per-item by NAME_OVERRIDES below.
CATEGORY_TO_COMPONENT: Dict[str, str] = {
    "brakes": "brake",
    "batteries": "battery",
    "engine parts": "engine",
    "lubricants": "engine",
    "tyres": "tire",
    "tires": "tire",
}

# Decided by product name where the category alone is not enough. Matched as a
# substring against the lowercased name, first hit wins, so order matters.
NAME_OVERRIDES: List[tuple[str, Optional[str]]] = [
    # A cabin filter cleans the air the PASSENGERS breathe. Filing it under
    # engine would offer it to a driver worried about engine wear.
    ("cabin air filter", None),
    ("cabin filter", None),
    # Oil and engine-air filters genuinely are engine servicing items.
    ("oil filter", "engine"),
    ("air filter", "engine"),
    ("spark plug", "engine"),
    ("engine oil", "engine"),
    # An alternator charges the battery, and a failing one presents exactly as
    # a battery problem to a driver - which is the moment they would be
    # looking at this screen.
    ("alternator", "battery"),
]


def resolve_component(name: str, category: str) -> Optional[str]:
    lowered = name.lower()
    for needle, component in NAME_OVERRIDES:
        if needle in lowered:
            return component
    return CATEGORY_TO_COMPONENT.get(category.strip().lower())


def parse_fitment(entries: List[str]) -> tuple[str, bool]:
    """Return (comma-joined lowercase models, fits_any_model).

    A listing like "Toyota Vehicles" or "OBD-II Compatible Vehicles" describes
    a marque or a standard rather than named models, and must not be treated
    as an exact-model match.
    """
    models: List[str] = []
    any_model = False
    for raw in entries or []:
        value = raw.strip().lower()
        if not value:
            continue
        if value.endswith(" vehicles") or "compatible" in value:
            any_model = True
            # Keep the marque itself so "Toyota Vehicles" can still be
            # restricted to Toyotas rather than matching every car.
            models.append(value.replace(" vehicles", "").strip())
        else:
            models.append(value)
    return ",".join(models), any_model


def seed(path: Path) -> None:
    entries = json.loads(path.read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)
    # create_all makes MISSING TABLES but never adds a column to a table
    # that already exists, and this table may predate the newer columns
    # (an earlier server start would have created it). Same additive
    # guard the service runs on boot.
    ensure_columns(engine, Part)
    now = datetime.now(timezone.utc).isoformat()

    db = SessionLocal()
    inserted = updated = skipped = 0
    unmapped: List[str] = []
    per_component: Dict[str, int] = {}
    try:
        for e in entries:
            name = e.get("name", "")
            category = e.get("category", "")
            component = resolve_component(name, category)

            if component is None:
                unmapped.append(f"{name}  [{category}]")
                skipped += 1
                continue

            currency = (e.get("currency") or "LKR").upper()
            if currency != "LKR":
                # Storing a foreign amount in a column named price_lkr would
                # quietly misprice the part everywhere it is shown.
                print(f"  ! {name!r} priced in {currency}, not LKR - skipped")
                skipped += 1
                continue

            fits_models, fits_any = parse_fitment(e.get("vehicle_compatibility", []))
            condition = (e.get("condition") or "").strip().lower()

            pid = str(e["id"])
            row = db.get(Part, pid)
            if row is None:
                row = Part(id=pid)
                db.add(row)
                inserted += 1
            else:
                updated += 1

            row.component = component
            row.name = name
            row.brand = e.get("brand")
            row.part_number = e.get("part_number")
            row.category = category
            row.price_lkr = float(e.get("price") or 0.0)
            # The feed's "New"/"Refurbished" maps onto the same original/used
            # distinction service_records already records for fitted parts.
            row.grade = {"new": "original", "refurbished": "used"}.get(condition, condition or None)
            row.supplier = e.get("seller")
            row.fits_note = ", ".join(e.get("vehicle_compatibility", []) or []) or None
            row.fits_models = fits_models or None
            row.fits_any_model = 1 if fits_any else 0
            row.stock_count = e.get("stock")
            row.in_stock = 1 if (e.get("stock") or 0) > 0 else 0
            row.rating = e.get("rating")
            row.review_count = e.get("reviews")
            row.warranty = e.get("warranty")
            row.updated_at = now

            per_component[component] = per_component.get(component, 0) + 1

        db.commit()
    finally:
        db.close()

    print(f"\nSeeded {inserted} new, updated {updated}, skipped {skipped}.")
    print("\nParts per component:")
    for comp in ("engine", "brake", "tire", "battery"):
        count = per_component.get(comp, 0)
        flag = "   <-- nothing to offer for this component" if count == 0 else ""
        print(f"  {comp:8s} {count}{flag}")

    if unmapped:
        print("\nNot stored - no component this app models:")
        for line in unmapped:
            print(f"  - {line}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    seed(Path(sys.argv[1]))
