"""Download the classified road network for the Colombo metro area from OpenStreetMap.

Feeds src/roads.py, which resolves an incident's road class and lane count from its
GPS fix. Before this existed, dispatch sent a hardcoded ``road_type: 'primary'`` for
every incident (geo-client.ts), which pinned the Location Factor at a constant and
froze the road-class half of the Traffic Volume Factor -- 15% of the deployed impact
score carried no information at all.

Road classes map 1:1 onto ``ImpactScoringModel.ROAD_LOCATION_FACTOR`` keys. The
``*_link`` variants (slip roads, ramps) are folded into their base class so a flyover
ramp does not fall through to ``unclassified``.

Stdlib only -- no third-party dependencies -- so it runs with any Python 3.10+
interpreter. Mirrors the structure of download_colombo_poi.py.

Usage:

    python scripts/download_colombo_roads.py

Data (c) OpenStreetMap contributors, ODbL. Re-run to refresh; the output file is
committed (gzipped) so the service works without network access.
"""
from __future__ import annotations

import gzip
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Same bbox as the POI download: the RP study network and all 25 hotspots.
BBOX = (6.75, 79.82, 7.05, 80.15)  # south, west, north, east

MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "roads" / "colombo_roads.json.gz"

# Only classes the impact model scores differently. service/footway/track/path are
# excluded: an incident needing roadside assistance is not on a footpath, and they
# would triple the file size.
CLASSES = (
    "motorway", "trunk", "primary", "secondary",
    "tertiary", "unclassified", "residential",
)

QUERY = """
[out:json][timeout:300];
way["highway"~"^({classes})(_link)?$"]({s},{w},{n},{e});
out geom tags;
"""


def _fetch() -> dict:
    south, west, north, east = BBOX
    body = QUERY.format(classes="|".join(CLASSES), s=south, w=west, n=north, e=east)
    data = urllib.parse.urlencode({"data": body}).encode()
    last_error: Exception | None = None
    for mirror in MIRRORS:
        try:
            print(f"  trying {mirror} ...", flush=True)
            req = urllib.request.Request(mirror, data=data, headers={
                "User-Agent": "kaduna-lk-geo-intelligence/0.1 (academic research, SLIIT R26-SE-026)",
            })
            with urllib.request.urlopen(req, timeout=300) as res:
                payload = json.loads(res.read().decode())
            if "elements" in payload:
                return payload
            last_error = RuntimeError(f"no elements in response from {mirror}")
        except Exception as exc:  # noqa: BLE001 -- try the next mirror on any failure
            last_error = exc
            print(f"    failed: {exc}", flush=True)
            time.sleep(2)
    raise SystemExit(f"all Overpass mirrors failed: {last_error}")


def _lanes(tags: dict) -> int | None:
    """Total lanes if OSM states it. Most Colombo ways don't; src/roads.py then
    falls back to a per-class default rather than inventing a number here."""
    raw = tags.get("lanes")
    if raw is None:
        return None
    try:
        # "2", but also "2;3" and "1.5" appear in the wild.
        n = int(float(str(raw).split(";")[0].strip()))
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 8 else None


def _ways(payload: dict) -> list[dict]:
    ways = []
    for el in payload["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        highway = tags.get("highway", "")
        road_class = highway[:-5] if highway.endswith("_link") else highway
        if road_class not in CLASSES:
            continue
        geometry = [
            [round(pt["lat"], 5), round(pt["lon"], 5)] for pt in el["geometry"]
        ]
        if len(geometry) < 2:
            continue
        way = {"c": road_class, "g": geometry}
        lanes = _lanes(tags)
        if lanes is not None:
            way["l"] = lanes
        name = tags.get("name") or tags.get("name:en")
        if name:
            way["n"] = name
        ways.append(way)
    return ways


def main() -> None:
    print(f"Fetching classified roads for bbox {BBOX} from Overpass ...", flush=True)
    payload = _fetch()
    ways = _ways(payload)
    if not ways:
        raise SystemExit("no ways parsed -- refusing to overwrite the committed dataset")

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox": list(BBOX),
        "source": "OpenStreetMap via Overpass API",
        "licence": "ODbL 1.0 (c) OpenStreetMap contributors",
        "classes": list(CLASSES),
        "ways": ways,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT_PATH, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))

    by_class: dict[str, int] = {}
    for w in ways:
        by_class[w["c"]] = by_class.get(w["c"], 0) + 1
    segments = sum(len(w["g"]) - 1 for w in ways)

    print(f"\nWrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1e6:.2f} MB gzipped)")
    print(f"  ways     : {len(ways)}")
    print(f"  segments : {segments}")
    print(f"  with lanes tag: {sum(1 for w in ways if 'l' in w)}")
    for cls in CLASSES:
        print(f"    {cls:14s} {by_class.get(cls, 0)}")


if __name__ == "__main__":
    main()
