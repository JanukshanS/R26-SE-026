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

    # ── Weight sets (single source of truth for the whole pipeline) ──────────
    # DEPLOYED DEFAULT: original expert / domain-knowledge weights. Every produced
    # artifact (scored_incidents.csv, hotspots, dashboard model.json) uses these.
    # Correlation with SUMO speed_reduction_pct on the regenerated non-degenerate
    # grid (120 scenarios, real congestion): in-sample Pearson r ~= 0.60
    # (Spearman rho ~= 0.67). The earlier ~0.75 reflected the old confounded grid;
    # reproduce the current figure with scripts/report_metrics.py.
    WEIGHTS = {
        "capacity_loss": 0.25,
        "traffic_volume": 0.25,
        "temporal": 0.20,
        "location": 0.15,
        "incident_severity": 0.15,
    }

    # SENSITIVITY RESULT — NOT deployed by default. Weights fitted by SLSQP to
    # maximise correlation with SUMO ground truth (scripts/refine_model.py) on the
    # NEW NON-DEGENERATE grid, where ISF/CLF/TVF/TF/LF all vary independently:
    # incident_type spans 7 severities (ISF no longer constant), lanes_blocked is
    # {1,2}, and hour is sampled across the day decoupled from road-class demand
    # (so TF and TVF are no longer confounded). In-sample Pearson r ~= 0.926; the
    # ORIGINAL deployed weights score only r ~= 0.60 on this honest grid (the old
    # ~0.90 was an artefact of a degenerate near-noise signal). Held-out leave-one-
    # road-type-out pooled OOF r ~= 0.924, bootstrap 95% CI [0.885, 0.948]
    # (reproduce: scripts/refine_model.py + scripts/validate_weights_cv.py +
    # scripts/report_metrics.py).
    # IDENTIFIABILITY: CLF (raw r~0.88) and ISF (raw r~0.80) are now strongly
    # data-identified and carry almost all the fitted weight. TVF/TF/LF have small
    # raw correlations on this grid and stay near the lower bound -- treat their
    # weights as a floor, not a finding. Adopting these as the deployed default is a
    # project decision that regenerates every downstream score.
    WEIGHTS_REFINED = {
        "capacity_loss": 0.500,
        "traffic_volume": 0.050,
        "temporal": 0.050,
        "location": 0.071,
        "incident_severity": 0.329,
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

    # Peak volume-to-capacity (v/c) ratio by road class: how close to saturation each
    # road type runs at the daily peak. This decouples TVF (road-type-specific demand
    # pressure) from TF (the pure time-of-day curve) -- the two were previously
    # algebraically identical (capacity cancelled, leaving TVF == TF == hour*day).
    # Anchored to typical HCM/urban v/c ranges (arterials run near saturation at peak,
    # residential streets far below). Calibration knob -- replace with RDA junction
    # counts when real volume data is obtained.
    ROAD_PEAK_VC = {
        "motorway": 0.95,
        "trunk": 0.90,
        "primary": 0.85,
        "secondary": 0.70,
        "tertiary": 0.55,
        "residential": 0.40,
        "living_street": 0.30,
        "unclassified": 0.50,
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

    def __init__(self, weights: Optional[dict] = None):
        # Defaults to the deployed ORIGINAL weights. Pass WEIGHTS_REFINED (or any
        # dict) to score with the SUMO-fitted weights for comparison WITHOUT
        # changing the deployed pipeline, e.g. ImpactScoringModel(ImpactScoringModel.WEIGHTS_REFINED).
        self.WEIGHTS = dict(weights) if weights is not None else dict(self.WEIGHTS)

    def calculate_capacity_loss_factor(self, total_lanes: int, lanes_blocked: int) -> float:
        if total_lanes <= 0:
            return 1.0
        clf = lanes_blocked / total_lanes
        return min(clf, 1.0)

    def calculate_traffic_volume_factor(self, road_type: str, hour: int, day_of_week: int) -> float:
        # Demand pressure = peak v/c for the road class, scaled by the time-of-day/day curve.
        # NOT equal to TF: TF carries no road-class term, so TVF now contributes independent
        # road-type demand information. (Previously TVF reduced to hour*day, i.e. == TF.)
        peak_vc = self.ROAD_PEAK_VC.get(road_type, 0.6)
        hour_mult = self.HOUR_VOLUME_MULTIPLIER.get(hour, 0.5)
        day_mult = self.DAY_MULTIPLIER.get(day_of_week, 1.0)
        tvf = peak_vc * hour_mult * day_mult
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
        Predict congestion metrics using a deterministic input-output
        (Newell cumulative-count) queueing approximation.

        NOTE: this is a closed-form queueing surrogate, NOT a true
        Lighthill-Whitham-Richards (LWR) shockwave solver -- there is no
        fundamental diagram and no shockwave-speed term. The constants
        (jam_density=120 veh/km, avg_delay=duration/4, 15 km cap) are
        uncalibrated heuristics; predicted VHL currently over-estimates SUMO by
        a MEDIAN of 20x (range 0-357x) (reproduce: scripts/report_metrics.py),
        so the outputs should be read as a RELATIVE index, not absolute
        predictions, until calibrated against SUMO.
        Ref: Newell (1982), Applications of Queueing Theory.
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

    # ── ADDITIVE EXTENSIONS (Gaps #6 + #8) ──────────────────────────────────
    # The methods below are NEW and DO NOT touch WEIGHTS, score(), or any
    # existing factor method. The deployed pipeline (score / score_dataframe /
    # the produced CSVs and dashboard JSON) is byte-identical for existing
    # calls. They add (1) a per-score confidence band via Monte-Carlo over the
    # two genuinely uncertain inputs, and (2) a time-evolving impact curve.

    def score_with_uncertainty(self, incident: IncidentInput, n: int = 1000, seed: int = 42) -> dict:
        """
        GAP #6 — per-score uncertainty.

        Return a CONFIDENCE BAND around the point impact score by Monte-Carlo
        propagation of the two inputs that are genuinely uncertain at incident
        report time:

          * incident DURATION — the type-keyed INCIDENT_DURATION_MIN value is a
            population MEAN; the realised clearance time of any single incident
            scatters around it. We sample a log-normal with that mean and a
            coefficient of variation of 30% (CV=0.30, right-skewed: clearances
            run long more often than short). Duration feeds the incident
            SEVERITY factor multiplicatively, so a longer-than-expected
            clearance raises the score.
          * LANES_BLOCKED — first responders' lane-blockage report is ±1 lane
            uncertain; we perturb by {-1, 0, +1} (uniform) and clip to
            [1, total_lanes]. This feeds the capacity-loss factor.

        The point score() is left exactly as-is; here we re-derive the same
        weighted combination per draw, perturbing only CLF (via lanes_blocked)
        and ISF (via a duration multiplier on the type severity). TVF, TF and LF
        are deterministic given the report and are held fixed.

        Returns {score_mean, score_p05, score_p95, score_std}. The interval
        [p05, p95] is a 90% band a downstream consumer (Janukshan's dispatch)
        can use instead of a bare point estimate.
        """
        rng = np.random.default_rng(seed)

        # Deterministic-given-report factors (unchanged from score()).
        tvf = self.calculate_traffic_volume_factor(incident.road_type, incident.hour, incident.day_of_week)
        tf = self.calculate_temporal_factor(incident.hour, incident.day_of_week)
        lf = self.calculate_location_factor(incident.road_type)

        # Severity / duration baselines for this incident type.
        base_isf = self.calculate_incident_severity_factor(incident.incident_type)
        mean_duration = self.INCIDENT_DURATION_MIN.get(incident.incident_type, 45)
        total_lanes = max(int(incident.total_lanes), 1)

        # --- Duration draws: log-normal with target mean and CV=0.30 ---------
        cv = 0.30
        sigma = np.sqrt(np.log(1.0 + cv * cv))            # log-space std for the target CV
        mu = np.log(max(mean_duration, 1e-9)) - 0.5 * sigma * sigma  # so E[X] == mean_duration
        durations = rng.lognormal(mean=mu, sigma=sigma, size=n)
        # ISF perturbation: scale the type severity by realised/mean duration,
        # clipped to the model's [0,1] factor range (severity cannot exceed 1).
        isf_draws = np.clip(base_isf * (durations / mean_duration), 0.0, 1.0)

        # --- Lanes-blocked draws: ±1 uniform, clipped to [1, total_lanes] ----
        lane_perturb = rng.integers(low=-1, high=2, size=n)  # {-1,0,1}
        lanes_blocked = np.clip(int(incident.lanes_blocked) + lane_perturb, 1, total_lanes)
        clf_draws = np.minimum(lanes_blocked / total_lanes, 1.0)

        # Re-derive the score per draw with the SAME weighted form as score().
        raw = (
            self.WEIGHTS["capacity_loss"] * clf_draws +
            self.WEIGHTS["traffic_volume"] * tvf +
            self.WEIGHTS["temporal"] * tf +
            self.WEIGHTS["location"] * lf +
            self.WEIGHTS["incident_severity"] * isf_draws
        )
        scores = np.clip(raw * 10.0, 1.0, 10.0)

        return {
            "score_mean": round(float(np.mean(scores)), 2),
            "score_p05": round(float(np.percentile(scores, 5)), 2),
            "score_p95": round(float(np.percentile(scores, 95)), 2),
            "score_std": round(float(np.std(scores)), 3),
        }

    def impact_over_time(self, incident: IncidentInput, minutes) -> "np.ndarray":
        """
        GAP #8 — temporal dynamics: impact as a function of time SINCE the
        incident, instead of a single static snapshot.

        Physical picture (reusing predict_congestion's input-output queueing
        logic): while the incident is active over its expected DURATION the road
        runs with reduced capacity, so a queue BUILDS at the net excess arrival
        rate (queue length grows roughly linearly with elapsed time). Once the
        incident clears, full capacity is restored and the backlog DRAINS at the
        recovery rate, so the queue DECAYS back toward zero. The result is a
        rise-then-decay curve.

        Closed form (relative index in [0,1], where 1.0 == the peak queue at the
        moment of clearance):

            t <= D                  q(t)/q_peak = t / D                  (build)
            D <  t <= D + R         q(t)/q_peak = 1 - (t - D) / R        (decay)
            t  >  D + R             q(t)/q_peak = 0                       (recovered)

        with D = expected incident duration (INCIDENT_DURATION_MIN) and R = the
        recovery time from predict_congestion. If the road is undersaturated
        (no queue ever forms) the curve is flat zero. This is a SIMPLE triangular
        surrogate of the Newell cumulative-count queue, NOT a calibrated absolute
        prediction -- read it as a RELATIVE time profile of congestion severity.

        Parameters
        ----------
        minutes : int | float | array-like
            Time(s) since the incident in minutes. Scalars are accepted; the
            return is always a numpy array (length 1 for a scalar) for uniform
            downstream handling.

        Returns
        -------
        np.ndarray
            Relative impact index in [0,1], one value per requested minute.
        """
        t = np.atleast_1d(np.asarray(minutes, dtype=float))

        duration = float(self.INCIDENT_DURATION_MIN.get(incident.incident_type, 45))
        # Peak score from the static point model sets the *amplitude* a consumer
        # can multiply back in; the shape itself is the relative index.
        congestion = self.predict_congestion(incident, 0.0)
        recovery = float(congestion["recovery_minutes"])
        queue_peak = float(congestion["queue_km"])

        impact = np.zeros_like(t)
        if queue_peak <= 0.0 or duration <= 0.0:
            # Undersaturated: incident never produces a standing queue.
            return impact

        if recovery <= 0.0:
            # Degenerate recovery (e.g. capped/zero): collapse decay to an
            # instantaneous drop at clearance so the build phase still shows.
            recovery = 1e-9

        build = t <= duration
        decay = (t > duration) & (t <= duration + recovery)
        impact[build] = t[build] / duration
        impact[decay] = 1.0 - (t[decay] - duration) / recovery
        impact = np.clip(impact, 0.0, 1.0)
        return impact

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


def demo_uncertainty_and_decay():
    """
    Gaps #6 + #8: demonstrate the per-score confidence band and the
    impact-over-time curve for a sample incident. Asserts guard the contracts.
    """
    model = ImpactScoringModel()

    # Sample incident: minor accident on a primary road at the evening peak.
    incident = IncidentInput(6.9, 79.86, "primary", 2, 1, "accident_minor", 17, 2)

    point = model.score(incident)
    ci = model.score_with_uncertainty(incident, n=1000, seed=42)

    # --- Contract checks for the confidence band -----------------------------
    assert set(ci) == {"score_mean", "score_p05", "score_p95", "score_std"}, ci
    assert 1.0 <= ci["score_p05"] <= ci["score_mean"] <= ci["score_p95"] <= 10.0, ci
    assert ci["score_std"] >= 0.0, ci
    # The deterministic point score must lie inside (or on) the band.
    assert ci["score_p05"] <= point.score <= ci["score_p95"] + 1e-6, (point.score, ci)

    print(f"\n{'='*70}")
    print(f"  GAP #6 — PER-SCORE UNCERTAINTY (Monte-Carlo, n=1000, seed=42)")
    print(f"{'='*70}")
    print(f"  Incident: {incident.incident_type} on {incident.road_type} "
          f"({incident.lanes_blocked}/{incident.total_lanes} lanes) @ {incident.hour:02d}:00")
    print(f"  Deployed point score : {point.score}/10  [{point.priority.value}]")
    print(f"  Score with CI        : {ci['score_mean']} "
          f"[{ci['score_p05']}, {ci['score_p95']}]  (std {ci['score_std']})")

    # --- Impact-over-time curve ----------------------------------------------
    duration = model.INCIDENT_DURATION_MIN[incident.incident_type]
    grid = list(range(0, 121, 10))
    curve = model.impact_over_time(incident, grid)

    # Contract checks: in [0,1], starts at 0, peaks at clearance (t == duration).
    assert curve.shape == (len(grid),), curve.shape
    assert float(curve.min()) >= 0.0 and float(curve.max()) <= 1.0, curve
    assert curve[0] == 0.0, curve[0]
    peak_idx = int(np.argmax(curve))
    assert abs(grid[peak_idx] - duration) <= 10, (grid[peak_idx], duration)

    print(f"\n{'='*70}")
    print(f"  GAP #8 — IMPACT OVER TIME (relative index, peak=1.0 at clearance)")
    print(f"{'='*70}")
    print(f"  Expected duration {duration} min, "
          f"recovery {point.predicted_recovery_min} min")
    print(f"  {'t (min)':>8} | impact")
    print(f"  {'-'*8}-+-{'-'*16}")
    for tmin, val in zip(grid, curve):
        bar = "#" * int(round(val * 20))
        print(f"  {tmin:>8} | {val:0.2f} {bar}")

    return ci, curve


if __name__ == "__main__":
    demo()
    demo_uncertainty_and_decay()
