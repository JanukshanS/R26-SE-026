"""Backward-compatible re-exports. Prefer ``app.routes`` and ``app.controllers``."""

from app.routes.predict import COMPONENT_FEATURE_MAP, COMPONENT_LABELS, COMPONENT_MAX_LIFESPAN_KM, router  # noqa: F401
