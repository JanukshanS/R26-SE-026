"""
============================================================================
ECM — Expected Cost Minimization cost function (Python port)
============================================================================

Mirrors `components/dispatch/src/services/dispatch-optimizer.ts` — same
weighted cost formula, same units. The simulation ranks providers by
minimum expected cost and picks the winner exactly like production does.

FORMULA
-------
For each candidate provider p and each service type s in the probability
distribution:
    mismatch_penalty(p, s) =
        0                      if p can handle s
        RE_DISPATCH_PENALTY    otherwise (extra time to re-dispatch)

Cost(p) = Σ_s P(s) · (
    travel_time(p)
    + service_time(s)
    + mismatch_penalty(p, s)
) + λ · traffic_impact + (1 - trust_score(p)) · TRUST_PENALTY

Providers with lower Cost(p) are preferred. Argmin picks the winner.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import math
from dataclasses import dataclass


# ─── Config mirrors src/config/index.ts (dispatch.*) ─────────────────────
TRAFFIC_LAMBDA               = 0.3
RE_DISPATCH_PENALTY_MINUTES  = 45
TRUST_PENALTY_MINUTES        = 15  # cost multiplier for low-trust providers

# Average service times per service type in minutes (mirrors config.dispatch.averageServiceTimes)
AVERAGE_SERVICE_TIMES = {
    # ML-diagnosable
    "BATTERY_JUMP":           15,
    "BATTERY_TERMINAL_CLEAN": 10,
    "BATTERY_REPLACE":        30,
    "ALTERNATOR_ISSUE":       60,
    "STARTER_MOTOR":          60,
    "COOLANT_LOW":            10,
    "RADIATOR_FAN_ISSUE":     45,
    "RADIATOR_HOSE_LEAK":     30,
    "ENGINE_OVERHEAT_SEVERE": 120,
    "BELT_BROKEN":            30,
    "FUEL_FILTER_CLOGGED":    25,
    "FUEL_PUMP":              90,
    "IGNITION_SYSTEM":        60,
    "ELECTRICAL_FAULT_RAIN":  90,
    "BRAKE_PAD_WORN":         60,
    "BRAKE_FAILURE":          90,
    "CLUTCH_WORN":            150,
    "TRANSMISSION_ISSUE":     180,
    "SEVERE_MECHANICAL_TOW":  30,
    # Fast-path
    "LOCKOUT":                15,
    "KEY_LOST":               30,
    "FLAT_TIRE_CHANGE":       15,
    "FUEL_EMPTY":             15,
    "FUEL_WRONG":             45,
    "LIGHT_BULB":             15,
    "BLOWN_FUSE":             10,
    "MAJOR_ACCIDENT":         30,
    "URGENT_TOW":             30,
    "FLOOD_RECOVERY":         60,
}


# ─── Data classes ────────────────────────────────────────────────────────

@dataclass
class Provider:
    id:            str
    name:          str
    latitude:      float
    longitude:     float
    capabilities:  set[str]
    trust_score:   float = 0.75    # 0..1
    available:     bool = True     # simulation may take providers offline


@dataclass
class CostBreakdown:
    provider_id:          str
    expected_cost:        float
    travel_time_min:      float
    expected_service_min: float
    mismatch_risk:        float
    lambda_used:          float
    traffic_impact:       float


# ─── Distance helpers ────────────────────────────────────────────────────

_EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km. Placeholder for Google DM in production."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi   = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def travel_time_min(distance_km: float, speed_kph: float = 25.0) -> float:
    """Colombo urban traffic average is ~25 km/h — see dispatch-optimizer.ts."""
    return (distance_km / max(speed_kph, 1e-6)) * 60.0


# ─── Cost function ───────────────────────────────────────────────────────

def compute_provider_cost(
    provider:             Provider,
    incident_lat:         float,
    incident_lon:         float,
    probabilities:        dict[str, float],
    traffic_impact_score: float = 5.0,   # 1..10; default 5 when geo unreachable
    lambda_:              float = TRAFFIC_LAMBDA,
) -> CostBreakdown:
    """
    Compute the expected cost of dispatching `provider` to the incident,
    integrating over the diagnostic probability distribution.

    Mirrors the TS `computeProviderCost` semantics; deviations here would
    invalidate the simulation as a predictor of production behaviour.
    """
    dist_km  = haversine_km(provider.latitude, provider.longitude, incident_lat, incident_lon)
    travel   = travel_time_min(dist_km)

    expected_service = 0.0
    mismatch_risk    = 0.0
    for service_type, prob in probabilities.items():
        if prob <= 0:
            continue
        base_service = AVERAGE_SERVICE_TIMES.get(service_type, 60)
        can_handle   = service_type in provider.capabilities
        if can_handle:
            expected_service += prob * base_service
        else:
            expected_service += prob * (base_service + RE_DISPATCH_PENALTY_MINUTES)
            mismatch_risk    += prob

    trust_component = (1.0 - provider.trust_score) * TRUST_PENALTY_MINUTES
    externality     = lambda_ * traffic_impact_score

    total = travel + expected_service + trust_component + externality

    return CostBreakdown(
        provider_id          = provider.id,
        expected_cost        = total,
        travel_time_min      = travel,
        expected_service_min = expected_service,
        mismatch_risk        = mismatch_risk,
        lambda_used          = lambda_,
        traffic_impact       = traffic_impact_score,
    )


def rank_providers(
    providers:            list[Provider],
    incident_lat:         float,
    incident_lon:         float,
    probabilities:        dict[str, float],
    traffic_impact_score: float = 5.0,
    lambda_:              float = TRAFFIC_LAMBDA,
) -> list[CostBreakdown]:
    """Rank all AVAILABLE providers by ascending expected cost."""
    available = [p for p in providers if p.available]
    costs = [
        compute_provider_cost(
            p, incident_lat, incident_lon, probabilities,
            traffic_impact_score, lambda_
        )
        for p in available
    ]
    costs.sort(key=lambda c: c.expected_cost)
    return costs
