"""The "not sure" inference: guessing when a part was last replaced.

Pure arithmetic, no DB and no server. The rule is "assume the car was serviced
on schedule", and the cases below pin every branch of it - especially the ones
where the safe answer and the obvious answer differ.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.baseline import (
    COMPONENT_EXPECTED_LIFE_KM,
    ENGINE_OIL_INTERVAL_KM,
    WEAR_COMPONENTS,
    infer_install_km,
)

CASES = [
    # (odometer, expected_life, install_km, km_on_component, basis, note)
    (141_000, 50_000, 100_000, 41_000, "inferred_schedule", "worked example: tyres"),
    (141_000, 40_000, 120_000, 21_000, "inferred_schedule", "worked example: brakes"),
    (141_000, 80_000, 80_000, 61_000, "inferred_schedule", "worked example: battery"),
    (141_000, 150_000, 0, 141_000, "inferred_original", "never been due -> still original"),
    (100_000, 50_000, 50_000, 50_000, "inferred_schedule", "exact multiple -> due NOW, not brand new"),
    (50_000, 50_000, 0, 50_000, "inferred_original", "continuity at odometer == life"),
    (49_999, 50_000, 0, 49_999, "inferred_original", "just under one life"),
    (50_001, 50_000, 50_000, 1, "inferred_schedule", "just over -> freshly replaced"),
    (0, 50_000, 0, 0, "inferred_original", "brand-new vehicle"),
    (30_000, 0, 0, 30_000, "unknown", "unusable life -> never divide"),
    (30_000, -5, 0, 30_000, "unknown", "negative life -> never divide"),
    (-10, 50_000, 0, 0, "inferred_original", "nonsense odometer clamps to zero"),
]


def test_inference_cases():
    failures = []
    for odo, life, want_install, want_km_on, want_basis, note in CASES:
        install, km_on, basis = infer_install_km(float(odo), float(life))
        got = (install, km_on, basis)
        want = (float(want_install), float(want_km_on), want_basis)
        if got != want:
            failures.append(f"  odo={odo} L={life} ({note})\n    got  {got}\n    want {want}")
    assert not failures, "inference mismatches:\n" + "\n".join(failures)


def test_km_on_component_never_exceeds_expected_life():
    """A part cannot have done more than a full life without having been
    replaced - if it could, the "serviced on schedule" premise is broken."""
    for odo in range(0, 400_000, 997):
        for life in COMPONENT_EXPECTED_LIFE_KM.values():
            _, km_on, _ = infer_install_km(float(odo), float(life))
            assert km_on <= life, f"odo={odo} life={life} -> km_on={km_on}"


def test_install_km_is_never_in_the_future():
    for odo in range(0, 400_000, 997):
        for life in COMPONENT_EXPECTED_LIFE_KM.values():
            install, _, _ = infer_install_km(float(odo), float(life))
            assert install <= odo, f"odo={odo} life={life} -> install={install}"


def test_inference_never_reports_a_brand_new_part_on_a_used_car():
    """The dangerous failure mode: telling a driver a worn part is fresh."""
    for odo in range(1_000, 400_000, 997):
        for life in COMPONENT_EXPECTED_LIFE_KM.values():
            _, km_on, _ = infer_install_km(float(odo), float(life))
            assert km_on > 0, f"odo={odo} life={life} claimed a 0 km part"


def test_engine_is_excluded_from_wear_components():
    """Engines are not replaced on a schedule; engine health stays sensor-driven
    and oil is tracked on its own interval instead."""
    assert "engine" not in WEAR_COMPONENTS
    assert set(WEAR_COMPONENTS) == {"brake", "tire", "battery"}
    assert ENGINE_OIL_INTERVAL_KM == 5_000


def test_worked_example_health_percentages():
    """The numbers the plan promised for a 141,000 km car, end to end."""
    expected = {"tire": 18.0, "brake": 47.5, "battery": 23.8}
    for component, want_health in expected.items():
        life = float(COMPONENT_EXPECTED_LIFE_KM[component])
        _, km_on, _ = infer_install_km(141_000.0, life)
        health = round(min(max(life - km_on, 0.0) / life * 100, 100.0), 1)
        assert health == want_health, f"{component}: got {health}%, want {want_health}%"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
