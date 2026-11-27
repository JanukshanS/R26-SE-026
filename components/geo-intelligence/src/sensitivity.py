"""Sensitive-location and calendar overlay for the impact score.

Implements the Sensitive Proximity Factor (SPF) designed in the July 2026
geo-intelligence research synthesis: a CAPPED multiplier applied ON TOP of the
deployed 5-factor impact score. The 5-factor model, its weights, and every
artifact produced from it are untouched — the overlay reports a separate
``sensitivity_factor`` and ``adjusted_score`` so consumers can choose either.

Overlay components (each a bounded additive boost, total capped at +35%):

* Hospitals — incidents near a hospital threaten emergency access. Boost decays
  exponentially with network distance proxy (straight-line): 0.15 * exp(-d/400m).
* Schools — 150 m radius, active only on weekdays during arrival/dismissal
  windows (integer hours 6-8 and 12-13, approximating 06:45-08:30 and
  12:30-14:00), when the kerbside is congested with pickups and children are
  on the road.
* Bridges — an incident on or at the approach of a bridge (<=100 m of the OSM
  ``bridge=yes`` way geometry) has no lateral detour; fixed boost 0.10.
* Markets — 200 m radius, active on weekends and weekday dawn (04:00-09:00)
  when goods vehicles and crowds concentrate; boost 0.05.
* Getaway eve — a working day whose following 3+ days are all non-working
  (a holiday extending a weekend into a long break): outbound leisure traffic
  stacks onto the evening peak; boost 0.10. An ordinary Friday does NOT
  qualify. Holiday dates load from every data/sl_holidays_<year>.json; a date
  in a year with no file is never treated as a holiday or getaway eve, and the
  covered years are reported by /v1/health.

POI data loads from data/poi/colombo_poi.json (OpenStreetMap via
scripts/download_colombo_poi.py). A missing or malformed POI file degrades the
overlay to factor 1.0 and flags ``data_available: false``; a missing or
malformed holiday file drops the calendar component. Neither fails the score.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import date as date_type, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
POI_PATH = DATA_DIR / "poi" / "colombo_poi.json"
HOLIDAYS_GLOB = "sl_holidays_*.json"

POINT_POI_KINDS = ("hospitals", "schools", "markets")

EARTH_RADIUS_M = 6_371_000.0

HOSPITAL_MAX_BOOST = 0.15
HOSPITAL_DECAY_M = 400.0
HOSPITAL_CUTOFF_M = 1200.0  # beyond 3 decay lengths the boost is negligible

SCHOOL_BOOST = 0.10
SCHOOL_RADIUS_M = 150.0
SCHOOL_WINDOWS = ((6, 9), (12, 14))  # hour ranges [start, end), weekdays only

BRIDGE_BOOST = 0.10
BRIDGE_RADIUS_M = 100.0

MARKET_BOOST = 0.05
MARKET_RADIUS_M = 200.0
MARKET_DAWN_HOURS = (4, 9)  # weekday dawn window [start, end)

GETAWAY_EVE_BOOST = 0.10
TOTAL_BOOST_CAP = 0.35


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _read_poi(path: Path) -> dict:
    """Parse the POI file down to the fields evaluate() reads, so a malformed
    entry fails here, once, instead of inside every scoring request."""
    raw = json.loads(path.read_text())
    poi = {
        kind: [
            {"name": e["name"], "lat": float(e["lat"]), "lng": float(e["lng"])}
            for e in raw.get(kind, [])
        ]
        for kind in POINT_POI_KINDS
    }
    poi["bridges"] = [
        {"name": b["name"], "points": [(float(lat), float(lng)) for lat, lng in b["points"]]}
        for b in raw.get("bridges", [])
    ]
    return poi


def _read_holidays(path: Path) -> set[date_type]:
    raw = json.loads(path.read_text())
    return {date_type.fromisoformat(h["date"]) for h in raw["holidays"]}


def _load_status(loaded: bool, data) -> str:
    if not loaded:
        return "not yet loaded"
    return "loaded" if data is not None else "unavailable"


class SensitivityOverlay:
    """Loads POI + holiday data once and scores proximity boosts per incident."""

    def __init__(self, poi_path: Path = POI_PATH, holidays_path: Optional[Path] = None):
        self._poi_path = poi_path
        self._holidays_path = holidays_path
        self._poi: Optional[dict] = None
        self._holidays: Optional[set[date_type]] = None
        self._holiday_years: set[int] = set()
        self._loaded = False

    def _holiday_files(self) -> list[Path]:
        if self._holidays_path is not None:
            return [self._holidays_path]
        return sorted(DATA_DIR.glob(HOLIDAYS_GLOB))

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if self._poi_path.exists():
            try:
                self._poi = _read_poi(self._poi_path)
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                logger.warning("POI overlay disabled, %s unreadable: %r", self._poi_path, exc)
        for path in self._holiday_files():
            if not path.exists():
                continue
            try:
                days = _read_holidays(path)
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                logger.warning("Holiday file %s skipped, unreadable: %r", path, exc)
                continue
            self._holidays = (self._holidays or set()) | days
            self._holiday_years |= {d.year for d in days}

    @property
    def data_available(self) -> bool:
        self._load()
        return self._poi is not None

    def status(self) -> dict:
        """Load state of each dataset, without triggering a load."""
        return {
            "poi": _load_status(self._loaded, self._poi),
            "holidays": _load_status(self._loaded, self._holidays),
            "holiday_calendar_years": sorted(self._holiday_years),
        }

    # ── Calendar ─────────────────────────────────────────────────────────────

    def _is_non_working(self, day: date_type) -> bool:
        assert self._holidays is not None
        return day.weekday() >= 5 or day in self._holidays

    def is_holiday(self, day: date_type) -> bool:
        self._load()
        if self._holidays is None:
            return False
        return day in self._holidays

    def covers(self, day: date_type) -> bool:
        """Whether the calendar holds this date's year. Outside it a holiday is
        indistinguishable from a working day, so the calendar component is skipped."""
        self._load()
        return day.year in self._holiday_years

    def is_getaway_eve(self, day: date_type) -> bool:
        """A working day followed by at least three consecutive non-working days
        (holiday-extended weekend) — the evening everyone leaves town. An
        ordinary Friday before a plain two-day weekend does not qualify."""
        if not self.covers(day):
            return False
        if self._is_non_working(day):
            return False
        return all(
            self._is_non_working(day + timedelta(days=offset)) for offset in (1, 2, 3)
        )

    # ── POI proximity ────────────────────────────────────────────────────────

    def _nearest_point_poi(self, kind: str, lat: float, lng: float):
        assert self._poi is not None
        best = None
        for poi in self._poi.get(kind, []):
            d = _haversine_m(lat, lng, poi["lat"], poi["lng"])
            if best is None or d < best[1]:
                best = (poi, d)
        return best

    def _nearest_bridge(self, lat: float, lng: float):
        assert self._poi is not None
        best = None
        for bridge in self._poi.get("bridges", []):
            for plat, plng in bridge["points"]:
                d = _haversine_m(lat, lng, plat, plng)
                if best is None or d < best[1]:
                    best = (bridge, d)
        return best

    # ── Main entry point ─────────────────────────────────────────────────────

    def evaluate(
        self,
        latitude: float,
        longitude: float,
        hour: int,
        day_of_week: int,
        incident_date: Optional[date_type] = None,
    ) -> dict:
        """Return the overlay result for one incident.

        ``day_of_week`` follows the scoring model convention (0=Monday). When
        ``incident_date`` is given it takes precedence for weekday/holiday
        logic; ``day_of_week`` alone still drives the school/market gating so
        the overlay works for date-less what-if queries.
        """
        self._load()

        if incident_date is not None:
            day_of_week = incident_date.weekday()
        is_weekday = day_of_week < 5

        nearby: list[dict] = []
        total_boost = 0.0

        if self._poi is not None:
            hospital = self._nearest_point_poi("hospitals", latitude, longitude)
            if hospital and hospital[1] <= HOSPITAL_CUTOFF_M:
                poi, dist = hospital
                boost = HOSPITAL_MAX_BOOST * math.exp(-dist / HOSPITAL_DECAY_M)
                total_boost += boost
                nearby.append({
                    "type": "hospital",
                    "name": poi["name"],
                    "distance_m": round(dist),
                    "boost": round(boost, 3),
                    "active": True,
                })

            school = self._nearest_point_poi("schools", latitude, longitude)
            if school and school[1] <= SCHOOL_RADIUS_M:
                poi, dist = school
                in_window = is_weekday and any(
                    start <= hour < end for start, end in SCHOOL_WINDOWS
                )
                boost = SCHOOL_BOOST if in_window else 0.0
                total_boost += boost
                nearby.append({
                    "type": "school",
                    "name": poi["name"],
                    "distance_m": round(dist),
                    "boost": round(boost, 3),
                    "active": in_window,
                })

            bridge = self._nearest_bridge(latitude, longitude)
            if bridge and bridge[1] <= BRIDGE_RADIUS_M:
                poi, dist = bridge
                total_boost += BRIDGE_BOOST
                nearby.append({
                    "type": "bridge",
                    "name": poi["name"],
                    "distance_m": round(dist),
                    "boost": BRIDGE_BOOST,
                    "active": True,
                })

            market = self._nearest_point_poi("markets", latitude, longitude)
            if market and market[1] <= MARKET_RADIUS_M:
                poi, dist = market
                in_window = (not is_weekday) or (
                    MARKET_DAWN_HOURS[0] <= hour < MARKET_DAWN_HOURS[1]
                )
                boost = MARKET_BOOST if in_window else 0.0
                total_boost += boost
                nearby.append({
                    "type": "market",
                    "name": poi["name"],
                    "distance_m": round(dist),
                    "boost": round(boost, 3),
                    "active": in_window,
                })

        is_holiday = False
        is_getaway = False
        if incident_date is not None and self.covers(incident_date):
            is_holiday = self.is_holiday(incident_date)
            is_getaway = self.is_getaway_eve(incident_date)
            if is_getaway:
                total_boost += GETAWAY_EVE_BOOST
                nearby.append({
                    "type": "getaway_eve",
                    "name": "working day before a long weekend / holiday run",
                    "distance_m": None,
                    "boost": GETAWAY_EVE_BOOST,
                    "active": True,
                })

        capped = min(total_boost, TOTAL_BOOST_CAP)
        return {
            "factor": round(1.0 + capped, 3),
            "nearby": nearby,
            "is_holiday": is_holiday,
            "is_getaway_eve": is_getaway,
            "data_available": self._poi is not None,
        }


overlay = SensitivityOverlay()
