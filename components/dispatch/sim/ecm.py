"""
============================================================================
ECM — Expected Cost Minimization cost function (Python port)
============================================================================

Exact port of `components/dispatch/src/services/dispatch-optimizer.ts`'s
`calculateExpectedCost`. Previously this file used a DIFFERENT formula
(flat additive trust penalty, flat traffic term, missing assessment delay)
that only agreed with production directionally, not numerically — flagged
as an open item in the paper's Threats to Validity. Fixed 2026-08-26 to be
a literal port so simulation results describe the deployed objective, not
an approximation of it.

FORMULA (identical to dispatch-optimizer.ts:calculateExpectedCost)
--------------------------------------------------------------------------
For each candidate provider p and probability distribution P over service
types s:

    mismatch_penalty(p, s) =
        0                                              if p can handle s
        assessment_delay_minutes + re_dispatch_penalty  otherwise

    raw_cost(p) = Σ_s P(s) · [ travel_time(p) + service_time(s) + mismatch_penalty(p, s) ]
                + λ · (traffic_impact / 10) · travel_time(p)

    Cost(p) = raw_cost(p) / clamp(trust_score(p), 0.1, 1.0)

Providers with lower Cost(p) are preferred. Argmin picks the winner.

`re_dispatch_penalty_minutes` and `assessment_delay_minutes` are exposed as
optional overrides (default = production config values) so a sensitivity
sweep over the mismatch penalty can call this function directly without
touching module-level state.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import math
from dataclasses import dataclass


# ─── Config mirrors src/config/index.ts (dispatch.*) — production values ─
TRAFFIC_LAMBDA               = 0.3
RE_DISPATCH_PENALTY_MINUTES  = 45   # config.dispatch.reDispatchPenaltyMinutes
ASSESSMENT_DELAY_MINUTES     = 10   # config.dispatch.assessmentDelayMinutes (was MISSING from this file)

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
    provider:                     Provider,
    incident_lat:                 float,
    incident_lon:                 float,
    probabilities:                dict[str, float],
    traffic_impact_score:         float = 5.0,   # 1..10; default 5 when geo unreachable
    lambda_:                      float = TRAFFIC_LAMBDA,
    re_dispatch_penalty_minutes:  float = RE_DISPATCH_PENALTY_MINUTES,
    assessment_delay_minutes:     float = ASSESSMENT_DELAY_MINUTES,
) -> CostBreakdown:
    """
    Compute the expected cost of dispatching `provider` to the incident,
    integrating over the diagnostic probability distribution.

    Literal port of dispatch-optimizer.ts:calculateExpectedCost — same
    per-service-type weighted sum (travel + service + mismatch penalty),
    same traffic-externality scaling (lambda * (traffic/10) * travel, not
    a flat term), same trust treatment (divides the WHOLE cost, not an
    additive penalty). `re_dispatch_penalty_minutes` and
    `assessment_delay_minutes` are overridable for sensitivity analysis;
    defaults match config.dispatch in src/config/index.ts exactly.
    """
    dist_km  = haversine_km(provider.latitude, provider.longitude, incident_lat, incident_lon)
    travel   = travel_time_min(dist_km)

    expected_cost_sum = 0.0   # Σ_s P(s) * (travel + service(s) + mismatch_penalty(s))
    mismatch_risk     = 0.0
    for service_type, prob in probabilities.items():
        if prob <= 0:
            continue
        base_service = AVERAGE_SERVICE_TIMES.get(service_type, 60)
        can_handle   = service_type in provider.capabilities
        if can_handle:
            expected_cost_sum += prob * (travel + base_service)
        else:
            expected_cost_sum += prob * (
                travel + assessment_delay_minutes + re_dispatch_penalty_minutes + base_service
            )
            mismatch_risk += prob

    # Traffic externality: scales with travel time, not a flat term — a
    # provider twice as far away imposes twice the congestion externality
    # while still en route. Matches dispatch-optimizer.ts exactly.
    traffic_externality = lambda_ * (traffic_impact_score / 10.0) * travel

    raw_cost = expected_cost_sum + traffic_externality

    # Trust divides the WHOLE cost (not an additive penalty) — clamped to
    # [0.1, 1.0] to avoid division blow-up for near-zero trust.
    clamped_trust = max(0.1, min(1.0, provider.trust_score))
    total = raw_cost / clamped_trust

    return CostBreakdown(
        provider_id          = provider.id,
        expected_cost        = total,
        travel_time_min      = travel,
        expected_service_min = expected_cost_sum,
        mismatch_risk        = mismatch_risk,
        lambda_used          = lambda_,
        traffic_impact       = traffic_impact_score,
    )


def rank_providers(
    providers:                    list[Provider],
    incident_lat:                 float,
    incident_lon:                 float,
    probabilities:                dict[str, float],
    traffic_impact_score:         float = 5.0,
    lambda_:                      float = TRAFFIC_LAMBDA,
    re_dispatch_penalty_minutes:  float = RE_DISPATCH_PENALTY_MINUTES,
    assessment_delay_minutes:     float = ASSESSMENT_DELAY_MINUTES,
) -> list[CostBreakdown]:
    """Rank all AVAILABLE providers by ascending expected cost."""
    available = [p for p in providers if p.available]
    costs = [
        compute_provider_cost(
            p, incident_lat, incident_lon, probabilities,
            traffic_impact_score, lambda_,
            re_dispatch_penalty_minutes, assessment_delay_minutes,
        )
        for p in available
    ]
    costs.sort(key=lambda c: c.expected_cost)
    return costs
