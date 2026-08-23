"""
============================================================================
Scenario — synthetic incident generator with known ground truth
============================================================================

For SimPy to prove the pipeline works, each incident MUST have a
verifiable "true" fault — the ground-truth service type the mechanic
would have found. We generate incidents where this truth is drawn from a
KNOWN distribution and questionnaire answers are sampled conditional on
the truth (with noise).

THE "TRUTH DRIFT" TRICK
-----------------------
The tree was trained on distribution P_train (via generate_dataset.py).
For Bayesian's convergence proof to have anything to prove, the SIMULATION
ground truth must differ from P_train — otherwise the tree is already
correct and Bayesian has nothing to correct. We introduce a controlled
drift:

    P_truth[BATTERY_REPLACE] = 2 * P_train[BATTERY_REPLACE]
    P_truth[STARTER_MOTOR]   = 0.5 * P_train[STARTER_MOTOR]

(then renormalise). This models the real world: your training data is a
sample, the population differs slightly, and Bayesian's job is to close
the gap using field feedback.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

# ─── ML-diagnosable classes (mirrors src/types/index.ts:ML_SERVICE_TYPES) ─
ML_SERVICE_TYPES = [
    "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE", "ALTERNATOR_ISSUE",
    "STARTER_MOTOR",
    "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK", "ENGINE_OVERHEAT_SEVERE",
    "BELT_BROKEN",
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    "ELECTRICAL_FAULT_RAIN",
    "BRAKE_PAD_WORN", "BRAKE_FAILURE",
    "CLUTCH_WORN", "TRANSMISSION_ISSUE",
    "SEVERE_MECHANICAL_TOW",
]

# Colombo metro rough bounding box (for realistic incident locations)
COLOMBO_LAT_MIN, COLOMBO_LAT_MAX = 6.85, 7.00
COLOMBO_LON_MIN, COLOMBO_LON_MAX = 79.82, 79.92


# ─── Frequency priors ────────────────────────────────────────────────────

# Approximate frequencies the tree was trained on (from generate_dataset.py).
P_TRAIN = {
    "BATTERY_JUMP":           0.12,
    "BATTERY_TERMINAL_CLEAN": 0.03,
    "BATTERY_REPLACE":        0.05,
    "ALTERNATOR_ISSUE":       0.05,
    "STARTER_MOTOR":          0.08,
    "COOLANT_LOW":            0.05,
    "RADIATOR_FAN_ISSUE":     0.04,
    "RADIATOR_HOSE_LEAK":     0.03,
    "ENGINE_OVERHEAT_SEVERE": 0.03,
    "BELT_BROKEN":            0.04,
    "FUEL_FILTER_CLOGGED":    0.05,
    "FUEL_PUMP":              0.04,
    "IGNITION_SYSTEM":        0.06,
    "ELECTRICAL_FAULT_RAIN":  0.05,
    "BRAKE_PAD_WORN":         0.08,
    "BRAKE_FAILURE":          0.03,
    "CLUTCH_WORN":            0.06,
    "TRANSMISSION_ISSUE":     0.06,
    "SEVERE_MECHANICAL_TOW":  0.05,
}


def build_truth_distribution(drift: dict[str, float] | None = None) -> dict[str, float]:
    """
    Return the ground-truth distribution used by the simulator. Any classes
    in `drift` get multiplied by their factor; the rest keep P_train.
    Result is renormalised to sum to 1.

    Default drift models the exact scenario the Bayesian layer was designed
    for: the training data over-represents BATTERY_JUMP and under-represents
    BATTERY_REPLACE, and real Sri Lankan data flips that.
    """
    if drift is None:
        drift = {
            "BATTERY_REPLACE":       2.0,   # 2× more common in truth
            "STARTER_MOTOR":         0.5,   # tree over-predicts this
            "ALTERNATOR_ISSUE":      1.5,   # more alternator failures than we thought
        }
    unnorm = {c: P_TRAIN[c] * drift.get(c, 1.0) for c in ML_SERVICE_TYPES}
    total  = sum(unnorm.values())
    return {c: v / total for c, v in unnorm.items()}


# ─── Symptom → conditional-answer templates ──────────────────────────────
#
# For each true service type, define what questionnaire answers the driver
# would likely give. These mirror the conditional distributions in
# generate_dataset.py — the tree learned from these; the simulation generates
# realistic incidents by sampling from them (with 15% noise per field).

# Each entry is: { field: (typical_answer, alt_answer) }
# With NOISE_RATE probability, sampled answer = alt_answer instead of typical.
NOISE_RATE = 0.15

CONDITIONAL_ANSWERS: dict[str, dict[str, tuple[Any, Any]]] = {
    "BATTERY_JUMP": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("CRANKS_NO_START", "NO_CRANK"),
        "Q3_sound":          ("RAPID_CLICKING", "NORMAL_CRANKING"),
        "Q3b_electrical":    ("NOT_ASKED", "NOT_ASKED"),
    },
    "BATTERY_TERMINAL_CLEAN": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("NO_CRANK", "CRANKS_NO_START"),
        "Q3b_electrical":    ("DIM_LIGHTS", "SOME_LIGHTS_ON"),
    },
    "BATTERY_REPLACE": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("NO_CRANK", "CRANKS_NO_START"),
        "Q3b_electrical":    ("ALL_DEAD_NO_LIGHTS", "DIM_LIGHTS"),
        "Q3_sound":          ("NOT_ASKED", "NOTHING"),
    },
    "ALTERNATOR_ISSUE": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_BUT_ISSUE", "STARTS_NORMAL"),
        "Q2b_running_issue": ("NO_POWER", "NOISE"),
        "Q4_noise_detail":   ("WHINE", "NOT_ASKED"),
    },
    "STARTER_MOTOR": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("CRANKS_NO_START", "NO_CRANK"),
        "Q3_sound":          ("SINGLE_CLICK", "GRINDING"),
    },
    "COOLANT_LOW": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_NORMAL", "STARTS_BUT_ISSUE"),
        "Q2b_running_issue": ("OVERHEATING", "NOISE"),
        "Q7_overheat_detail":("TRAFFIC_ONLY", "HILL_CLIMB"),
    },
    "RADIATOR_FAN_ISSUE": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_NORMAL", "STARTS_BUT_ISSUE"),
        "Q2b_running_issue": ("OVERHEATING", "NOISE"),
        "Q7_overheat_detail":("TRAFFIC_ONLY", "WITH_AC"),
    },
    "RADIATOR_HOSE_LEAK": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_NORMAL", "STARTS_BUT_ISSUE"),
        "Q2b_running_issue": ("OVERHEATING", "SMOKE"),
        "Q7_overheat_detail":("ALWAYS", "HILL_CLIMB"),
        "Q8_smoke_color":    ("WHITE", "NOT_ASKED"),
    },
    "ENGINE_OVERHEAT_SEVERE": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_NORMAL", "STARTS_BUT_ISSUE"),
        "Q2b_running_issue": ("OVERHEATING", "SMOKE"),
        "Q7_overheat_detail":("ALWAYS", "HILL_CLIMB"),
        "Q8_smoke_color":    ("WHITE", "BLUE_GREY"),
    },
    "BELT_BROKEN": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("STARTS_BUT_ISSUE", "STARTS_NORMAL"),
        "Q2b_running_issue": ("NOISE", "NO_POWER"),
        "Q4_noise_detail":   ("SQUEAL", "WHINE"),
    },
    "FUEL_FILTER_CLOGGED": {
        "Q1_intent":         ("ENGINE_PROBLEM", "WONT_START"),
        "Q2_engine_start":   ("STARTS_BUT_ISSUE", "CRANKS_NO_START"),
        "Q2b_running_issue": ("STALLING", "NO_POWER"),
    },
    "FUEL_PUMP": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("CRANKS_NO_START", "STARTS_BUT_ISSUE"),
        "Q3_sound":          ("NORMAL_CRANKING", "WHIRRING"),
    },
    "IGNITION_SYSTEM": {
        "Q1_intent":         ("WONT_START", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("CRANKS_NO_START", "STARTS_BUT_ISSUE"),
        "Q3_sound":          ("NORMAL_CRANKING", "SINGLE_CLICK"),
    },
    "ELECTRICAL_FAULT_RAIN": {
        "Q1_intent":         ("WONT_START", "WEIRD_BEHAVIOR"),
        "Q2_engine_start":   ("NO_CRANK", "STARTS_BUT_ISSUE"),
        "Q3b_electrical":    ("SOME_LIGHTS_ON", "DIM_LIGHTS"),
    },
    "BRAKE_PAD_WORN": {
        "Q1_intent":         ("BRAKE_ISSUE", "WEIRD_BEHAVIOR"),
        "Q_brake_detail":    ("SQUEALING", "GRINDING"),
    },
    "BRAKE_FAILURE": {
        "Q1_intent":         ("BRAKE_ISSUE", "WEIRD_BEHAVIOR"),
        "Q_brake_detail":    ("SOFT_PEDAL", "PULL_ONE_SIDE"),
    },
    "CLUTCH_WORN": {
        "Q1_intent":         ("GEAR_ISSUE", "WEIRD_BEHAVIOR"),
        "Q_gear_detail":     ("SLIPPING", "CLUTCH_SOFT"),
    },
    "TRANSMISSION_ISSUE": {
        "Q1_intent":         ("GEAR_ISSUE", "WEIRD_BEHAVIOR"),
        "Q_gear_detail":     ("WONT_ENGAGE", "GRINDING"),
    },
    "SEVERE_MECHANICAL_TOW": {
        "Q1_intent":         ("WEIRD_BEHAVIOR", "ENGINE_PROBLEM"),
        "Q2_engine_start":   ("STARTS_BUT_ISSUE", "NO_CRANK"),
        "Q2b_running_issue": ("NOISE", "STALLING"),
        "Q4_noise_detail":   ("KNOCK", "CLUNK"),
    },
}


# ─── Incident dataclass ──────────────────────────────────────────────────

@dataclass
class Incident:
    """One synthetic incident with known ground truth."""
    id:                  str
    latitude:            float
    longitude:           float
    true_service_type:   str
    responses:           dict[str, Any]   # what the driver answered
    obd_data:            dict[str, Any] | None
    arrival_time_min:    float            # simulation clock at arrival


# ─── Generator ───────────────────────────────────────────────────────────

def _default_answers() -> dict[str, Any]:
    """Every field starts at NOT_ASKED / empty. Overrides come from conditional templates."""
    return {
        "Q1_intent":           "WONT_START",  # overridden below
        "Q2_engine_start":     "NOT_ASKED",
        "Q2b_running_issue":   "NOT_ASKED",
        "Q3_sound":            "NOT_ASKED",
        "Q3b_electrical":      "NOT_ASKED",
        "Q4_noise_detail":     "NOT_ASKED",
        "Q7_overheat_detail":  "NOT_ASKED",
        "Q8_smoke_color":      "NOT_ASKED",
        "Q_brake_detail":      "NOT_ASKED",
        "Q_gear_detail":       "NOT_ASKED",
        "Q6_smells":           "NO_SMELL",
        "Q5_lights":           [],
        "Q9_recent":           [],
        "location_type":       "URBAN",
        "recent_rain":         "NONE",
        "parked_overnight":    "OUTDOOR",
        "vehicle_age_bucket":  "3_7",
        "last_fueled":         "WITHIN_WEEK",
    }


def _sample_answers(true_type: str, rng: random.Random) -> dict[str, Any]:
    """Answer fields conditional on true fault, with NOISE_RATE per-field flipping."""
    answers = _default_answers()
    template = CONDITIONAL_ANSWERS.get(true_type, {})
    for field_, (typical, alt) in template.items():
        answers[field_] = alt if rng.random() < NOISE_RATE else typical
    # Add some Sri Lankan context noise so the samples aren't too uniform
    answers["location_type"]      = rng.choice(["URBAN", "URBAN", "URBAN", "RURAL", "HILL", "COASTAL"])
    answers["recent_rain"]        = rng.choice(["NONE", "NONE", "YESTERDAY", "WITHIN_3_DAYS", "MONSOON"])
    answers["parked_overnight"]   = rng.choice(["INDOOR", "OUTDOOR", "OUTDOOR"])
    answers["vehicle_age_bucket"] = rng.choice(["UNDER_3", "3_7", "3_7", "8_15", "8_15", "OVER_15"])
    return answers


def _sample_categorical(dist: dict[str, float], rng: random.Random) -> str:
    """Weighted-random draw from a probability dict."""
    r = rng.random()
    cum = 0.0
    for k, p in dist.items():
        cum += p
        if r <= cum:
            return k
    return list(dist.keys())[-1]  # float-rounding fallback


def generate_incidents(
    n:              int,
    seed:           int = 42,
    truth:          dict[str, float] | None = None,
    with_obd_frac:  float = 0.4,
    arrival_rate:   float = 0.5,   # incidents per minute (Poisson)
) -> list[Incident]:
    """
    Generate `n` incidents with Poisson-distributed arrival times, uniformly
    distributed across the Colombo bounding box, with true faults drawn from
    `truth` distribution and answers conditional on the truth.

    `with_obd_frac` = fraction of vehicles that have a paired OBD dongle
    (Tier 2 path). Their obd_data is a synthetic snapshot correlated with
    the true fault (defensive — for a first cut we generate coarse
    correlations that let the Tier 2 tree occasionally trigger).
    """
    rng = random.Random(seed)
    truth_dist = truth if truth is not None else build_truth_distribution()

    incidents: list[Incident] = []
    clock_min = 0.0
    for i in range(n):
        clock_min    += rng.expovariate(arrival_rate)   # inter-arrival ~ Exp(rate)
        true_type    = _sample_categorical(truth_dist, rng)
        responses    = _sample_answers(true_type, rng)
        # Synthetic OBD: rough correlations with truth. If not present, Tier 1 path.
        obd_data     = _sample_obd(true_type, rng) if rng.random() < with_obd_frac else None
        incidents.append(Incident(
            id                = f"inc_{i:05d}",
            latitude          = rng.uniform(COLOMBO_LAT_MIN, COLOMBO_LAT_MAX),
            longitude         = rng.uniform(COLOMBO_LON_MIN, COLOMBO_LON_MAX),
            true_service_type = true_type,
            responses         = responses,
            obd_data          = obd_data,
            arrival_time_min  = clock_min,
        ))
    return incidents


def _sample_obd(true_type: str, rng: random.Random) -> dict[str, Any]:
    """
    Very rough synthetic OBD snapshot. Only a handful of fields per truth
    class — enough for the Tier 2 tree to occasionally have a signal, not
    so precise that we're gaming the results.
    """
    obd: dict[str, Any] = {"available": True}
    # Everyone gets a nominal set; then perturb by truth
    obd["engine_rpm"]           = rng.randint(650, 850)
    obd["coolant_temp_c"]       = rng.randint(85, 95)
    obd["battery_voltage_v"]    = round(rng.uniform(12.4, 13.8), 2)
    obd["engine_load_percent"]  = round(rng.uniform(15, 40), 1)
    obd["fuel_level_percent"]   = round(rng.uniform(20, 90), 1)
    obd["ambient_temp_c"]       = rng.randint(26, 32)

    if true_type in ("BATTERY_REPLACE", "BATTERY_TERMINAL_CLEAN"):
        obd["battery_voltage_v"] = round(rng.uniform(10.5, 11.8), 2)
    elif true_type == "ALTERNATOR_ISSUE":
        obd["battery_voltage_v"] = round(rng.uniform(11.2, 12.2), 2)
    elif true_type in ("COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK", "ENGINE_OVERHEAT_SEVERE"):
        obd["coolant_temp_c"]    = rng.randint(105, 125)
    elif true_type == "FUEL_FILTER_CLOGGED":
        obd["fuel_level_percent"] = round(rng.uniform(15, 60), 1)
        obd["engine_load_percent"] = round(rng.uniform(55, 85), 1)
    return obd
