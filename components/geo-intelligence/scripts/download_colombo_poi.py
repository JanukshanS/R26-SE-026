"""Download sensitive-location POIs for the Colombo metro area from OpenStreetMap.

Fetches hospitals, schools, marketplaces, and bridge segments via the Overpass
API and writes them to data/poi/colombo_poi.json for the sensitivity overlay
(src/sensitivity.py). Stdlib only — no third-party dependencies — so it runs
with any Python 3.10+ interpreter.

Usage:

    python scripts/download_colombo_poi.py

Data (c) OpenStreetMap contributors, ODbL. Re-run to refresh; the output file
is committed so the service works without network access.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Colombo metropolitan area (covers the RP study network and all 25 hotspots).
BBOX = (6.75, 79.82, 7.05, 80.15)  # south, west, north, east

MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "poi" / "colombo_poi.json"

# Keep only every Nth vertex of bridge polylines: nearest-point distance checks
# don't need metre-level geometry, and this keeps the committed file small.
BRIDGE_GEOMETRY_STRIDE = 3


def _query(template: str) -> dict:
    south, west, north, east = BBOX
    body = template.format(s=south, w=west, n=north, e=east)
    data = urllib.parse.urlencode({"data": body}).encode()
    last_error: Exception | None = None
    for mirror in MIRRORS:
        try:
            req = urllib.request.Request(mirror, data=data, headers={
                "User-Agent": "kaduna-lk-geo-intelligence/0.1 (academic research, SLIIT R26-SE-026)",
            })
            with urllib.request.urlopen(req, timeout=180) as res:
                payload = json.loads(res.read().decode())
            if "elements" in payload:
                return payload
            last_error = RuntimeError(f"no elements in response from {mirror}")
        except Exception as exc:  # noqa: BLE001 — try the next mirror on any failure
            last_error = exc
            time.sleep(2)
    raise SystemExit(f"all Overpass mirrors failed: {last_error}")


def _point_pois(payload: dict) -> list[dict]:
    pois = []
    for el in payload["elements"]:
        if el["type"] == "node":
            lat, lng = el["lat"], el["lon"]
        elif "center" in el:
            lat, lng = el["center"]["lat"], el["center"]["lon"]
        else:
            continue
        name = el.get("tags", {}).get("name") or el.get("tags", {}).get("name:en")
        pois.append({"name": name, "lat": round(lat, 6), "lng": round(lng, 6)})
    return pois


def _bridge_segments(payload: dict) -> list[dict]:
    bridges = []
    for el in payload["elements"]:
        if el["type"] != "way" or "geometry" not in el:
            continue
        geometry = el["geometry"]
        points = geometry[::BRIDGE_GEOMETRY_STRIDE]
        if geometry[-1] not in points:
            points.append(geometry[-1])
        tags = el.get("tags", {})
        bridges.append({
            "name": tags.get("name") or tags.get("name:en"),
            "road_type": tags.get("highway"),
            "points": [[round(p["lat"], 6), round(p["lon"], 6)] for p in points],
        })
    return bridges


QUERIES = {
    "hospitals": ('[out:json][timeout:120];nwr["amenity"="hospital"]({s},{w},{n},{e});out center;', _point_pois),
    "schools": ('[out:json][timeout:120];nwr["amenity"="school"]({s},{w},{n},{e});out center;', _point_pois),
    "markets": ('[out:json][timeout:120];nwr["amenity"="marketplace"]({s},{w},{n},{e});out center;', _point_pois),
    "bridges": (
        '[out:json][timeout:120];'
        'way["bridge"="yes"]["highway"~"motorway|trunk|primary|secondary|tertiary"]'
        '({s},{w},{n},{e});out geom;',
        _bridge_segments,
    ),
}


def main() -> None:
    # Checkpointed: categories already in the output file are kept, so a run
    # that dies on one busy Overpass mirror resumes where it left off.
    data: dict = {}
    if OUT_PATH.exists():
        data = json.loads(OUT_PATH.read_text())

    print(f"Fetching Colombo POIs from Overpass, bbox={BBOX} ...")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    for kind, (template, parse) in QUERIES.items():
        if data.get(kind):
            print(f"  {kind:<12}  {len(data[kind])} (cached, skipping)")
            continue
        data[kind] = parse(_query(template))
        print(f"  {kind:<12}  {len(data[kind])}")
        data.update({
            "source": "OpenStreetMap via Overpass API (ODbL)",
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bbox_south_west_north_east": list(BBOX),
        })
        OUT_PATH.write_text(json.dumps(data, indent=1))

    missing = [k for k in QUERIES if not data.get(k)]
    if missing:
        raise SystemExit(f"still missing after this run: {missing} — re-run to resume")
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
