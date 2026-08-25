"""Recording, resolving and presenting trouble codes.

The behaviour under test is mostly about a single distinction: an empty list of
codes means "nothing stored" only when the read succeeded, and means "we do not
know" otherwise. Getting that wrong clears real faults off a driver's screen
and replaces them with a clean bill of health, which is the worst outcome this
feature can produce.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.controllers.fault_controller import active_faults, history, record_codes
from app.controllers.fault_presenter import escalated_urgency, sort_faults, to_out
from app.database import Base
from app.models.fault import DTCEvent


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def codes(*pairs):
    return [{"code": c, "status": s} for c, s in pairs]


# ── Recording ─────────────────────────────────────────────────────────────

def test_a_new_code_opens_a_fault(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)

    rows = active_faults(db, "V1")
    assert len(rows) == 1
    assert rows[0].code == "P0301"
    assert rows[0].component == "engine"
    assert rows[0].severity == "urgent"
    assert rows[0].times_seen == 1


def test_seeing_the_same_code_again_updates_rather_than_duplicates(db):
    for trip in ("t1", "t2", "t3"):
        record_codes(db, vehicle_id="V1", trip_id=trip,
                     codes=codes(("P0301", "confirmed")), read_ok=True)

    rows = active_faults(db, "V1")
    assert len(rows) == 1
    assert rows[0].times_seen == 3
    assert rows[0].last_trip_id == "t3"
    # The FIRST sighting is what dates the fault, so it must not move.
    assert rows[0].first_trip_id == "t1"


def test_a_code_that_disappears_is_resolved(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t2", codes=[], read_ok=True)

    assert active_faults(db, "V1") == []
    # Resolved rows are kept, because a code that comes back later is only
    # recognisable as a recurrence if the original row still exists.
    assert len(history(db, "V1")) == 1


def test_a_failed_read_never_resolves_anything(db):
    """The central rule of this module.

    A dongle that did not answer produces the same empty list as a car with
    nothing wrong. Treating it as "all clear" would wipe a live fault off the
    driver's screen and tell them everything was fine.
    """
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t2", codes=[], read_ok=False)

    assert [r.code for r in active_faults(db, "V1")] == ["P0301"]


def test_a_returning_code_is_recorded_as_a_recurrence(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t2", codes=[], read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t3",
                 codes=codes(("P0301", "confirmed")), read_ok=True)

    rows = active_faults(db, "V1")
    assert len(rows) == 1
    # Reopened, not duplicated - which is what preserves the history that makes
    # "cleared without being fixed" visible at all.
    assert rows[0].recurrences == 1
    assert rows[0].resolved_at is None


def test_resolution_only_touches_codes_that_are_actually_gone(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed"), ("P0171", "confirmed")), read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t2",
                 codes=codes(("P0171", "confirmed")), read_ok=True)

    assert [r.code for r in active_faults(db, "V1")] == ["P0171"]


def test_faults_are_scoped_to_one_vehicle(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    record_codes(db, vehicle_id="V2", trip_id="t2", codes=[], read_ok=True)

    # V2's clean read must not resolve V1's fault.
    assert [r.code for r in active_faults(db, "V1")] == ["P0301"]
    assert active_faults(db, "V2") == []


def test_pending_codes_are_never_reported_as_urgent(db):
    """A pending code has failed once and has not confirmed.

    It is a reason to watch, not to act, so it is capped below the severity its
    confirmed form would carry.
    """
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "pending")), read_ok=True)

    row = active_faults(db, "V1")[0]
    assert row.status == "pending"
    assert row.severity == "soon"


def test_a_pending_code_that_confirms_becomes_urgent(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "pending")), read_ok=True)
    record_codes(db, vehicle_id="V1", trip_id="t2",
                 codes=codes(("P0301", "confirmed")), read_ok=True)

    row = active_faults(db, "V1")[0]
    assert row.status == "confirmed"
    assert row.severity == "urgent"


def test_freeze_frame_keeps_the_first_snapshot(db):
    """The first frame describes the conditions that CAUSED the fault.

    A later snapshot of a recurring fault describes a different moment, so
    overwriting would lose the diagnostic value.
    """
    record_codes(db, vehicle_id="V1", trip_id="t1", codes=codes(("P0301", "confirmed")),
                 read_ok=True, freeze_frames={"P0301": {"rpm": 2340, "load": 68}})
    record_codes(db, vehicle_id="V1", trip_id="t2", codes=codes(("P0301", "confirmed")),
                 read_ok=True, freeze_frames={"P0301": {"rpm": 800, "load": 12}})

    frame = to_out(active_faults(db, "V1")[0]).freeze_frame
    assert frame == {"rpm": 2340, "load": 68}


def test_malformed_codes_are_skipped_not_fatal(db):
    """A strange diagnostics payload must never lose the trip it arrived with."""
    record_codes(
        db, vehicle_id="V1", trip_id="t1",
        codes=[{"code": "", "status": "confirmed"},
               {"code": "NOTACODE", "status": "confirmed"},
               {"code": "P0301", "status": "banana"},
               {}],
        read_ok=True,
    )
    rows = active_faults(db, "V1")
    assert [r.code for r in rows] == ["P0301"]
    # An unrecognised status falls back to the safe assumption.
    assert rows[0].status == "confirmed"


def test_unknown_code_is_stored_via_its_family(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0399", "confirmed")), read_ok=True)

    out = to_out(active_faults(db, "V1")[0])
    assert out.component == "engine"
    assert out.is_generic is True
    assert out.likely_causes == []


# ── Presentation ──────────────────────────────────────────────────────────

def test_consequence_and_multiplier_reach_the_driver(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)

    out = to_out(active_faults(db, "V1")[0])
    assert out.leads_to and "catalytic converter" in out.leads_to[0]
    assert out.cost_multiplier == 10.0


def test_faults_sort_most_serious_first(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0457", "confirmed"),   # monitor
                             ("P0301", "confirmed"),   # urgent
                             ("P0171", "confirmed")),  # soon
                 read_ok=True)

    ordered = sort_faults([to_out(r) for r in active_faults(db, "V1")])
    assert [f.code for f in ordered] == ["P0301", "P0171", "P0457"]


# ── Urgency escalation ────────────────────────────────────────────────────

def test_an_urgent_fault_escalates_a_healthy_component(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    faults = [to_out(r) for r in active_faults(db, "V1")]

    assert escalated_urgency("healthy", faults) == "critical"


def test_escalation_never_lowers_an_existing_urgency(db):
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0457", "confirmed")), read_ok=True)
    faults = [to_out(r) for r in active_faults(db, "V1")]

    # A trivial fuel-cap code must not talk a critically worn part down.
    assert escalated_urgency("critical", faults) == "critical"


def test_no_faults_leaves_urgency_untouched():
    assert escalated_urgency("soon", []) == "soon"


def test_health_percentage_is_never_touched_by_a_fault(db):
    """A misfire does not consume brake pad life.

    health_pct means "how much life is left", and letting a fault move it would
    corrupt the only figure the wear model is entitled to state. Urgency moves;
    the number does not.
    """
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)

    row = active_faults(db, "V1")[0]
    # Nothing on the stored fault carries a health figure at all - the two
    # concepts are kept structurally separate rather than by convention.
    assert not hasattr(row, "health_pct")
    assert to_out(row).model_dump().get("health_pct") is None


def test_a_fault_removes_the_wear_states_reassurance(db):
    """"Have P0301 diagnosed" and "No action needed" cannot both be true.

    A healthy component yields a do-nothing action. Once a fault escalates the
    urgency past that, leaving it in place puts the screen in contradiction
    with itself, and the driver cannot tell which line to believe.
    """
    from app.advice import build_advice
    from app.routes.advice import _apply_faults

    healthy = build_advice(
        component="engine", health_pct=88.0, status="Good",
        predicted_rul_km=132000, max_lifespan_km=150000, km_on_component=18000,
        is_estimated=False, rul_source="model", baseline_basis="measured",
    )
    assert "No action needed" in healthy.actions

    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    result = _apply_faults(healthy, [to_out(r) for r in active_faults(db, "V1")])

    assert result.urgency == "critical"
    assert "No action needed" not in result.actions
    assert any("P0301" in a for a in result.actions)


def test_a_trivial_fault_is_proportionate_not_alarming(db):
    """A fuel-cap code should be noticed, but must not shout.

    The first version of this test asserted the component stayed "healthy".
    That was wrong: a stored code means there IS something to look at, so
    moving to "monitor" is correct. What must NOT happen is a trivial code
    producing critical urgency, or - the gap this caught - escalating off
    healthy, stripping "No action needed", and leaving nothing in its place.
    """
    from app.advice import build_advice
    from app.routes.advice import _apply_faults

    healthy = build_advice(
        component="engine", health_pct=88.0, status="Good",
        predicted_rul_km=132000, max_lifespan_km=150000, km_on_component=18000,
        is_estimated=False, rul_source="model", baseline_basis="measured",
    )
    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0457", "confirmed")), read_ok=True)
    result = _apply_faults(healthy, [to_out(r) for r in active_faults(db, "V1")])

    assert result.urgency == "monitor"
    assert "No action needed" not in result.actions
    # Never empty, and never phrased as an emergency.
    assert result.actions
    assert any("P0457" in a for a in result.actions)
    assert not any("diagnosed" in a for a in result.actions)


# ── Wear and faults stay separate ───────────────────────────────────────────
#
# An earlier version escalated ComponentHealth.status from the fault severity,
# so a live misfire turned a 94%-healthy engine "Critical". That was wrong: the
# engine really is 94% through its life, and a misfire is a defect sitting on
# top of that rather than evidence of wear. Corrupting the one number the RUL
# prediction rests on, to carry an unrelated signal, made both harder to trust.
#
# _attach_faults is tested directly rather than through the endpoint: the
# regression is entirely in that function, and going through TestClient would
# drag in model loading and trip fixtures for no extra coverage.

def _health_fixture() -> "VehicleHealthResponse":
    from app.schemas.trip import ComponentHealth, VehicleHealthResponse

    return VehicleHealthResponse(
        vehicle_id="V1",
        overall_health_pct=91.0,
        overall_status="Good",
        trip_count=4,
        total_mileage_km=100.0,
        timestamp="2026-01-01T00:00:00Z",
        components=[
            ComponentHealth(component="Engine", health_pct=94.3, status="Good",
                            predicted_rul_km=141000, max_lifespan_km=150000,
                            confidence_note=""),
            ComponentHealth(component="Brake Pads", health_pct=88.0, status="Good",
                            predicted_rul_km=35000, max_lifespan_km=40000,
                            confidence_note=""),
        ],
    )


def test_an_urgent_fault_does_not_move_the_wear_status(db):
    from app.routes.predict import _attach_faults

    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    result = _attach_faults(db, "V1", _health_fixture())

    engine = next(c for c in result.components if c.component == "Engine")
    # Attached and visible to the UI...
    assert [f.code for f in engine.faults] == ["P0301"]
    # ...without touching a single wear figure beside it.
    assert engine.status == "Good"
    assert engine.health_pct == 94.3
    assert result.overall_status == "Good"
    assert result.overall_health_pct == 91.0


def test_faults_reach_only_their_own_component(db):
    from app.routes.predict import _attach_faults

    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0301", "confirmed")), read_ok=True)
    result = _attach_faults(db, "V1", _health_fixture())

    brakes = next(c for c in result.components if c.component == "Brake Pads")
    assert brakes.faults == []


def test_unmapped_faults_reach_the_top_level_but_no_component(db):
    """A transmission fault belongs to none of the four components.

    It must still be visible somewhere, or a dashboard light would have nothing
    on screen explaining it - so it lands in the top-level list only.
    """
    from app.routes.predict import _attach_faults

    record_codes(db, vehicle_id="V1", trip_id="t1",
                 codes=codes(("P0700", "confirmed")), read_ok=True)
    result = _attach_faults(db, "V1", _health_fixture())

    assert [f.code for f in result.faults] == ["P0700"]
    assert all(c.faults == [] for c in result.components)


def test_faults_checked_is_false_before_any_code_read(db):
    from app.routes.predict import _attach_faults

    result = _attach_faults(db, "V1", _health_fixture())
    assert result.faults_checked is False
    assert result.faults == []
