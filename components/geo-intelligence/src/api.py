"""Geo-Intelligence component — FastAPI service.

Wraps the impact-scoring model as a small REST API so the dashboard, mobile app,
and dispatch component can all consume it from one place.

Run locally:

    pip install -r ../requirements.txt
    uvicorn src.api:app --reload --port 8080

OpenAPI docs auto-generate at http://localhost:8080/docs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .impact_scoring import (
    ImpactScoringModel,
    IncidentInput,
    PriorityLevel,
)

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


class ScoreRequest(BaseModel):
    latitude: float = Field(..., example=6.9271)
    longitude: float = Field(..., example=79.8612)
    road_type: str = Field(
        ..., example="primary",
        description="One of: motorway, trunk, primary, secondary, tertiary, residential",
    )
    total_lanes: int = Field(..., ge=1, le=8, example=2)
    lanes_blocked: int = Field(..., ge=0, le=8, example=1)
    incident_type: str = Field(
        ..., example="engine_failure",
        description=(
            "One of: major_accident, minor_accident, engine_failure, flat_tire, "
            "fuel_empty, battery_dead, lockout, other"
        ),
    )
    hour: int = Field(..., ge=0, le=23, example=8)
    day_of_week: int = Field(..., ge=0, le=6, example=0,
                             description="0=Monday, 6=Sunday")
    speed_limit_kmh: Optional[float] = Field(None, example=60.0)


class ScoreResponse(BaseModel):
    score: float = Field(..., description="Impact score on a 1–10 scale")
    priority: str = Field(..., description="CRITICAL | HIGH | MEDIUM | LOW")
    factors: dict
    prediction: dict


class HotspotCluster(BaseModel):
    cluster_id: int
    centroid_lat: float
    centroid_lon: float
    incident_count: int
    avg_score: float
    composite_risk: float


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


@app.post("/v1/score", response_model=ScoreResponse, tags=["scoring"])
def score(req: ScoreRequest) -> ScoreResponse:
    if req.lanes_blocked > req.total_lanes:
        raise HTTPException(
            status_code=400,
            detail="lanes_blocked cannot exceed total_lanes",
        )
    incident = IncidentInput(
        latitude=req.latitude,
        longitude=req.longitude,
        road_type=req.road_type,
        total_lanes=req.total_lanes,
        lanes_blocked=req.lanes_blocked,
        incident_type=req.incident_type,
        hour=req.hour,
        day_of_week=req.day_of_week,
        speed_limit_kmh=req.speed_limit_kmh,
    )
    result = model.score(incident)
    priority = (
        result.priority.value
        if isinstance(result.priority, PriorityLevel)
        else str(result.priority)
    )
    return ScoreResponse(
        score=round(float(result.score), 2),
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
    )


@app.get("/v1/hotspots", response_model=List[HotspotCluster], tags=["spatial"])
def hotspots() -> List[HotspotCluster]:
    path = DATA_DIR / "hotspots.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail="hotspot dataset not available")
    raw = json.loads(path.read_text())
    return [
        HotspotCluster(
            cluster_id=int(row.get("cluster_id", row.get("id", i))),
            centroid_lat=float(
                row.get("centroid_lat", row.get("lat", row.get("latitude", 0.0)))
            ),
            centroid_lon=float(
                row.get("centroid_lon", row.get("lng", row.get("longitude", 0.0)))
            ),
            incident_count=int(
                row.get("incident_count", row.get("count", 0))
            ),
            avg_score=float(row.get("avg_score", 0.0)),
            composite_risk=float(
                row.get("composite_risk", row.get("risk", 0.0))
            ),
        )
        for i, row in enumerate(raw)
    ]


@app.get("/v1/stats", tags=["meta"])
def stats() -> dict:
    path = DATA_DIR / "stats.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail="stats dataset not available")
    return json.loads(path.read_text())


def _round_or_none(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    return round(float(v), 2)
