"""
============================================================================
UADO Diagnostic Triage — Sri Lanka-flavoured Adaptive Dataset Generator
============================================================================

Generates the synthetic dataset for the diagnostic decision tree under the
new architecture:

  - 19 ML-diagnosable service types focused on AMBIGUOUS cases. Trivially
    self-reportable cases (LOCKOUT, FLAT_TIRE, FUEL_EMPTY, MAJOR_CRASH, ...)
    are handled by a fast-path in the front-end form and never reach ML.

  - Adaptive questionnaire: not every question is asked every time. The form
    branches based on prior answers. Skipped questions are encoded as
    "NOT_ASKED" — the decision tree treats this as a categorical value.

  - Sri Lankan context features (location_type, recent_rain,
    parked_overnight, vehicle_age_bucket, last_fueled) are always asked
    because they meaningfully condition the diagnosis.

  - OBD telemetry sampled from the team-provided synthetic_telemetry_data.csv
    is joined per row for the Tier-2 dataset only.

USAGE:
    python generate_dataset.py --n 100 --seed 42

Outputs three CSVs in data/:
    questionnaire_dataset.csv   — manually-authored Q&A only
    obd_dataset.csv             — externally-sourced OBD readings + label
    tier2_joined.csv            — questionnaire + OBD per row

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

# Force UTF-8 stdout for Windows consoles defaulting to cp1252.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────
# Service-type catalog — 19 ML-diagnosable classes
# ─────────────────────────────────────────────────────────────────────────

SERVICE_TYPES = [
    # Battery & charging (4)
    "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE", "ALTERNATOR_ISSUE",
    # Starting (1)
    "STARTER_MOTOR",
    # Cooling (4)
    "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK", "ENGINE_OVERHEAT_SEVERE",
    # Belts (1)
    "BELT_BROKEN",
    # Fuel & ignition (3)
    "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
    # Electrical (1)
    "ELECTRICAL_FAULT_RAIN",
    # Brakes (2)
    "BRAKE_PAD_WORN", "BRAKE_FAILURE",
    # Drivetrain (2)
    "CLUTCH_WORN", "TRANSMISSION_ISSUE",
    # Severe mechanical (1)
    "SEVERE_MECHANICAL_TOW",
]

# Empirical SL prior — frequency observations from proposal §1.1 + mechanic
# consultations. Battery and cooling dominate; severe mechanical is rare.
SERVICE_TYPE_PRIOR = {
    "BATTERY_JUMP":           0.16,
    "BATTERY_TERMINAL_CLEAN": 0.06,
    "BATTERY_REPLACE":        0.08,
    "ALTERNATOR_ISSUE":       0.05,
    "STARTER_MOTOR":          0.06,
    "COOLANT_LOW":            0.07,
    "RADIATOR_FAN_ISSUE":     0.06,
    "RADIATOR_HOSE_LEAK":     0.04,
    "ENGINE_OVERHEAT_SEVERE": 0.03,
    "BELT_BROKEN":            0.04,
    "FUEL_FILTER_CLOGGED":    0.05,
    "FUEL_PUMP":              0.04,
    "IGNITION_SYSTEM":        0.05,
    "ELECTRICAL_FAULT_RAIN":  0.04,
    "BRAKE_PAD_WORN":         0.06,
    "BRAKE_FAILURE":          0.02,
    "CLUTCH_WORN":            0.04,
    "TRANSMISSION_ISSUE":     0.03,
    "SEVERE_MECHANICAL_TOW":  0.02,
}
assert abs(sum(SERVICE_TYPE_PRIOR.values()) - 1.0) < 1e-6
assert set(SERVICE_TYPE_PRIOR.keys()) == set(SERVICE_TYPES)


# ─────────────────────────────────────────────────────────────────────────
# Sri Lankan vehicles & locations
# ─────────────────────────────────────────────────────────────────────────

SL_VEHICLES = [
    ("Toyota",     "Corolla",      2018, "PETROL"),
    ("Toyota",     "Axio",         2017, "HYBRID"),
    ("Toyota",     "Aqua",         2015, "HYBRID"),
    ("Toyota",     "Premio",       2016, "PETROL"),
    ("Toyota",     "Vitz",         2019, "PETROL"),
    ("Toyota",     "Allion",       2014, "PETROL"),
    ("Toyota",     "Hilux",        2019, "DIESEL"),
    ("Toyota",     "Land Cruiser", 2016, "DIESEL"),
    ("Suzuki",     "Wagon R",      2020, "PETROL"),
    ("Suzuki",     "Alto",         2014, "PETROL"),
    ("Suzuki",     "Swift",        2018, "PETROL"),
    ("Suzuki",     "Maruti 800",   2008, "PETROL"),
    ("Honda",      "Vezel",        2017, "HYBRID"),
    ("Honda",      "Fit",          2016, "HYBRID"),
    ("Honda",      "Civic",        2019, "PETROL"),
    ("Nissan",     "March",        2015, "PETROL"),
    ("Nissan",     "Sunny",        2010, "PETROL"),
    ("Nissan",     "Caravan",      2012, "DIESEL"),
    ("Mitsubishi", "Lancer",       2010, "PETROL"),
    ("Mitsubishi", "Montero",      2015, "DIESEL"),
    ("Mitsubishi", "L200",         2017, "DIESEL"),
    ("Mazda",      "Familia",      2009, "PETROL"),
    ("Mazda",      "BT-50",        2018, "DIESEL"),
    ("Hyundai",    "Accent",       2013, "PETROL"),
    ("Kia",        "Picanto",      2017, "PETROL"),
    ("Mahindra",   "Bolero",       2015, "DIESEL"),
]

# (location_name, lat, lng, location_type)
SL_LOCATIONS = [
    ("Galle Road (A2), Bambalapitiya",    6.8801, 79.8590, "URBAN"),
    ("Marine Drive, Colombo 3",            6.9114, 79.8499, "COASTAL"),
    ("Baseline Road, Colombo 9",           6.9176, 79.8744, "URBAN"),
    ("Kandy Road (A1), Kelaniya",          6.9543, 79.8943, "URBAN"),
    ("Negombo Road, Wattala",              6.9921, 79.8898, "COASTAL"),
    ("High Level Road, Maharagama",        6.8482, 79.9252, "URBAN"),
    ("Southern Expressway (E01)",          6.7821, 80.0080, "URBAN"),
    ("Colombo–Katunayake Expressway (E03)", 7.1737, 79.8830, "URBAN"),
    ("Nugegoda junction",                  6.8723, 79.8897, "URBAN"),
    ("Dehiwala flyover",                   6.8567, 79.8650, "COASTAL"),
    ("Battaramulla, Pelawatta",            6.9000, 79.9180, "URBAN"),
    ("Rajagiriya, Diyawanna bridge",       6.9127, 79.8969, "URBAN"),
    ("Kaduwela, Avissawella road",         6.9309, 79.9844, "URBAN"),
    ("Moratuwa, Galle Road",               6.7737, 79.8814, "COASTAL"),
    ("Kottawa Junction",                   6.8420, 80.0000, "URBAN"),
    ("Galle Face area",                    6.9271, 79.8444, "COASTAL"),
    ("Kandy, near Peradeniya",             7.2710, 80.5950, "HILL"),
    ("Nuwara Eliya, Hill Country",         6.9497, 80.7891, "HILL"),
    ("Anuradhapura, Mihintale road",       8.3427, 80.4133, "RURAL"),
    ("Galle Fort area",                    6.0269, 80.2168, "COASTAL"),
]


# ─────────────────────────────────────────────────────────────────────────
# Adaptive form definition
# ─────────────────────────────────────────────────────────────────────────
#
# Each question lives in QUESTION_FLOW. The "next_by_answer" mapping decides
# which question is shown next given the current answer. If an answer maps
# to None, the form exits the branch and proceeds to the always-asked tail.
#
# QUESTIONS that are part of the always-asked tail are listed in TAIL_QUESTIONS.
# ─────────────────────────────────────────────────────────────────────────

QUESTION_FLOW = {
    # Q1 intent picker — only ML-engaging answers below; fast-path answers
    # (LOCKOUT, FLAT_TIRE, FUEL_EMPTY, MAJOR_CRASH, FIRE_RISK) are bypassed
    # by the front-end form and never produce dataset rows.
    "Q1_intent": {
        "next_by_answer": {
            "WONT_START":     "Q2_engine_start",
            "ENGINE_PROBLEM": "Q2_engine_start",
            "WEIRD_BEHAVIOR": "Q2_engine_start",
            "BRAKE_ISSUE":    "Q_brake_detail",
            "GEAR_ISSUE":     "Q_gear_detail",
        },
    },
    "Q2_engine_start": {
        "next_by_answer": {
            "STARTS_NORMAL":    "Q2b_running_issue",
            "STARTS_BUT_ISSUE": "Q2b_running_issue",
            "CRANKS_NO_START":  "Q3_sound",
            "NO_CRANK":         "Q3b_electrical",
        },
    },
    "Q2b_running_issue": {
        "next_by_answer": {
            "OVERHEATING": "Q7_overheat_detail",
            "NOISE":       "Q4_noise_detail",
            "NO_POWER":    None,
            "SMOKE":       "Q8_smoke_color",
            "STALLING":    None,
        },
    },
    "Q3_sound":            {"next_by_answer": {"_any_": None}},
    "Q3b_electrical":      {"next_by_answer": {"_any_": None}},
    "Q4_noise_detail":     {"next_by_answer": {"_any_": None}},
    "Q7_overheat_detail":  {"next_by_answer": {"_any_": None}},
    "Q8_smoke_color":      {"next_by_answer": {"_any_": None}},
    "Q_brake_detail":      {"next_by_answer": {"_any_": None}},
    "Q_gear_detail":       {"next_by_answer": {"_any_": None}},
}

# All single-select question IDs (in fixed column order for the CSV).
SINGLE_SELECT_QUESTIONS = [
    "Q1_intent", "Q2_engine_start", "Q2b_running_issue",
    "Q3_sound", "Q3b_electrical",
    "Q4_noise_detail", "Q7_overheat_detail", "Q8_smoke_color",
    "Q_brake_detail", "Q_gear_detail",
    "Q6_smells",
]

# Multi-select questions are always asked at the tail.
MULTI_SELECT_QUESTIONS = ["Q5_lights", "Q9_recent"]

DASHBOARD_LAMPS = ["BATTERY", "CHECK_ENGINE", "OIL", "TEMPERATURE",
                   "ABS", "BRAKE", "TIRE_PRESSURE", "SERVICE", "GLOW_PLUG", "NONE"]

RECENT_WARNINGS = ["HARD_START", "LIGHTS_FLICKER", "LOSS_OF_POWER",
                   "OVERHEATING_BEFORE", "UNUSUAL_NOISE", "SMELL_BEFORE", "NO_SIGNS"]

# Sri Lankan context features (always asked).
SL_CONTEXT_QUESTIONS = [
    "location_type",       # COASTAL / HILL / URBAN / RURAL
    "recent_rain",         # NONE / YESTERDAY / WITHIN_3_DAYS / MONSOON
    "parked_overnight",    # INDOOR / OUTDOOR
    "vehicle_age_bucket",  # UNDER_3 / 3_7 / 8_15 / OVER_15
    "last_fueled",         # TODAY_NEW_STATION / TODAY_USUAL / WITHIN_WEEK / OVER_WEEK
]


# ─────────────────────────────────────────────────────────────────────────
# Per-service-type scenario profiles
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class ScenarioProfile:
    """Likelihoods for a service type across the adaptive form + SL context.

    Keys in `answers` are question IDs; values are weight dicts {answer: w}.
    A question id absent from `answers` means: that path is unreachable for
    this service type (the form walker won't visit it).
    """
    answers:           dict[str, dict[str, float]] = field(default_factory=dict)
    lights:            dict[str, float] = field(default_factory=dict)   # multi-select Q5
    warnings:          dict[str, float] = field(default_factory=dict)   # multi-select Q9
    sl_context:        dict[str, dict[str, float]] = field(default_factory=dict)
    obd_failure_flag:  str = "no_failure"
    notes:             str = ""


# Common SL context defaults — most service types use these unless overridden.
DEFAULT_SL_CONTEXT = {
    "location_type":      {"URBAN": 0.55, "COASTAL": 0.20, "HILL": 0.10, "RURAL": 0.15},
    "recent_rain":        {"NONE": 0.55, "YESTERDAY": 0.15, "WITHIN_3_DAYS": 0.20, "MONSOON": 0.10},
    "parked_overnight":   {"INDOOR": 0.40, "OUTDOOR": 0.60},
    "vehicle_age_bucket": {"UNDER_3": 0.10, "3_7": 0.30, "8_15": 0.45, "OVER_15": 0.15},
    "last_fueled":        {"TODAY_NEW_STATION": 0.10, "TODAY_USUAL": 0.30,
                           "WITHIN_WEEK": 0.45, "OVER_WEEK": 0.15},
}


# Each scenario only fills in distributions for the questions on its typical path.
# Other branches (e.g. Q3_sound for an overheating scenario) won't be visited.
SCENARIOS: dict[str, ScenarioProfile] = {

    # ─── BATTERY family ───────────────────────────────────────────────
    "BATTERY_JUMP": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.95, "ENGINE_PROBLEM": 0.05},
            "Q2_engine_start":  {"NO_CRANK": 0.65, "CRANKS_NO_START": 0.20, "STARTS_BUT_ISSUE": 0.15},
            "Q3_sound":         {"RAPID_CLICKING": 0.60, "NOTHING": 0.30, "NORMAL_CRANKING": 0.10},
            "Q3b_electrical":   {"ALL_DEAD_NO_LIGHTS": 0.40, "DIM_LIGHTS": 0.50, "SOME_LIGHTS_ON": 0.10},
            "Q6_smells":        {"NO_SMELL": 0.95, "ROTTEN_EGGS": 0.05},
        },
        lights={"BATTERY": 0.55, "CHECK_ENGINE": 0.10, "NONE": 0.30},
        warnings={"HARD_START": 0.40, "LIGHTS_FLICKER": 0.20, "NO_SIGNS": 0.50},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "parked_overnight": {"OUTDOOR": 0.75, "INDOOR": 0.25},
            "vehicle_age_bucket": {"3_7": 0.30, "8_15": 0.40, "OVER_15": 0.20, "UNDER_3": 0.10},
        },
        obd_failure_flag="battery_issue_imminent",
        notes="Lights left on, short-trip car, heat-aged battery — jump fixes it.",
    ),

    "BATTERY_TERMINAL_CLEAN": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.85, "ENGINE_PROBLEM": 0.15},
            "Q2_engine_start":  {"NO_CRANK": 0.50, "CRANKS_NO_START": 0.30, "STARTS_BUT_ISSUE": 0.20},
            "Q3_sound":         {"NOTHING": 0.50, "RAPID_CLICKING": 0.40, "NORMAL_CRANKING": 0.10},
            "Q3b_electrical":   {"ALL_DEAD_NO_LIGHTS": 0.35, "DIM_LIGHTS": 0.55, "SOME_LIGHTS_ON": 0.10},
            "Q6_smells":        {"NO_SMELL": 0.95, "ROTTEN_EGGS": 0.05},
        },
        lights={"BATTERY": 0.35, "NONE": 0.50, "CHECK_ENGINE": 0.10},
        warnings={"HARD_START": 0.30, "NO_SIGNS": 0.55, "LIGHTS_FLICKER": 0.20},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "location_type":     {"COASTAL": 0.55, "URBAN": 0.30, "HILL": 0.05, "RURAL": 0.10},
            "parked_overnight":  {"OUTDOOR": 0.85, "INDOOR": 0.15},
            "vehicle_age_bucket": {"8_15": 0.50, "OVER_15": 0.30, "3_7": 0.15, "UNDER_3": 0.05},
        },
        obd_failure_flag="battery_issue_imminent",
        notes="Coastal humidity + outdoor parking + older car → terminal corrosion.",
    ),

    "BATTERY_REPLACE": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.85, "ENGINE_PROBLEM": 0.15},
            "Q2_engine_start":  {"NO_CRANK": 0.55, "CRANKS_NO_START": 0.20, "STARTS_BUT_ISSUE": 0.25},
            "Q3_sound":         {"RAPID_CLICKING": 0.30, "NOTHING": 0.55, "NORMAL_CRANKING": 0.15},
            "Q3b_electrical":   {"ALL_DEAD_NO_LIGHTS": 0.55, "DIM_LIGHTS": 0.40, "SOME_LIGHTS_ON": 0.05},
            "Q6_smells":        {"NO_SMELL": 0.85, "ROTTEN_EGGS": 0.15},
        },
        lights={"BATTERY": 0.65, "CHECK_ENGINE": 0.15, "NONE": 0.20},
        warnings={"HARD_START": 0.70, "LIGHTS_FLICKER": 0.40, "NO_SIGNS": 0.10},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "vehicle_age_bucket": {"OVER_15": 0.20, "8_15": 0.55, "3_7": 0.20, "UNDER_3": 0.05},
        },
        obd_failure_flag="battery_issue_imminent",
        notes="4+ year battery, cranking has been gradually slower; jump fades by next day.",
    ),

    "ALTERNATOR_ISSUE": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.50, "WEIRD_BEHAVIOR": 0.30, "WONT_START": 0.20},
            "Q2_engine_start":  {"STARTS_BUT_ISSUE": 0.55, "STARTS_NORMAL": 0.30, "NO_CRANK": 0.15},
            "Q2b_running_issue":{"NO_POWER": 0.50, "STALLING": 0.30, "NOISE": 0.20},
            "Q4_noise_detail":  {"WHINE": 0.55, "SQUEAL": 0.25, "GRIND": 0.20},
            "Q3_sound":         {"NORMAL_CRANKING": 0.50, "RAPID_CLICKING": 0.30, "NOTHING": 0.20},
            "Q3b_electrical":   {"DIM_LIGHTS": 0.60, "ALL_DEAD_NO_LIGHTS": 0.20, "SOME_LIGHTS_ON": 0.20},
            "Q6_smells":        {"BURNING_ELECTRICAL": 0.30, "NO_SMELL": 0.65, "ROTTEN_EGGS": 0.05},
        },
        lights={"BATTERY": 0.85, "CHECK_ENGINE": 0.30, "NONE": 0.10},
        warnings={"LIGHTS_FLICKER": 0.70, "LOSS_OF_POWER": 0.40, "HARD_START": 0.30},
        obd_failure_flag="battery_issue_imminent",
        notes="Battery light comes on while driving; alternator output below 13.5V.",
    ),

    "STARTER_MOTOR": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.95, "ENGINE_PROBLEM": 0.05},
            "Q2_engine_start":  {"NO_CRANK": 0.45, "CRANKS_NO_START": 0.30, "STARTS_BUT_ISSUE": 0.25},
            "Q3_sound":         {"SINGLE_CLICK": 0.40, "GRINDING": 0.25, "WHIRRING": 0.20, "NORMAL_CRANKING": 0.15},
            "Q3b_electrical":   {"SOME_LIGHTS_ON": 0.65, "DIM_LIGHTS": 0.20, "ALL_DEAD_NO_LIGHTS": 0.15},
            "Q6_smells":        {"NO_SMELL": 0.80, "BURNING_ELECTRICAL": 0.15, "BURNING_OIL": 0.05},
        },
        lights={"BATTERY": 0.20, "CHECK_ENGINE": 0.30, "NONE": 0.50},
        warnings={"HARD_START": 0.50, "UNUSUAL_NOISE": 0.45, "NO_SIGNS": 0.30},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "vehicle_age_bucket": {"OVER_15": 0.30, "8_15": 0.50, "3_7": 0.15, "UNDER_3": 0.05},
        },
        obd_failure_flag="battery_issue_imminent",
        notes="Solenoid or starter motor failing; cranking is intermittent or single-click.",
    ),

    # ─── COOLING family ───────────────────────────────────────────────
    "COOLANT_LOW": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.70, "WEIRD_BEHAVIOR": 0.20, "WONT_START": 0.10},
            "Q2_engine_start":  {"STARTS_NORMAL": 0.55, "STARTS_BUT_ISSUE": 0.40, "CRANKS_NO_START": 0.05},
            "Q2b_running_issue":{"OVERHEATING": 0.85, "NO_POWER": 0.10, "SMOKE": 0.05},
            "Q7_overheat_detail":{"TRAFFIC_ONLY": 0.50, "HILL_CLIMB": 0.30, "WITH_AC": 0.15, "ALWAYS": 0.05},
            "Q6_smells":        {"NO_SMELL": 0.75, "SWEET": 0.20, "BURNING_OIL": 0.05},
            "Q8_smoke_color":   {"WHITE": 0.85, "BLUE_GREY": 0.10, "BLACK": 0.05},
        },
        lights={"TEMPERATURE": 0.70, "CHECK_ENGINE": 0.20, "NONE": 0.20},
        warnings={"OVERHEATING_BEFORE": 0.60, "NO_SIGNS": 0.30, "LOSS_OF_POWER": 0.15},
        obd_failure_flag="engine_failure_imminent",
        notes="Just needs water — no visible leak; gradual coolant evaporation.",
    ),

    "RADIATOR_FAN_ISSUE": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.75, "WEIRD_BEHAVIOR": 0.20, "WONT_START": 0.05},
            "Q2_engine_start":  {"STARTS_NORMAL": 0.70, "STARTS_BUT_ISSUE": 0.30},
            "Q2b_running_issue":{"OVERHEATING": 0.95, "NO_POWER": 0.05},
            "Q7_overheat_detail":{"TRAFFIC_ONLY": 0.55, "WITH_AC": 0.40, "ALWAYS": 0.05},
            "Q6_smells":        {"NO_SMELL": 0.85, "BURNING_OIL": 0.10, "BURNING_ELECTRICAL": 0.05},
        },
        lights={"TEMPERATURE": 0.75, "CHECK_ENGINE": 0.25, "NONE": 0.20},
        warnings={"OVERHEATING_BEFORE": 0.50, "NO_SIGNS": 0.40},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "location_type": {"URBAN": 0.75, "COASTAL": 0.15, "HILL": 0.05, "RURAL": 0.05},
        },
        obd_failure_flag="engine_failure_imminent",
        notes="Colombo traffic + AC → fan motor cycle-fatigued. Cools fine on highway.",
    ),

    "RADIATOR_HOSE_LEAK": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.85, "WEIRD_BEHAVIOR": 0.15},
            "Q2_engine_start":  {"STARTS_NORMAL": 0.45, "STARTS_BUT_ISSUE": 0.40, "CRANKS_NO_START": 0.15},
            "Q2b_running_issue":{"OVERHEATING": 0.75, "SMOKE": 0.20, "NO_POWER": 0.05},
            "Q7_overheat_detail":{"HILL_CLIMB": 0.40, "ALWAYS": 0.30, "TRAFFIC_ONLY": 0.20, "WITH_AC": 0.10},
            "Q8_smoke_color":   {"WHITE": 0.95, "BLUE_GREY": 0.05},
            "Q6_smells":        {"SWEET": 0.55, "NO_SMELL": 0.35, "BURNING_OIL": 0.10},
        },
        lights={"TEMPERATURE": 0.80, "CHECK_ENGINE": 0.25},
        warnings={"OVERHEATING_BEFORE": 0.45, "UNUSUAL_NOISE": 0.10, "SMELL_BEFORE": 0.20, "NO_SIGNS": 0.35},
        obd_failure_flag="engine_failure_imminent",
        notes="Visible coolant under car; steam from engine bay.",
    ),

    "ENGINE_OVERHEAT_SEVERE": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.85, "WEIRD_BEHAVIOR": 0.15},
            "Q2_engine_start":  {"CRANKS_NO_START": 0.45, "STARTS_BUT_ISSUE": 0.40, "NO_CRANK": 0.15},
            "Q2b_running_issue":{"OVERHEATING": 0.85, "SMOKE": 0.15},
            "Q7_overheat_detail":{"ALWAYS": 0.85, "HILL_CLIMB": 0.10, "TRAFFIC_ONLY": 0.05},
            "Q8_smoke_color":   {"WHITE": 0.70, "BLUE_GREY": 0.25, "BLACK": 0.05},
            "Q3_sound":         {"NORMAL_CRANKING": 0.55, "GRINDING": 0.30, "RAPID_CLICKING": 0.15},
            "Q6_smells":        {"BURNING_OIL": 0.45, "SWEET": 0.30, "BURNING_ELECTRICAL": 0.15, "NO_SMELL": 0.10},
        },
        lights={"TEMPERATURE": 0.95, "OIL": 0.40, "CHECK_ENGINE": 0.50},
        warnings={"OVERHEATING_BEFORE": 0.85, "LOSS_OF_POWER": 0.40, "SMELL_BEFORE": 0.30},
        obd_failure_flag="engine_failure_imminent",
        notes="Head gasket likely blown / coolant in oil — needs tow, not on-scene fix.",
    ),

    # ─── BELT family ──────────────────────────────────────────────────
    "BELT_BROKEN": ScenarioProfile(
        answers={
            "Q1_intent":        {"WEIRD_BEHAVIOR": 0.45, "ENGINE_PROBLEM": 0.45, "WONT_START": 0.10},
            "Q2_engine_start":  {"STARTS_BUT_ISSUE": 0.55, "STARTS_NORMAL": 0.30, "CRANKS_NO_START": 0.15},
            "Q2b_running_issue":{"NOISE": 0.45, "OVERHEATING": 0.30, "NO_POWER": 0.20, "STALLING": 0.05},
            "Q4_noise_detail":  {"SQUEAL": 0.65, "WHINE": 0.20, "GRIND": 0.15},
            "Q7_overheat_detail":{"ALWAYS": 0.55, "TRAFFIC_ONLY": 0.30, "HILL_CLIMB": 0.15},
            "Q6_smells":        {"BURNING_OIL": 0.45, "NO_SMELL": 0.50, "BURNING_ELECTRICAL": 0.05},
        },
        lights={"BATTERY": 0.50, "TEMPERATURE": 0.45, "CHECK_ENGINE": 0.30},
        warnings={"UNUSUAL_NOISE": 0.65, "OVERHEATING_BEFORE": 0.30, "LIGHTS_FLICKER": 0.30},
        obd_failure_flag="engine_failure_imminent",
        notes="Squealing at startup → belt slipping; sudden snap → no charge & overheat.",
    ),

    # ─── FUEL & IGNITION family ───────────────────────────────────────
    "FUEL_FILTER_CLOGGED": ScenarioProfile(
        answers={
            "Q1_intent":        {"ENGINE_PROBLEM": 0.55, "WEIRD_BEHAVIOR": 0.30, "WONT_START": 0.15},
            "Q2_engine_start":  {"STARTS_BUT_ISSUE": 0.55, "STARTS_NORMAL": 0.20, "CRANKS_NO_START": 0.25},
            "Q2b_running_issue":{"NO_POWER": 0.55, "STALLING": 0.30, "NOISE": 0.10, "SMOKE": 0.05},
            "Q3_sound":         {"NORMAL_CRANKING": 0.85, "RAPID_CLICKING": 0.10, "WHIRRING": 0.05},
            "Q6_smells":        {"FUEL_SMELL": 0.40, "NO_SMELL": 0.55, "BURNING_OIL": 0.05},
        },
        lights={"CHECK_ENGINE": 0.65, "NONE": 0.35},
        warnings={"LOSS_OF_POWER": 0.65, "HARD_START": 0.40, "UNUSUAL_NOISE": 0.20},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "last_fueled": {"TODAY_NEW_STATION": 0.30, "TODAY_USUAL": 0.15,
                            "WITHIN_WEEK": 0.40, "OVER_WEEK": 0.15},
            "vehicle_age_bucket": {"OVER_15": 0.20, "8_15": 0.50, "3_7": 0.25, "UNDER_3": 0.05},
        },
        obd_failure_flag="engine_failure_imminent",
        notes="Sputtering on hill, gradual power loss. Often after refuel from new station.",
    ),

    "FUEL_PUMP": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.65, "ENGINE_PROBLEM": 0.30, "WEIRD_BEHAVIOR": 0.05},
            "Q2_engine_start":  {"CRANKS_NO_START": 0.75, "STARTS_BUT_ISSUE": 0.20, "NO_CRANK": 0.05},
            "Q3_sound":         {"NORMAL_CRANKING": 0.95, "RAPID_CLICKING": 0.05},
            "Q2b_running_issue":{"STALLING": 0.55, "NO_POWER": 0.40, "NOISE": 0.05},
            "Q6_smells":        {"NO_SMELL": 0.65, "FUEL_SMELL": 0.15, "BURNING_ELECTRICAL": 0.20},
        },
        lights={"CHECK_ENGINE": 0.55, "NONE": 0.40},
        warnings={"HARD_START": 0.55, "LOSS_OF_POWER": 0.45, "NO_SIGNS": 0.20},
        obd_failure_flag="engine_failure_imminent",
        notes="Cranks normally but won't fire; no fuel smell at injectors.",
    ),

    "IGNITION_SYSTEM": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.50, "ENGINE_PROBLEM": 0.40, "WEIRD_BEHAVIOR": 0.10},
            "Q2_engine_start":  {"CRANKS_NO_START": 0.60, "STARTS_BUT_ISSUE": 0.35, "NO_CRANK": 0.05},
            "Q3_sound":         {"NORMAL_CRANKING": 0.95, "RAPID_CLICKING": 0.05},
            "Q2b_running_issue":{"NO_POWER": 0.40, "STALLING": 0.30, "NOISE": 0.20, "SMOKE": 0.10},
            "Q6_smells":        {"FUEL_SMELL": 0.55, "BURNING_ELECTRICAL": 0.20, "NO_SMELL": 0.25},
        },
        lights={"CHECK_ENGINE": 0.85, "NONE": 0.15},
        warnings={"LOSS_OF_POWER": 0.45, "UNUSUAL_NOISE": 0.40, "HARD_START": 0.35},
        obd_failure_flag="engine_failure_imminent",
        notes="Cranks normally, fuel smell present at injectors; coil pack/distributor.",
    ),

    # ─── ELECTRICAL fault (rain-related) ──────────────────────────────
    "ELECTRICAL_FAULT_RAIN": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.50, "WEIRD_BEHAVIOR": 0.30, "ENGINE_PROBLEM": 0.20},
            "Q2_engine_start":  {"NO_CRANK": 0.55, "STARTS_BUT_ISSUE": 0.30, "CRANKS_NO_START": 0.15},
            "Q3_sound":         {"NOTHING": 0.60, "RAPID_CLICKING": 0.30, "NORMAL_CRANKING": 0.10},
            "Q3b_electrical":   {"ALL_DEAD_NO_LIGHTS": 0.60, "DIM_LIGHTS": 0.25, "SOME_LIGHTS_ON": 0.15},
            "Q2b_running_issue":{"STALLING": 0.45, "NO_POWER": 0.35, "NOISE": 0.10, "SMOKE": 0.10},
            "Q6_smells":        {"BURNING_ELECTRICAL": 0.55, "NO_SMELL": 0.40, "BURNING_OIL": 0.05},
        },
        lights={"CHECK_ENGINE": 0.60, "BATTERY": 0.40, "ABS": 0.30, "BRAKE": 0.20, "NONE": 0.15},
        warnings={"LIGHTS_FLICKER": 0.50, "LOSS_OF_POWER": 0.30, "NO_SIGNS": 0.40},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "recent_rain":      {"MONSOON": 0.55, "WITHIN_3_DAYS": 0.30, "YESTERDAY": 0.10, "NONE": 0.05},
            "parked_overnight": {"OUTDOOR": 0.85, "INDOOR": 0.15},
            "vehicle_age_bucket":{"OVER_15": 0.30, "8_15": 0.50, "3_7": 0.15, "UNDER_3": 0.05},
        },
        obd_failure_flag="engine_failure_imminent",
        notes="Water ingress in fuse box / ECU after monsoon. Common in older Japanese imports.",
    ),

    # ─── BRAKE family ─────────────────────────────────────────────────
    "BRAKE_PAD_WORN": ScenarioProfile(
        answers={
            "Q1_intent":        {"BRAKE_ISSUE": 0.85, "ENGINE_PROBLEM": 0.05, "WEIRD_BEHAVIOR": 0.10},
            "Q_brake_detail":   {"SQUEALING": 0.55, "GRINDING": 0.30, "PULL_ONE_SIDE": 0.10, "SOFT_PEDAL": 0.05},
            "Q6_smells":        {"BURNING_OIL": 0.30, "NO_SMELL": 0.65, "BURNING_ELECTRICAL": 0.05},
        },
        lights={"BRAKE": 0.30, "ABS": 0.10, "NONE": 0.65},
        warnings={"UNUSUAL_NOISE": 0.65, "NO_SIGNS": 0.30},
        sl_context={
            **DEFAULT_SL_CONTEXT,
            "vehicle_age_bucket": {"3_7": 0.30, "8_15": 0.45, "OVER_15": 0.15, "UNDER_3": 0.10},
        },
        obd_failure_flag="brake_issue_imminent",
        notes="Pads thin (pad_wear_mm low). Squealing under braking; long-time symptom.",
    ),

    "BRAKE_FAILURE": ScenarioProfile(
        answers={
            "Q1_intent":        {"BRAKE_ISSUE": 0.95, "ENGINE_PROBLEM": 0.05},
            "Q_brake_detail":   {"SOFT_PEDAL": 0.55, "GRINDING": 0.20, "PULL_ONE_SIDE": 0.15, "SQUEALING": 0.10},
            "Q6_smells":        {"BURNING_OIL": 0.45, "NO_SMELL": 0.45, "BURNING_ELECTRICAL": 0.10},
        },
        lights={"BRAKE": 0.85, "ABS": 0.50, "CHECK_ENGINE": 0.20, "NONE": 0.10},
        warnings={"NO_SIGNS": 0.40, "UNUSUAL_NOISE": 0.45, "LOSS_OF_POWER": 0.10},
        obd_failure_flag="brake_issue_imminent",
        notes="Soft/dropping pedal, low brake fluid; fluid loss or hydraulic failure → emergency.",
    ),

    # ─── DRIVETRAIN family ────────────────────────────────────────────
    "CLUTCH_WORN": ScenarioProfile(
        answers={
            "Q1_intent":        {"GEAR_ISSUE": 0.85, "ENGINE_PROBLEM": 0.10, "WEIRD_BEHAVIOR": 0.05},
            "Q_gear_detail":    {"SLIPPING": 0.55, "CLUTCH_SOFT": 0.30, "WONT_ENGAGE": 0.10, "GRINDING": 0.05},
            "Q6_smells":        {"BURNING_OIL": 0.55, "NO_SMELL": 0.40, "BURNING_ELECTRICAL": 0.05},
        },
        lights={"CHECK_ENGINE": 0.20, "NONE": 0.75},
        warnings={"LOSS_OF_POWER": 0.55, "UNUSUAL_NOISE": 0.20, "NO_SIGNS": 0.30},
        obd_failure_flag="engine_failure_imminent",
        notes="Clutch slipping under load; revs rise without speed gain. Burning smell.",
    ),

    "TRANSMISSION_ISSUE": ScenarioProfile(
        answers={
            "Q1_intent":        {"GEAR_ISSUE": 0.85, "WEIRD_BEHAVIOR": 0.10, "ENGINE_PROBLEM": 0.05},
            "Q_gear_detail":    {"WONT_ENGAGE": 0.45, "GRINDING": 0.30, "SLIPPING": 0.20, "CLUTCH_SOFT": 0.05},
            "Q6_smells":        {"BURNING_OIL": 0.30, "NO_SMELL": 0.65, "BURNING_ELECTRICAL": 0.05},
        },
        lights={"CHECK_ENGINE": 0.45, "SERVICE": 0.30, "NONE": 0.45},
        warnings={"UNUSUAL_NOISE": 0.50, "LOSS_OF_POWER": 0.40, "NO_SIGNS": 0.25},
        obd_failure_flag="engine_failure_imminent",
        notes="Gear slips, can't engage; auto box fluid burnt or solenoid failure.",
    ),

    # ─── SEVERE catch-all ─────────────────────────────────────────────
    "SEVERE_MECHANICAL_TOW": ScenarioProfile(
        answers={
            "Q1_intent":        {"WONT_START": 0.45, "ENGINE_PROBLEM": 0.40, "WEIRD_BEHAVIOR": 0.15},
            "Q2_engine_start":  {"NO_CRANK": 0.55, "CRANKS_NO_START": 0.30, "STARTS_BUT_ISSUE": 0.15},
            "Q3_sound":         {"GRINDING": 0.40, "NOTHING": 0.30, "NORMAL_CRANKING": 0.15, "WHIRRING": 0.15},
            "Q3b_electrical":   {"SOME_LIGHTS_ON": 0.55, "DIM_LIGHTS": 0.25, "ALL_DEAD_NO_LIGHTS": 0.20},
            "Q2b_running_issue":{"NOISE": 0.40, "OVERHEATING": 0.25, "NO_POWER": 0.20, "STALLING": 0.15},
            "Q4_noise_detail":  {"GRIND": 0.45, "CLUNK": 0.30, "KNOCK": 0.20, "WHINE": 0.05},
            "Q7_overheat_detail":{"ALWAYS": 0.65, "HILL_CLIMB": 0.20, "TRAFFIC_ONLY": 0.15},
            "Q6_smells":        {"BURNING_OIL": 0.55, "BURNING_ELECTRICAL": 0.20, "NO_SMELL": 0.25},
        },
        lights={"CHECK_ENGINE": 0.85, "OIL": 0.55, "TEMPERATURE": 0.45, "BATTERY": 0.30},
        warnings={"UNUSUAL_NOISE": 0.65, "LOSS_OF_POWER": 0.55, "OVERHEATING_BEFORE": 0.40, "SMELL_BEFORE": 0.30},
        obd_failure_flag="engine_failure_imminent",
        notes="Engine seized, axle broken, multi-system fault — definitely a tow.",
    ),
}

# Backfill SL context with defaults for any scenario that didn't set it.
for st, prof in SCENARIOS.items():
    for k, v in DEFAULT_SL_CONTEXT.items():
        prof.sl_context.setdefault(k, v)

assert set(SCENARIOS.keys()) == set(SERVICE_TYPES), \
    f"Scenario coverage mismatch: missing {set(SERVICE_TYPES) - set(SCENARIOS.keys())}"


# ─────────────────────────────────────────────────────────────────────────
# Sampling primitives
# ─────────────────────────────────────────────────────────────────────────

NOT_ASKED = "NOT_ASKED"


def weighted_choice(rng: random.Random, dist: dict[str, float]) -> str:
    keys, weights = list(dist.keys()), list(dist.values())
    total = sum(weights)
    r = rng.random() * total
    upto = 0.0
    for k, w in zip(keys, weights):
        upto += w
        if r <= upto:
            return k
    return keys[-1]


def multi_select(rng: random.Random, dist: dict[str, float],
                 universe: list[str]) -> list[str]:
    """Independent Bernoulli per option; if all 0, fall back to ['NONE']/['NO_SIGNS']."""
    selected = [opt for opt in universe if rng.random() < dist.get(opt, 0.0)]
    return selected


def walk_form(rng: random.Random, profile: ScenarioProfile) -> dict[str, str]:
    """
    Walk the adaptive form for a service type's scenario.
    Returns {question_id: answer or NOT_ASKED} for every single-select Q.
    """
    answers = {q: NOT_ASKED for q in SINGLE_SELECT_QUESTIONS}

    current = "Q1_intent"
    while current is not None:
        dist = profile.answers.get(current)
        if dist is None:
            # This branch isn't covered by the scenario — stop walking.
            break
        ans = weighted_choice(rng, dist)
        answers[current] = ans

        flow = QUESTION_FLOW.get(current, {}).get("next_by_answer", {})
        # "_any_" rule means any answer leads to None (end of branch)
        if "_any_" in flow:
            current = flow["_any_"]
        else:
            current = flow.get(ans)

    # Always-asked tail Q6_smells (not flow-routed; sampled directly)
    if "Q6_smells" in profile.answers:
        answers["Q6_smells"] = weighted_choice(rng, profile.answers["Q6_smells"])

    return answers


def sample_sl_context(rng: random.Random, profile: ScenarioProfile) -> dict[str, str]:
    return {
        k: weighted_choice(rng, profile.sl_context[k])
        for k in SL_CONTEXT_QUESTIONS
    }


def pick_vehicle(rng: random.Random, service_type: str) -> tuple:
    if service_type == "SEVERE_MECHANICAL_TOW":
        heavy = [v for v in SL_VEHICLES if v[1] in
                 {"Hilux", "Caravan", "Montero", "L200", "Bolero", "Land Cruiser", "BT-50"}]
        return heavy[rng.randrange(len(heavy))]
    return SL_VEHICLES[rng.randrange(len(SL_VEHICLES))]


def pick_location(rng: random.Random, location_type: str) -> tuple:
    matching = [l for l in SL_LOCATIONS if l[3] == location_type]
    if not matching:
        matching = SL_LOCATIONS
    return matching[rng.randrange(len(matching))]


# ─────────────────────────────────────────────────────────────────────────
# OBD telemetry sampling
# ─────────────────────────────────────────────────────────────────────────

DOCS_DIR      = Path(__file__).parent.parent.parent.parent / "docs"
TELEMETRY_CSV = DOCS_DIR / "synthetic_telemetry_data.csv"

OBD_FEATURES = [
    "battery_voltage_v", "battery_temp_c", "battery_charge_percent",
    "battery_health_percent", "alternator_output_v",
    "engine_temp_c", "coolant_temp_c", "engine_rpm",
    "oil_pressure_psi", "fuel_level_percent", "engine_load_percent",
    "ambient_temp_c",
    # Brake-related signals (relevant for new brake classes)
    "brake_fluid_level_psi", "brake_pad_wear_mm", "brake_temp_c",
]


def load_telemetry_pools() -> dict[str, pd.DataFrame]:
    if not TELEMETRY_CSV.exists():
        raise FileNotFoundError(
            f"Expected telemetry source at {TELEMETRY_CSV}\n"
            "(team-provided file)."
        )
    df = pd.read_csv(TELEMETRY_CSV)
    pools = {
        "battery_issue_imminent":
            df[df["battery_issue_imminent"] == 1],
        "engine_failure_imminent":
            df[df["engine_failure_imminent"] == 1],
        "brake_issue_imminent":
            df[df["brake_issue_imminent"] == 1],
        "no_failure":
            df[(df["engine_failure_imminent"] == 0)
               & (df["brake_issue_imminent"] == 0)
               & (df["battery_issue_imminent"] == 0)],
    }
    for name, pool in pools.items():
        if len(pool) == 0:
            print(f"[!] Pool '{name}' empty — falling back to full dataset.")
            pools[name] = df
    return pools


def sample_obd(rng: random.Random, pool: pd.DataFrame) -> dict:
    idx = rng.randrange(len(pool))
    row = pool.iloc[idx]
    return {feat: float(row[feat]) for feat in OBD_FEATURES}


# ─────────────────────────────────────────────────────────────────────────
# Incident generation
# ─────────────────────────────────────────────────────────────────────────

QUESTIONNAIRE_COLS = (
    SINGLE_SELECT_QUESTIONS
    + MULTI_SELECT_QUESTIONS
    + SL_CONTEXT_QUESTIONS
    + ["vehicle_make", "vehicle_model", "vehicle_year", "fuel_type",
       "location_name", "latitude", "longitude", "service_type"]
)
OBD_COLS = OBD_FEATURES + ["service_type"]


def generate_incident(rng: random.Random, service_type: str,
                      telemetry_pools: dict[str, pd.DataFrame]) -> dict:
    profile = SCENARIOS[service_type]

    # Walk the adaptive form
    answers = walk_form(rng, profile)

    # Multi-select tails
    lights   = multi_select(rng, profile.lights, DASHBOARD_LAMPS)
    if not lights:
        lights = ["NONE"]
    warnings = multi_select(rng, profile.warnings, RECENT_WARNINGS)
    if not warnings:
        warnings = ["NO_SIGNS"]

    # SL context
    sl_ctx = sample_sl_context(rng, profile)

    # Vehicle + location (location respects sampled location_type)
    veh = pick_vehicle(rng, service_type)
    loc = pick_location(rng, sl_ctx["location_type"])

    # OBD signals (joined for tier2 view)
    obd = sample_obd(rng, telemetry_pools[profile.obd_failure_flag])

    return {
        # Adaptive single-select answers
        **answers,
        # Multi-select tails (JSON-encoded for CSV-friendliness)
        "Q5_lights":   json.dumps(lights),
        "Q9_recent":   json.dumps(warnings),
        # SL context
        **sl_ctx,
        # OBD signals
        **obd,
        # Provenance metadata
        "vehicle_make":  veh[0],
        "vehicle_model": veh[1],
        "vehicle_year":  veh[2],
        "fuel_type":     veh[3],
        "location_name": loc[0],
        "latitude":      loc[1],
        "longitude":     loc[2],
        # Ground-truth label
        "service_type":  service_type,
    }


# ─────────────────────────────────────────────────────────────────────────
# Stratified counts + dataset assembly
# ─────────────────────────────────────────────────────────────────────────

def stratified_count(n: int, floor: int = 4) -> dict[str, int]:
    counts = {}
    for st in SERVICE_TYPES:
        counts[st] = max(floor, round(SERVICE_TYPE_PRIOR[st] * n))
    overshoot = sum(counts.values()) - n
    # If we overshot due to floor, trim from the largest classes.
    while overshoot > 0:
        biggest = max(counts, key=lambda k: counts[k])
        if counts[biggest] <= floor:
            break  # can't trim below floor
        counts[biggest] -= 1
        overshoot -= 1
    # If we undershoot, add to the largest class.
    while overshoot < 0:
        biggest = max(counts, key=lambda k: counts[k])
        counts[biggest] += 1
        overshoot += 1
    return counts


def build_obd_dataset(rng: random.Random, telemetry_pools: dict[str, pd.DataFrame],
                      n_per_class: int = 15) -> pd.DataFrame:
    """
    Externally-sourced OBD readings labelled via failure-flag mapping.
    Each pool maps to a list of plausible service types.
    """
    pool_to_labels = {
        "battery_issue_imminent": [
            "BATTERY_JUMP", "BATTERY_TERMINAL_CLEAN", "BATTERY_REPLACE",
            "ALTERNATOR_ISSUE", "STARTER_MOTOR",
        ],
        "engine_failure_imminent": [
            "COOLANT_LOW", "RADIATOR_FAN_ISSUE", "RADIATOR_HOSE_LEAK",
            "ENGINE_OVERHEAT_SEVERE", "BELT_BROKEN",
            "FUEL_FILTER_CLOGGED", "FUEL_PUMP", "IGNITION_SYSTEM",
            "ELECTRICAL_FAULT_RAIN", "CLUTCH_WORN", "TRANSMISSION_ISSUE",
            "SEVERE_MECHANICAL_TOW",
        ],
        "brake_issue_imminent": ["BRAKE_PAD_WORN", "BRAKE_FAILURE"],
    }
    rows = []
    for pool_name, labels in pool_to_labels.items():
        pool = telemetry_pools[pool_name]
        for label in labels:
            for _ in range(n_per_class):
                idx = rng.randrange(len(pool))
                row = pool.iloc[idx]
                obd_signals = {feat: float(row[feat]) for feat in OBD_FEATURES}
                obd_signals["service_type"] = label
                rows.append(obd_signals)
    return pd.DataFrame(rows).sample(frac=1, random_state=42).reset_index(drop=True)


def generate_dataset(n: int, seed: int, out_dir: Path) -> dict:
    rng = random.Random(seed)
    np.random.seed(seed)

    print(f"Loading telemetry pools from {TELEMETRY_CSV.name}...")
    telemetry_pools = load_telemetry_pools()
    for name, pool in telemetry_pools.items():
        print(f"  pool '{name}': {len(pool)} rows")

    counts = stratified_count(n)
    print(f"\nStratified per-class counts (target n={n}, achieved={sum(counts.values())}):")
    for st in SERVICE_TYPES:
        print(f"  {st:<25} {counts[st]:3d}")

    rows = []
    for service_type in SERVICE_TYPES:
        for _ in range(counts[service_type]):
            rows.append(generate_incident(rng, service_type, telemetry_pools))

    full_df = pd.DataFrame(rows).sample(frac=1, random_state=seed).reset_index(drop=True)

    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Questionnaire only (no OBD columns)
    quest_df = full_df[QUESTIONNAIRE_COLS].copy()
    quest_df.to_csv(out_dir / "questionnaire_dataset.csv", index=False)
    print(f"\n[OK] questionnaire_dataset.csv -> {len(quest_df)} rows, "
          f"{len(quest_df.columns)-1} feature columns")

    # 2. OBD-only (externally sourced)
    obd_df = build_obd_dataset(rng, telemetry_pools)
    obd_df.to_csv(out_dir / "obd_dataset.csv", index=False)
    print(f"[OK] obd_dataset.csv          -> {len(obd_df)} rows, "
          f"{len(obd_df.columns)-1} feature columns")

    # 3. Tier-2 joined (questionnaire + OBD)
    full_df.to_csv(out_dir / "tier2_joined.csv", index=False)
    print(f"[OK] tier2_joined.csv         -> {len(full_df)} rows, "
          f"{len(full_df.columns)-1} columns")

    return {"questionnaire": quest_df, "obd": obd_df, "tier2_joined": full_df}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n",       type=int, default=100, help="Total questionnaire incidents")
    p.add_argument("--seed",    type=int, default=42)
    p.add_argument("--out-dir", type=str, default="data")
    args = p.parse_args()

    out_dir = Path(__file__).parent / args.out_dir
    datasets = generate_dataset(args.n, args.seed, out_dir)

    print("\n=== Class balance ===")
    for name, df in datasets.items():
        print(f"\n  {name}:")
        print(df["service_type"].value_counts().sort_index().to_string())
        print(f"  total: {len(df)} rows, missing values: {df.isna().sum().sum()}")


if __name__ == "__main__":
    main()
