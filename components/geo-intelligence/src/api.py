"""Geo-Intelligence component — FastAPI service.

Wraps the impact-scoring model as a small REST API so the dashboard, mobile app,
and dispatch component can all consume it from one place.

Run locally:

    pip install -r ../requirements.txt
    uvicorn src.api:app --reload --port 5001

OpenAPI docs auto-generate at http://localhost:5001/docs.
"""
from __future__ import annotations

import datetime
import json
import os
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import require_user
from .impact_scoring import (
    ImpactScoringModel,
    IncidentInput,
    PriorityLevel,
)
from . import roads
from .sensitivity import overlay

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

app = FastAPI(
    title="Kaduna.lk — Geo-Intelligence Service",
    description=(
        "Traffic-impact intelligence for Sri Lankan roads. "
        "Scores incidents on a 1–10 priority scale; serves precomputed hotspot "
        "clusters for the Colombo metropolitan area."
    ),
    version="0.1.0",
    contact={"name": "Asath M M", "email": "it22633422@my.sliit.lk"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = ImpactScoringModel()

# Public API vocabulary documents `major_accident`/`minor_accident`; the scoring
# model's severity table uses the canonical research keys `accident_major`/
# `accident_minor`. Alias so a documented accident type resolves to the right
# severity instead of the default. Unlisted types pass through unchanged.
INCIDENT_TYPE_ALIASES = {
    "major_accident": "accident_major",
    "minor_accident": "accident_minor",
}


def _resolve_road(req: "ScoreRequest") -> dict:
    """Road class and lane count for the request, with the provenance of each.

    A caller that knows the road (the SUMO harness, the dashboard's what-if panel)
    may state it and is believed. A caller holding only a GPS fix — which is every
    real incident arriving through dispatch — omits both and gets them resolved
    from the coordinates.
    """
    supplied_class = req.road_type is not None
    supplied_lanes = req.total_lanes is not None

    if supplied_class and supplied_lanes:
        return {
            "road_type": req.road_type,
            "total_lanes": req.total_lanes,
            "source": "request",
            "lanes_source": "request",
            "matched_road": None,
            "distance_m": None,
        }

    info = roads.resolve(req.latitude, req.longitude)
    if supplied_class:
        info["road_type"] = req.road_type
        info["source"] = "request"
    if supplied_lanes:
        info["total_lanes"] = req.total_lanes
        info["lanes_source"] = "request"
    return info


def _to_incident(req: "ScoreRequest") -> tuple[IncidentInput, dict]:
    """Build the model input, resolving the road and reconciling lanes_blocked.

    The lanes_blocked check differs by provenance. When the caller supplied
    total_lanes, "3 blocked of 2" is their error and is rejected. When the server
    resolved it, the caller could not have known the lane count — rejecting would
    break the dispatch spine on every road narrower than the triage assumed — so
    the count is clamped and the clamp reported.
    """
    road = _resolve_road(req)
    lanes_blocked = req.lanes_blocked
    clamped = False
    if lanes_blocked > road["total_lanes"]:
        if road["lanes_source"] == "request":
            raise HTTPException(
                status_code=400,
                detail="lanes_blocked cannot exceed total_lanes",
            )
        lanes_blocked = road["total_lanes"]
        clamped = True

    incident = IncidentInput(
        latitude=req.latitude,
        longitude=req.longitude,
        road_type=road["road_type"],
        total_lanes=road["total_lanes"],
        lanes_blocked=lanes_blocked,
        incident_type=INCIDENT_TYPE_ALIASES.get(req.incident_type, req.incident_type),
        hour=req.hour,
        day_of_week=req.day_of_week,
        speed_limit_kmh=req.speed_limit_kmh,
    )
    return incident, {**road, "lanes_blocked_clamped": clamped}


class ScoreRequest(BaseModel):
    latitude: float = Field(..., example=6.9271)
    longitude: float = Field(..., example=79.8612)
    road_type: Optional[str] = Field(
        None, example="primary",
        description=(
            "One of: motorway, trunk, primary, secondary, tertiary, residential, "
            "living_street, unclassified. OPTIONAL — when omitted, the class is "
            "resolved from latitude/longitude against the committed OpenStreetMap "
            "road network. Callers that only have a GPS fix should omit it rather "
            "than guess: a guessed class pins the Location Factor."
        ),
    )
    total_lanes: Optional[int] = Field(
        None, ge=1, le=8, example=2,
        description=(
            "OPTIONAL — when omitted, taken from the matched road's OSM `lanes` "
            "tag, or that road class's default."
        ),
    )
    lanes_blocked: int = Field(..., ge=0, le=8, example=1)
    incident_type: str = Field(
        ..., example="engine_failure",
        description=(
            "One of: major_accident, minor_accident, engine_failure, flat_tire, "
            "fuel_empty, battery_dead, lockout, overheating, other. "
            "Aliases: major_accident→accident_major, minor_accident→accident_minor; "
            "lockout/other use default ISF 0.5."
        ),
    )
    hour: int = Field(..., ge=0, le=23, example=8)
    day_of_week: int = Field(..., ge=0, le=6, example=0,
                             description="0=Monday, 6=Sunday")
    speed_limit_kmh: Optional[float] = Field(None, example=60.0)
    date: Optional[datetime.date] = Field(
        None, example="2026-08-26",
        description=(
            "Calendar date of the incident (ISO 8601). Optional; enables the "
            "holiday / long-weekend component of the sensitivity overlay and "
            "overrides day_of_week for calendar logic."
        ),
    )


class NearbySensitiveLocation(BaseModel):
    type: str = Field(..., description="hospital | school | bridge | market | getaway_eve")
    name: Optional[str] = None
    distance_m: Optional[float] = None
    boost: float = Field(..., description="Additive boost this location contributes")
    active: bool = Field(..., description="False when present but outside its time gate")


class SensitivityInfo(BaseModel):
    factor: float = Field(
        ..., description="Capped multiplier in [1.0, 1.35] applied on top of the base score"
    )
    adjusted_score: float = Field(
        ..., description="min(10, score * factor) — the overlay-adjusted impact score"
    )
    nearby: List[NearbySensitiveLocation]
    is_holiday: bool
    is_getaway_eve: bool
    data_available: bool = Field(
        ..., description="False when the POI dataset is missing (overlay degrades to 1.0)"
    )


class RoadInfo(BaseModel):
    """Which road the score was computed against, and how that was established.

    Present so a consumer can tell a measured road class from a fallback. Before
    road resolution existed every incident was scored as `primary`, and nothing in
    the response revealed it.
    """

    road_type: str
    total_lanes: int
    source: str = Field(
        ...,
        description=(
            "osm — matched the committed OpenStreetMap network; "
            "request — the caller stated it; "
            "default — no road within the match cutoff, or no dataset loaded, so "
            "the historical primary/2-lane fallback was used"
        ),
    )
    lanes_source: str = Field(
        ..., description="osm | class_default | request | default"
    )
    matched_road: Optional[str] = Field(None, description="Road name, when OSM has one")
    distance_m: Optional[float] = Field(
        None, description="Distance from the incident to the matched road centreline"
    )
    lanes_blocked_clamped: bool = Field(
        False,
        description=(
            "True when the reported lanes_blocked exceeded the resolved lane count "
            "and was clamped down to it"
        ),
    )


class ScoreResponse(BaseModel):
    score: float = Field(..., description="Impact score on a 1–10 scale")
    priority: str = Field(..., description="CRITICAL | HIGH | MEDIUM | LOW")
    factors: dict
    prediction: dict
    road: RoadInfo = Field(
        ...,
        description=(
            "The road the score was computed against and how it was established. "
            "Check `source` before trusting the class: `default` means no road was "
            "matched and the historical primary/2-lane fallback was used."
        ),
    )
    sensitivity: SensitivityInfo = Field(
        ...,
        description=(
            "Sensitive-location + calendar overlay (schools, hospitals, bridges, "
            "markets, long-weekend eves). Reported separately: the base score and "
            "its 5 factors are unchanged."
        ),
    )


class HotspotCluster(BaseModel):
    cluster_id: int
    centroid_lat: float
    centroid_lon: float
    incident_count: int
    avg_score: float
    composite_risk: float
    road_type: Optional[str] = None
    incident_type: Optional[str] = None
    peak_hour: Optional[int] = None
    radius_m: Optional[float] = None


def _hotspot_from_row(row: dict, index: int) -> HotspotCluster:
    road_type = str(row.get("road_type", row.get("roadType", ""))) or None
    incident_type = str(row.get("incident_type", row.get("incidentType", ""))) or None
    peak_hour_raw = row.get("peak_hour", row.get("peakHour"))
    peak_hour = int(peak_hour_raw) if peak_hour_raw is not None else None
    radius_raw = row.get("radius_m", row.get("radiusM"))
    radius_m = float(radius_raw) if radius_raw is not None else None
    return HotspotCluster(
        cluster_id=int(row.get("cluster_id", row.get("id", index))),
        centroid_lat=float(
            row.get("centroid_lat", row.get("lat", row.get("latitude", 0.0)))
        ),
        centroid_lon=float(
            row.get("centroid_lon", row.get("lng", row.get("longitude", 0.0)))
        ),
        incident_count=int(row.get("incident_count", row.get("count", 0))),
        avg_score=float(row.get("avg_score", row.get("avgScore", 0.0))),
        composite_risk=float(row.get("composite_risk", row.get("risk", 0.0))),
        road_type=road_type,
        incident_type=incident_type,
        peak_hour=peak_hour,
        radius_m=radius_m,
    )


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    weights: dict


@app.get("/v1/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="geo-intelligence",
        version=app.version,
        weights=model.WEIGHTS,
    )


@app.post("/v1/score", response_model=ScoreResponse, tags=["scoring"], dependencies=[Depends(require_user)])
def score(req: ScoreRequest) -> ScoreResponse:
    incident, road = _to_incident(req)
    result = model.score(incident)
    priority = (
        result.priority.value
        if isinstance(result.priority, PriorityLevel)
        else str(result.priority)
    )
    score_value = round(float(result.score), 2)
    sens = overlay.evaluate(
        latitude=req.latitude,
        longitude=req.longitude,
        hour=req.hour,
        day_of_week=req.day_of_week,
        incident_date=req.date,
    )
    return ScoreResponse(
        score=score_value,
        priority=priority,
        factors={
            "capacity_loss": round(float(result.capacity_loss_factor), 3),
            "traffic_volume": round(float(result.traffic_volume_factor), 3),
            "temporal": round(float(result.temporal_factor), 3),
            "location": round(float(result.location_factor), 3),
            "incident_severity": round(float(result.incident_severity_factor), 3),
        },
        prediction={
            "queue_km": _round_or_none(result.predicted_queue_km),
            "vehicle_hours_lost": _round_or_none(result.predicted_vhl),
            "recovery_min": _round_or_none(result.predicted_recovery_min),
        },
        road=RoadInfo(**road),
        sensitivity=SensitivityInfo(
            factor=sens["factor"],
            adjusted_score=round(min(10.0, score_value * sens["factor"]), 2),
            nearby=sens["nearby"],
            is_holiday=sens["is_holiday"],
            is_getaway_eve=sens["is_getaway_eve"],
            data_available=sens["data_available"],
        ),
    )


class UncertaintyResponse(BaseModel):
    score_mean: float
    score_p05: float
    score_p95: float
    score_std: float


@app.post(
    "/v1/score/uncertainty",
    response_model=UncertaintyResponse,
    tags=["scoring"],
    dependencies=[Depends(require_user)],
)
def score_uncertainty(req: ScoreRequest) -> UncertaintyResponse:
    """90% confidence band on the impact score via Monte-Carlo over the two
    genuinely uncertain inputs (incident duration, reported lanes-blocked)."""
    incident, _road = _to_incident(req)
    return UncertaintyResponse(**model.score_with_uncertainty(incident))


class TimelineRequest(ScoreRequest):
    horizon_min: int = Field(120, ge=1, le=600, description="Minutes since the incident to project")
    step_min: int = Field(10, ge=1, le=60, description="Sampling interval in minutes")


@app.post("/v1/score/timeline", tags=["scoring"], dependencies=[Depends(require_user)])
def score_timeline(req: TimelineRequest) -> dict:
    """Relative congestion-impact curve over time since the incident: the queue
    builds while the incident is active, then drains — a rise-then-decay profile."""
    incident, _road = _to_incident(req)
    grid = list(range(0, req.horizon_min + 1, req.step_min))
    curve = model.impact_over_time(incident, grid)
    return {"minutes": grid, "impact": [round(float(v), 3) for v in curve]}


@app.get(
    "/v1/hotspots",
    response_model=List[HotspotCluster],
    tags=["spatial"],
    dependencies=[Depends(require_user)],
)
def hotspots() -> List[HotspotCluster]:
    path = DATA_DIR / "hotspots.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail="hotspot dataset not available")
    raw = json.loads(path.read_text())
    return [_hotspot_from_row(row, i) for i, row in enumerate(raw)]


@app.get("/v1/stats", tags=["meta"], dependencies=[Depends(require_user)])
def stats() -> dict:
    path = DATA_DIR / "stats.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail="stats dataset not available")
    return json.loads(path.read_text())


def _round_or_none(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    return round(float(v), 2)
