"""
Incident Impact Scoring Model for Kaduna.lk
Calculates a traffic impact severity score (1-10) for vehicle incidents
based on road characteristics, traffic conditions, and temporal factors.

Author: Asath M M (IT22633422)
Component: Geo-Intelligence & Traffic Impact Analysis
"""
import numpy as np
import pandas as pd
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class PriorityLevel(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class IncidentInput:
    """Input parameters for impact scoring."""
    latitude: float
    longitude: float
    road_type: str
    total_lanes: int
    lanes_blocked: int
    incident_type: str
    hour: int
    day_of_week: int  # 0=Monday, 6=Sunday
    speed_limit_kmh: Optional[float] = None


@dataclass
class ImpactResult:
    """Output of the impact scoring model."""
    score: float
    priority: PriorityLevel
    capacity_loss_factor: float
    traffic_volume_factor: float
    temporal_factor: float
    location_factor: float
    incident_severity_factor: float
    predicted_queue_km: Optional[float] = None
    predicted_vhl: Optional[float] = None
    predicted_recovery_min: Optional[float] = None


class ImpactScoringModel:
    """
    Calculates incident impact scores using a weighted multi-factor model.

    Factors:
    1. Capacity Loss Factor (CLF): What fraction of road capacity is lost
    2. Traffic Volume Factor (TVF): How busy the road is at this time
    3. Temporal Factor (TF): Time-of-day and day-of-week multiplier
    4. Location Factor (LF): Road importance and alternative route availability
    5. Incident Severity Factor (ISF): Type and expected duration of incident
    """

    WEIGHTS = {
        "capacity_loss": 0.25,
        "traffic_volume": 0.25,
        "temporal": 0.20,
        "location": 0.15,
        "incident_severity": 0.15,
    }

    ROAD_CAPACITY_VPH = {
        "motorway": 2200,
        "trunk": 1800,
        "primary": 1200,
        "secondary": 800,
        "tertiary": 600,
        "residential": 300,
        "living_street": 150,
        "unclassified": 400,
    }

    ROAD_LOCATION_FACTOR = {
        "motorway": 1.0,
        "trunk": 0.85,
        "primary": 0.70,
        "secondary": 0.50,
        "tertiary": 0.35,
        "residential": 0.15,
        "living_street": 0.10,
        "unclassified": 0.20,
    }

    HOUR_VOLUME_MULTIPLIER = {
        0: 0.05, 1: 0.03, 2: 0.02, 3: 0.02, 4: 0.05, 5: 0.15,
        6: 0.45, 7: 0.80, 8: 1.00, 9: 0.85, 10: 0.60, 11: 0.55,
        12: 0.65, 13: 0.60, 14: 0.55, 15: 0.65, 16: 0.80, 17: 0.95,
        18: 1.00, 19: 0.75, 20: 0.45, 21: 0.30, 22: 0.15, 23: 0.10,
    }

    DAY_MULTIPLIER = {
        0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0,  # Mon-Fri
        5: 0.6, 6: 0.4,  # Sat, Sun
    }

    INCIDENT_SEVERITY = {
        "flat_tire": 0.3,
        "engine_failure": 0.7,
        "accident_minor": 0.5,
        "accident_major": 1.0,
        "fuel_empty": 0.2,
        "battery_dead": 0.3,
        "overheating": 0.5,
    }

    INCIDENT_DURATION_MIN = {
        "flat_tire": 30,
        "engine_failure": 60,
        "accident_minor": 45,
        "accident_major": 120,
        "fuel_empty": 20,
        "battery_dead": 25,
        "overheating": 40,
    }

    def calculate_capacity_loss_factor(self, total_lanes: int, lanes_blocked: int) -> float:
        if total_lanes <= 0:
            return 1.0
        clf = lanes_blocked / total_lanes
        return min(clf, 1.0)

    def calculate_traffic_volume_factor(self, road_type: str, hour: int, day_of_week: int) -> float:
        capacity = self.ROAD_CAPACITY_VPH.get(road_type, 500)
        hour_mult = self.HOUR_VOLUME_MULTIPLIER.get(hour, 0.5)
        day_mult = self.DAY_MULTIPLIER.get(day_of_week, 1.0)

        estimated_volume = capacity * hour_mult * day_mult
        tvf = estimated_volume / capacity
        return min(tvf, 1.0)

    def calculate_temporal_factor(self, hour: int, day_of_week: int) -> float:
        hour_mult = self.HOUR_VOLUME_MULTIPLIER.get(hour, 0.5)
        day_mult = self.DAY_MULTIPLIER.get(day_of_week, 1.0)
        return min(hour_mult * day_mult, 1.0)

    def calculate_location_factor(self, road_type: str) -> float:
        return self.ROAD_LOCATION_FACTOR.get(road_type, 0.2)

    def calculate_incident_severity_factor(self, incident_type: str) -> float:
        return self.INCIDENT_SEVERITY.get(incident_type, 0.5)

    def predict_congestion(self, incident: IncidentInput, impact_score: float) -> dict:
        """
        Predict congestion metrics using simplified shockwave theory.
        Based on Lighthill-Whitham-Richards (LWR) model.
        """
        capacity = self.ROAD_CAPACITY_VPH.get(incident.road_type, 500)
        hour_mult = self.HOUR_VOLUME_MULTIPLIER.get(incident.hour, 0.5)
        day_mult = self.DAY_MULTIPLIER.get(incident.day_of_week, 1.0)

        arrival_rate = capacity * hour_mult * day_mult
        capacity_loss = incident.lanes_blocked / max(incident.total_lanes, 1)
        remaining_capacity = capacity * (1 - capacity_loss)

        duration_min = self.INCIDENT_DURATION_MIN.get(incident.incident_type, 45)

        if arrival_rate > remaining_capacity:
            excess_rate = arrival_rate - remaining_capacity
            jam_density = 120  # vehicles per km (typical urban jam)

            queue_km = (excess_rate * (duration_min / 60)) / jam_density
            queue_km = min(queue_km, 15)  # cap at 15 km

            avg_delay_per_vehicle = duration_min / 4  # simplified
            vehicles_affected = excess_rate * (duration_min / 60)
            vhl = vehicles_affected * (avg_delay_per_vehicle / 60)

            if arrival_rate < capacity:
                recovery_rate = capacity - arrival_rate
                recovery_min = (queue_km * jam_density) / (recovery_rate / 60)
            else:
                recovery_min = duration_min * 0.5
        else:
            queue_km = 0
            vhl = 0
            recovery_min = 0

        return {
            "queue_km": round(queue_km, 2),
            "vehicle_hours_lost": round(vhl, 1),
            "recovery_minutes": round(min(recovery_min, 180), 1),
        }

    def score(self, incident: IncidentInput) -> ImpactResult:
        """Calculate the impact score for an incident."""
        clf = self.calculate_capacity_loss_factor(incident.total_lanes, incident.lanes_blocked)
        tvf = self.calculate_traffic_volume_factor(incident.road_type, incident.hour, incident.day_of_week)
        tf = self.calculate_temporal_factor(incident.hour, incident.day_of_week)
        lf = self.calculate_location_factor(incident.road_type)
        isf = self.calculate_incident_severity_factor(incident.incident_type)

        raw_score = (
            self.WEIGHTS["capacity_loss"] * clf +
            self.WEIGHTS["traffic_volume"] * tvf +
            self.WEIGHTS["temporal"] * tf +
            self.WEIGHTS["location"] * lf +
            self.WEIGHTS["incident_severity"] * isf
        )

        score = round(raw_score * 10, 1)
        score = max(1.0, min(10.0, score))

        if score >= 8.0:
            priority = PriorityLevel.CRITICAL
        elif score >= 5.0:
            priority = PriorityLevel.HIGH
        elif score >= 3.0:
            priority = PriorityLevel.MEDIUM
        else:
            priority = PriorityLevel.LOW

        congestion = self.predict_congestion(incident, score)

        return ImpactResult(
            score=score,
            priority=priority,
            capacity_loss_factor=round(clf, 3),
            traffic_volume_factor=round(tvf, 3),
            temporal_factor=round(tf, 3),
            location_factor=round(lf, 3),
            incident_severity_factor=round(isf, 3),
            predicted_queue_km=congestion["queue_km"],
            predicted_vhl=congestion["vehicle_hours_lost"],
            predicted_recovery_min=congestion["recovery_minutes"],
        )

    def score_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Score a DataFrame of incidents. Returns the DataFrame with score columns added."""
        results = []
        for _, row in df.iterrows():
            incident = IncidentInput(
                latitude=row["latitude"],
                longitude=row["longitude"],
                road_type=row["road_type"],
                total_lanes=int(row["total_lanes"]),
                lanes_blocked=int(row["lanes_blocked"]),
                incident_type=row["incident_type"],
                hour=int(row["hour"]),
                day_of_week=int(row["day_of_week"]),
            )
            result = self.score(incident)
            results.append({
                "impact_score": result.score,
                "priority": result.priority.value,
                "clf": result.capacity_loss_factor,
                "tvf": result.traffic_volume_factor,
                "tf": result.temporal_factor,
                "lf": result.location_factor,
                "isf": result.incident_severity_factor,
                "predicted_queue_km": result.predicted_queue_km,
                "predicted_vhl": result.predicted_vhl,
                "predicted_recovery_min": result.predicted_recovery_min,
            })

        result_df = pd.DataFrame(results)
        return pd.concat([df.reset_index(drop=True), result_df], axis=1)


def demo():
    """Demonstrate the scoring model with example scenarios."""
    model = ImpactScoringModel()

    print(f"\n{'='*70}")
    print(f"  IMPACT SCORING MODEL — DEMONSTRATION")
    print(f"{'='*70}")

    scenarios = [
        {
            "name": "Major accident on expressway at rush hour",
            "input": IncidentInput(6.9, 79.86, "motorway", 4, 2, "accident_major", 8, 0),
        },
        {
            "name": "Flat tire on trunk road at rush hour",
            "input": IncidentInput(6.9, 79.87, "trunk", 2, 1, "flat_tire", 17, 2),
        },
        {
            "name": "Engine failure on primary road at midday",
            "input": IncidentInput(6.85, 79.88, "primary", 2, 1, "engine_failure", 12, 1),
        },
        {
            "name": "Flat tire on residential road at night",
            "input": IncidentInput(6.88, 79.90, "residential", 2, 1, "flat_tire", 23, 4),
        },
        {
            "name": "Minor accident on secondary road at morning rush",
            "input": IncidentInput(6.87, 79.89, "secondary", 2, 1, "accident_minor", 8, 0),
        },
        {
            "name": "Fuel empty on trunk road on Sunday afternoon",
            "input": IncidentInput(6.92, 79.85, "trunk", 3, 1, "fuel_empty", 14, 6),
        },
    ]

    for scenario in scenarios:
        result = model.score(scenario["input"])
        inp = scenario["input"]

        print(f"\n{'─'*70}")
        print(f"  Scenario: {scenario['name']}")
        print(f"{'─'*70}")
        print(f"  Road: {inp.road_type} ({inp.total_lanes} lanes, {inp.lanes_blocked} blocked)")
        print(f"  Type: {inp.incident_type}")
        print(f"  Time: {inp.hour:02d}:00 on {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][inp.day_of_week]}")
        print(f"")
        print(f"  IMPACT SCORE: {result.score}/10  [{result.priority.value}]")
        print(f"")
        print(f"  Factor Breakdown:")
        print(f"    Capacity Loss:     {result.capacity_loss_factor:.3f} (weight: {model.WEIGHTS['capacity_loss']})")
        print(f"    Traffic Volume:    {result.traffic_volume_factor:.3f} (weight: {model.WEIGHTS['traffic_volume']})")
        print(f"    Temporal:          {result.temporal_factor:.3f} (weight: {model.WEIGHTS['temporal']})")
        print(f"    Location:          {result.location_factor:.3f} (weight: {model.WEIGHTS['location']})")
        print(f"    Incident Severity: {result.incident_severity_factor:.3f} (weight: {model.WEIGHTS['incident_severity']})")
        print(f"")
        print(f"  Congestion Prediction:")
        print(f"    Predicted queue:    {result.predicted_queue_km} km")
        print(f"    Vehicle-hours lost: {result.predicted_vhl}")
        print(f"    Recovery time:      {result.predicted_recovery_min} min")


if __name__ == "__main__":
    demo()
