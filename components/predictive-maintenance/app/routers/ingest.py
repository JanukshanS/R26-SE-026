"""Backward-compatible re-exports. Prefer ``app.routes`` and ``app.controllers``."""

from app.routes.ingest import (  # noqa: F401
    MAX_SAMPLE_GAP_SEC,
    MAX_TRIP_SEC,
    MIN_DISTANCE_KM,
    _effective_intervals,
    _estimate_distance_km,
    router,
)
