"""The additive column guard: adds what's missing, keeps existing rows valid.

Simulates the real situation — a database created by an OLDER version of the
model (fewer columns) that already contains ingested trips which cannot be
regenerated, then run against the CURRENT model.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Column, Float, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.migrations import ensure_columns


def _old_and_new_models():
    """A table as it existed 'before', and the same table with columns added."""
    OldBase = declarative_base()
    NewBase = declarative_base()

    class OldTrip(OldBase):
        __tablename__ = "trip_metrics"
        id = Column(Integer, primary_key=True, autoincrement=True)
        trip_id = Column(String(36), unique=True, nullable=False)
        distance_km = Column(Float, nullable=False)

    class NewTrip(NewBase):
        __tablename__ = "trip_metrics"
        id = Column(Integer, primary_key=True, autoincrement=True)
        trip_id = Column(String(36), unique=True, nullable=False)
        distance_km = Column(Float, nullable=False)
        # The additions — all nullable, exactly as the guard requires.
        steering_reversal_rate = Column(Float, nullable=True)
        swerve_events = Column(Integer, nullable=True)
        behavior_source = Column(String(24), nullable=True)

    return OldBase, OldTrip, NewBase, NewTrip


def test_adds_missing_columns_and_preserves_existing_rows(tmp_path):
    db = tmp_path / "old.db"
    engine = create_engine(f"sqlite:///{db}")
    OldBase, OldTrip, _NewBase, NewTrip = _old_and_new_models()

    # A database from before the new columns existed, with real data in it.
    OldBase.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as s:
        s.add(OldTrip(trip_id="pre-existing-trip", distance_km=21.583))
        s.commit()

    added = ensure_columns(engine, NewTrip)

    assert sorted(added) == [
        "trip_metrics.behavior_source",
        "trip_metrics.steering_reversal_rate",
        "trip_metrics.swerve_events",
    ]

    cols = {c["name"] for c in inspect(engine).get_columns("trip_metrics")}
    assert {"steering_reversal_rate", "swerve_events", "behavior_source"} <= cols

    # The row that predates the feature must still load, with NULL in the new
    # fields — never a fabricated zero, which would be a false claim about the
    # driver rather than an absence of data.
    with Session() as s:
        row = s.query(NewTrip).filter_by(trip_id="pre-existing-trip").one()
        assert row.distance_km == 21.583
        assert row.steering_reversal_rate is None
        assert row.swerve_events is None
        assert row.behavior_source is None

    engine.dispose()  # Windows keeps the .db locked until the pool is closed


def test_second_run_is_a_no_op(tmp_path):
    """Steady state: the guard runs on every boot and must do nothing."""
    db = tmp_path / "idempotent.db"
    engine = create_engine(f"sqlite:///{db}")
    OldBase, _OldTrip, _NewBase, NewTrip = _old_and_new_models()
    OldBase.metadata.create_all(engine)

    assert len(ensure_columns(engine, NewTrip)) == 3
    assert ensure_columns(engine, NewTrip) == []
    assert ensure_columns(engine, NewTrip) == []

    engine.dispose()


def test_refuses_to_add_a_not_null_column(tmp_path):
    """SQLite can't add NOT NULL without a default, and inventing one would
    fabricate data for every existing row. The guard must decline, not crash."""
    db = tmp_path / "notnull.db"
    engine = create_engine(f"sqlite:///{db}")
    OldBase, OldTrip, _NB, _NT = _old_and_new_models()
    OldBase.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as s:
        s.add(OldTrip(trip_id="t1", distance_km=1.0))
        s.commit()

    BadBase = declarative_base()

    class BadTrip(BadBase):
        __tablename__ = "trip_metrics"
        id = Column(Integer, primary_key=True, autoincrement=True)
        trip_id = Column(String(36), unique=True, nullable=False)
        distance_km = Column(Float, nullable=False)
        must_not_be_added = Column(Float, nullable=False)

    assert ensure_columns(engine, BadTrip) == []
    cols = {c["name"] for c in inspect(engine).get_columns("trip_metrics")}
    assert "must_not_be_added" not in cols
    # and the existing row is untouched
    with engine.connect() as c:
        assert c.execute(text("select count(*) from trip_metrics")).scalar() == 1

    engine.dispose()


if __name__ == "__main__":
    import tempfile

    for fn in (
        test_adds_missing_columns_and_preserves_existing_rows,
        test_second_run_is_a_no_op,
        test_refuses_to_add_a_not_null_column,
    ):
        # ignore_cleanup_errors: Windows can still hold the .db handle briefly
        # after dispose(); the assertions have already run by then.
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            fn(Path(d))
        print(f"ok  {fn.__name__}")
