"""Resolve an incident's road class and lane count from its GPS fix.

Why this exists
---------------
``components/dispatch/src/services/geo-client.ts`` used to send a hardcoded
``road_type: 'primary'`` and ``total_lanes: 2`` for every incident, because the
mobile report carries only a latitude/longitude. The consequences ran deep:

* **LF** (Location Factor, weight 0.15) was pinned at
  ``ROAD_LOCATION_FACTOR['primary']`` = 0.70 with zero variance, so 15% of the
  deployed score carried no information.
* **TVF** (Traffic Volume Factor, weight 0.25) had its road-class term
  ``ROAD_PEAK_VC['primary']`` = 0.85 pinned, leaving only hour x day.

In production the five-factor model was therefore behaving as a four-factor model
with a fixed offset. Resolving the class from the coordinates restores both.

Design notes
------------
Resolution lives here, in geo-intelligence, rather than in dispatch: dispatch has
no business knowing an OSM road taxonomy, and geo already receives the incident's
coordinates and owns the scoring model those classes feed.

Lookup is a bbox-prefiltered brute-force scan over the committed way geometry.
Colombo is ~30k ways; the prefilter rejects almost all of them on four float
comparisons, so a query costs a few milliseconds. No spatial index -- indexing a
polyline correctly means inserting each way into every grid cell its bbox overlaps,
and getting that subtly wrong silently misses roads near cell boundaries.
# ponytail: brute-force scan, add a grid index only if a query is measurably slow.

Distances use a local equirectangular projection centred on the query point. Over
the tens of metres that matter here its error against the haversine is far below
GPS noise, and it makes point-to-segment distance plain planar geometry.

Data comes from scripts/download_colombo_roads.py (OpenStreetMap, ODbL). If the
file is missing the resolver degrades to "unavailable" and the API falls back to
the historical defaults, so a missing dataset can never change a score.
"""
from __future__ import annotations

import gzip
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "roads" / "colombo_roads.json.gz"

# Beyond this, we do not claim to know which road the incident is on. Urban GPS
# error is roughly 10-30 m and a wide carriageway adds another 10-15 m; past 50 m
# the nearest way is as likely to be the next street over.
MATCH_CUTOFF_M = 50.0

# Metres per degree. Latitude is near-constant; longitude is scaled by cos(lat).
M_PER_DEG_LAT = 110_540.0
M_PER_DEG_LNG_EQUATOR = 111_320.0

# Used only when OSM carries no ``lanes`` tag for the matched way, which is the
# common case in Colombo. Total lanes across both directions.
CLASS_DEFAULT_LANES = {
    "motorway": 4,
    "trunk": 4,
    "primary": 4,
    "secondary": 2,
    "tertiary": 2,
    "unclassified": 2,
    "residential": 2,
}

# What the API sent before this module existed. A miss must reproduce the old
# behaviour exactly, so an incident outside the dataset scores as it always has.
FALLBACK_ROAD_TYPE = "primary"
FALLBACK_TOTAL_LANES = 2


@dataclass(frozen=True)
class RoadMatch:
    """The road an incident was matched to, with the provenance of each field."""

    road_type: str
    total_lanes: int
    distance_m: float
    name: Optional[str]
    lanes_source: str  # "osm" | "class_default"


def _point_segment_distance_m(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    """Shortest distance from P to segment AB, all in local metres."""
    abx, aby = bx - ax, by - ay
    denom = abx * abx + aby * aby
    if denom == 0.0:  # degenerate segment: A and B coincide
        return math.hypot(px - ax, py - ay)
    # Projection parameter of P onto AB, clamped to the segment.
    t = ((px - ax) * abx + (py - ay) * aby) / denom
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


class RoadNetwork:
    """Committed OSM road geometry with a nearest-way lookup.

    Loading is lazy so importing the module (and running tests that never touch
    road resolution) costs nothing.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or DATA_PATH
        self._ways: list[dict] | None = None
        self._loaded = False

    # -- loading ---------------------------------------------------------

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self._path.exists():
            self._ways = None
            return
        try:
            opener = gzip.open if self._path.suffix == ".gz" else open
            with opener(self._path, "rt", encoding="utf-8") as fh:  # type: ignore[operator]
                doc = json.load(fh)
            ways = doc.get("ways") or []
        except (OSError, ValueError, json.JSONDecodeError):
            self._ways = None
            return

        # Precompute each way's bounding box once; the query prefilter is four
        # float comparisons per way, which is what keeps the brute-force scan cheap.
        for way in ways:
            lats = [p[0] for p in way["g"]]
            lngs = [p[1] for p in way["g"]]
            way["bb"] = (min(lats), max(lats), min(lngs), max(lngs))
        self._ways = ways or None

    @property
    def available(self) -> bool:
        self._load()
        return bool(self._ways)

    @property
    def way_count(self) -> int:
        self._load()
        return len(self._ways) if self._ways else 0

    # -- lookup ----------------------------------------------------------

    def nearest(self, latitude: float, longitude: float,
                cutoff_m: float = MATCH_CUTOFF_M) -> Optional[RoadMatch]:
        """Nearest classified road within ``cutoff_m``, or None."""
        self._load()
        if not self._ways:
            return None

        m_per_deg_lng = M_PER_DEG_LNG_EQUATOR * math.cos(math.radians(latitude))
        if m_per_deg_lng <= 0:  # at the poles; not Colombo, but do not divide by zero
            return None
        pad_lat = cutoff_m / M_PER_DEG_LAT
        pad_lng = cutoff_m / m_per_deg_lng

        best: Optional[dict] = None
        best_d = cutoff_m

        for way in self._ways:
            min_lat, max_lat, min_lng, max_lng = way["bb"]
            if (latitude < min_lat - pad_lat or latitude > max_lat + pad_lat
                    or longitude < min_lng - pad_lng or longitude > max_lng + pad_lng):
                continue

            geometry = way["g"]
            # Project this way's vertices into metres relative to the query point.
            prev_x = (geometry[0][1] - longitude) * m_per_deg_lng
            prev_y = (geometry[0][0] - latitude) * M_PER_DEG_LAT
            for lat2, lng2 in geometry[1:]:
                cur_x = (lng2 - longitude) * m_per_deg_lng
                cur_y = (lat2 - latitude) * M_PER_DEG_LAT
                d = _point_segment_distance_m(0.0, 0.0, prev_x, prev_y, cur_x, cur_y)
                if d < best_d:
                    best_d, best = d, way
                prev_x, prev_y = cur_x, cur_y

        if best is None:
            return None

        road_class = best["c"]
        osm_lanes = best.get("l")
        return RoadMatch(
            road_type=road_class,
            total_lanes=osm_lanes if osm_lanes else CLASS_DEFAULT_LANES.get(road_class, 2),
            distance_m=round(best_d, 1),
            name=best.get("n"),
            lanes_source="osm" if osm_lanes else "class_default",
        )


# Module-level singleton: the dataset is read-only, so one copy serves every request.
network = RoadNetwork()


def resolve(latitude: float, longitude: float) -> dict:
    """Road attributes for an incident, always with explicit provenance.

    Returns ``road_type`` and ``total_lanes`` plus a ``source``:

    * ``"osm"``     -- matched a road in the committed OSM dataset.
    * ``"default"`` -- no road within the cutoff, or no dataset present. The
      returned values are the historical hardcoded ones, so an unresolved
      incident scores exactly as it did before this module existed.
    """
    match = network.nearest(latitude, longitude)
    if match is None:
        return {
            "road_type": FALLBACK_ROAD_TYPE,
            "total_lanes": FALLBACK_TOTAL_LANES,
            "source": "default",
            "matched_road": None,
            "distance_m": None,
            "lanes_source": "default",
        }
    return {
        "road_type": match.road_type,
        "total_lanes": match.total_lanes,
        "source": "osm",
        "matched_road": match.name,
        "distance_m": match.distance_m,
        "lanes_source": match.lanes_source,
    }
