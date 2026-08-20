"""Trip duration and distance derived from real sample offsets.

The old code computed both from ARRAY LENGTH: `duration = len(imu) * 2.0` and a
hardcoded 300 s per OBD reading, ignoring `timestamp_offset_sec` entirely. That
made a dev-mode trip sampling every 30 s report 10x its real distance, and made
any trip under ~10 minutes impossible to submit.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers.ingest import (
    MAX_SAMPLE_GAP_SEC,
    MIN_DISTANCE_KM,
    _effective_intervals,
    _estimate_distance_km,
)
from app.schemas import OBDReading


def _obd(offset: int, speed: float) -> OBDReading:
    return OBDReading(
        timestamp_offset_sec=offset,
        rpm=1500,
        speed_kmh=speed,
        coolant_temp_c=90,
        battery_voltage_v=14.0,
        ltft_percent=0.0,
        throttle_percent=20,
        engine_load_percent=40,
        intake_air_temp_c=35,
    )


def test_legacy_index_derived_offsets_still_work():
    """Old clients emit offsets of exactly index*300, so np.diff is a constant
    vector equal to the fallback — backwards compatible by construction."""
    dt = _effective_intervals([0, 300, 600, 900, 1200], 300.0)
    assert list(dt) == [300.0, 300.0, 300.0, 300.0]


def test_worked_example_from_the_plan():
    """5 readings, 300 s apart, constant 60 km/h = a real 20-minute trip.

    Old code: 5 * 60/12       = 25.0 km  (one rectangle per reading)
    New code: 4 * 300 * 60/3600 = 20.0 km
    Truth:    20 min at 60 km/h = 20.0 km
    """
    readings = [_obd(i * 300, 60.0) for i in range(5)]
    assert _estimate_distance_km(readings) == 20.0


def test_dense_sampling_no_longer_inflates_distance():
    """Dev mode samples every 30 s. Under the old fixed-300 s assumption this
    reported 10x reality purely because more samples arrived."""
    readings = [_obd(i * 30, 60.0) for i in range(11)]  # 300 s total at 60 km/h
    assert abs(_estimate_distance_km(readings) - 5.0) < 1e-9  # 5 min = 5 km


def test_trapezoid_handles_varying_speed():
    # 0 -> 60 km/h over 300 s, then steady 60 for 300 s.
    readings = [_obd(0, 0.0), _obd(300, 60.0), _obd(600, 60.0)]
    # trapezoids: (0+60)/2 * 300 + (60+60)/2 * 300, /3600
    assert abs(_estimate_distance_km(readings) - (2.5 + 5.0)) < 1e-9


def test_background_gap_is_capped():
    """A trip backgrounded for 40 minutes yields one enormous interval. Without
    capping, integrating cruising speed across it invents tens of km."""
    dt = _effective_intervals([0, 300, 300 + 2400, 300 + 2700], 300.0)
    assert list(dt) == [300.0, MAX_SAMPLE_GAP_SEC, 300.0]

    readings = [_obd(0, 60.0), _obd(300, 60.0), _obd(2700, 60.0)]
    # Uncapped this would be (300 + 2400) * 60/3600 = 45 km.
    assert _estimate_distance_km(readings) == (300 + MAX_SAMPLE_GAP_SEC) * 60 / 3600


def test_garbage_offsets_fall_back_to_uniform_spacing():
    dt = _effective_intervals([0, 500, 200, 900], 300.0)  # non-monotonic
    assert list(dt) == [300.0, 300.0, 300.0]


def test_all_zero_offsets_fall_back():
    """A client that forgot to set offsets sends all zeros: span is 0."""
    dt = _effective_intervals([0, 0, 0], 300.0)
    assert list(dt) == [300.0, 300.0]


def test_two_readings_is_the_structural_floor():
    readings = [_obd(0, 60.0), _obd(300, 60.0)]
    assert _estimate_distance_km(readings) == 5.0
    assert len(_effective_intervals([0, 300], 300.0)) == 1


def test_distance_never_returns_zero():
    """Downstream frequency metrics divide by distance."""
    assert _estimate_distance_km([_obd(0, 0.0), _obd(300, 0.0)]) == MIN_DISTANCE_KM


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
