"""Write the what-if parity fixture from the deployed geo scoring model.

Run from the repo root:
    components/geo-intelligence/.venv/bin/python apps/kaduna-web/scripts/gen_scoring_fixture.py
"""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "components/geo-intelligence/src"))

from impact_scoring import ImpactScoringModel, IncidentInput

ROADS = list(ImpactScoringModel.ROAD_CAPACITY_VPH) + ["service"]
TYPES = list(ImpactScoringModel.INCIDENT_SEVERITY) + ["other"]
OUT = Path(__file__).resolve().parents[1] / "src/lib/__fixtures__/scoring-parity.json"


def case(model, road, lanes, blocked, itype, hour, day):
    r = model.score(IncidentInput(6.9, 79.86, road, lanes, blocked, itype, hour, day))
    return {
        "input": {
            "roadType": road, "totalLanes": lanes, "lanesBlocked": blocked,
            "incidentType": itype, "hour": hour, "dayOfWeek": day,
        },
        "expected": {
            "score": r.score, "priority": r.priority.value, "queueKm": r.predicted_queue_km,
            "vhl": r.predicted_vhl, "recoveryMin": r.predicted_recovery_min,
        },
    }


def main():
    model = ImpactScoringModel()
    rng = random.Random(26)
    cases = []
    # Weekday peaks, where demand equals capacity and recovery takes the T/2 branch.
    for road in ROADS:
        for itype in TYPES:
            cases.append(case(model, road, 2, 1, itype, rng.choice([8, 18]), rng.randrange(5)))
    for _ in range(240):
        lanes = rng.randint(1, 6)
        cases.append(case(
            model, rng.choice(ROADS), lanes, rng.randint(1, lanes), rng.choice(TYPES),
            rng.randrange(24), rng.randrange(7),
        ))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("[\n" + ",\n".join(json.dumps(c) for c in cases) + "\n]\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
