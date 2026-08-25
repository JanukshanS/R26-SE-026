from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.database import Base, SessionLocal, engine
from app.migrations import ensure_columns
from app.models import Part
from app.services.marketplace_mapping import parse_fitment, resolve_component


def seed(path: Path) -> None:
    entries = json.loads(path.read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)
    ensure_columns(engine, Part)
    now = datetime.now(timezone.utc).isoformat()

    db = SessionLocal()
    inserted = updated = skipped = 0
    unmapped: list[str] = []
    per_component: dict[str, int] = {}
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
        print("Run: python -m scripts.seed_parts data/parts.json")
        raise SystemExit(2)
    seed(Path(sys.argv[1]))
