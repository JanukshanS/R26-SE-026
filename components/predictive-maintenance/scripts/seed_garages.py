from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.database import Base, SessionLocal, engine
from app.migrations import ensure_columns
from app.models import Garage
from app.services.marketplace_mapping import (
    SERVICE_TO_COMPONENT,
    map_garage_services,
    resolve_coords,
)


def seed(path: Path) -> None:
    entries = json.loads(path.read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)
    ensure_columns(engine, Garage)
    now = datetime.now(timezone.utc).isoformat()

    db = SessionLocal()
    inserted = updated = 0
    unmapped: set[str] = set()
    try:
        for e in entries:
            loc = e.get("location", {}) or {}
            city = (loc.get("city") or "").strip()
            area = (loc.get("area") or "").strip()
            # Suburb first, city only as a fallback: within greater Colombo the
            # city centroid puts every workshop at the same point, which makes
            # every distance zero and the ranking meaningless.
            coords, city_level = resolve_coords(city, area)
            if coords is None:
                print(f"  ! no coordinates known for {area or city!r} "
                      f"({e.get('name')}) - stored without a position")
            elif city_level and area:
                print(f"  . {e.get('name')}: no suburb position for {area!r}, "
                      f"using {city} centre (distances will be approximate)")

            raw_services = e.get("services", []) or []
            components = map_garage_services(raw_services)
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
            row.coords_are_city_level = 1 if (coords and city_level) else 0
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
        print("Run: python -m scripts.seed_garages data/garages.json")
        raise SystemExit(2)
    seed(Path(sys.argv[1]))
