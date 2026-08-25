"""Stored trouble codes.

A CODE IS A STATE, NOT AN EVENT, which is why this is not a row per sighting.
The useful questions are "how long has this been wrong?", "is it getting more
frequent?" and "did someone clear it without fixing it?" - and none of those
can be answered by a log of appearances without grouping them back together
anyway. So there is one open row per (vehicle, code), carrying first_seen,
last_seen and times_seen.

RESOLVED ROWS ARE KEPT. A code that was cleared and came back is a much
stronger signal than a new one: it usually means the light was reset without
the cause being fixed. Deleting on resolution would throw that away, so
resolved_at is set and the row stays.
"""
from sqlalchemy import Column, Float, Integer, String, Text

from app.database import Base


class DTCEvent(Base):
    __tablename__ = "dtc_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id = Column(String(64), nullable=False, index=True)
    code = Column(String(8), nullable=False, index=True)

    # confirmed | pending | permanent. A pending code has failed one drive
    # cycle without confirming, so it is a warning ahead of the dash light
    # rather than a report of one.
    status = Column(String(16), nullable=False)

    # engine | brake | tire | battery | other, resolved through the catalogue
    # at write time so the health screen can group without a lookup per row.
    component = Column(String(16), nullable=False, index=True)
    severity = Column(String(16), nullable=False)

    first_seen_at = Column(String(32), nullable=False)
    last_seen_at = Column(String(32), nullable=False)
    # Set when a later successful read no longer reports the code. Null while
    # the fault is live. Never deleted - see the module docstring.
    resolved_at = Column(String(32), nullable=True)

    # How many separate trips reported it, and how many times it has come back
    # after being resolved. A recurrence is the interesting number.
    times_seen = Column(Integer, nullable=False, default=1)
    recurrences = Column(Integer, nullable=False, default=0)

    first_trip_id = Column(String(36), nullable=True)
    last_trip_id = Column(String(36), nullable=True)

    # Mode 02: the sensor snapshot the ECU stored at the moment the fault set.
    # Held as JSON because the available PIDs vary by vehicle, and a column per
    # PID would be mostly null.
    freeze_frame = Column(Text, nullable=True)

    # Odometer when first seen, so "500 km ago" is answerable later.
    first_seen_km = Column(Float, nullable=True)
