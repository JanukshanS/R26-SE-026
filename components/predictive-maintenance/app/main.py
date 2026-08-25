from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import joblib
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import require_user
from app.database import Base, engine
from app.migrations import ensure_columns
from app.models.fault import DTCEvent
from app.models import ComponentHealthFloor, Garage, Part, ServiceRecord, TripMetrics, VehicleBaseline
from app.routes.admin_garages import router as admin_garages_router
from app.routes.admin_parts import router as admin_parts_router
from app.routes.advice import router as advice_router
from app.routes.fault_plan import router as fault_plan_router
from app.routes.faults import router as faults_router
from app.routes.recommend import router as recommend_router
from app.routes.explain import router as explain_router
from app.routes.ingest import router as ingest_router
from app.routes.marketplace import router as marketplace_router
from app.routes.predict import router as predict_router
from app.routes.service import router as service_router

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")

_COMPONENT_SUFFIXES = ["engine_rf", "engine_gb", "brake_rf", "brake_gb",
                       "tire_rf", "tire_gb", "battery_rf", "battery_gb"]


class _ModelRegistry:
    """Loads a joblib model the first time it is asked for, then caches it.

    The 8 model files are ~320 MB on disk and several times that once
    deserialised, but /predict/best only ever touches 4 of them. Loading on
    demand keeps a container that serves only /predict/best under ~300 MB
    instead of ~1 GB, while /predict/rf and /predict/gb still work.

    Exposes the same .get() and truthiness the routers already use, so it is a
    drop-in for the dict this used to return.
    """

    def __init__(self, models_dir: str, keys: list[str]) -> None:
        self._dir = models_dir
        self._available = [
            key for key in keys
            if os.path.exists(os.path.join(models_dir, f"{key}.joblib"))
        ]
        self._cache: Dict[str, Any] = {}

    def get(self, key: str) -> Optional[Any]:
        if key not in self._cache:
            if key not in self._available:
                return None
            print(f"[models] loading {key}.joblib")
            self._cache[key] = joblib.load(os.path.join(self._dir, f"{key}.joblib"))
        return self._cache[key]

    def __len__(self) -> int:
        return len(self._available)

    def available(self) -> list[str]:
        """Model keys that can be served, without loading any of them."""
        return list(self._available)


def _load_all_models() -> _ModelRegistry:
    registry = _ModelRegistry(MODELS_DIR, _COMPONENT_SUFFIXES)
    print(f"[startup] Found {len(registry)}/8 ML models in '{MODELS_DIR}' (loaded on first use)")
    if len(registry) == 0:
        print("[startup] No models found — run train_models.py then restart the server.")
    return registry


def _load_best_models() -> Dict[str, Any]:
    """Load best_models.json written by train_models.py."""
    path = os.path.join(MODELS_DIR, "best_models.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        print(f"[startup] Best model selection loaded: "
              + ", ".join(f"{c}={v['algorithm'].upper()}" for c, v in data.items()))
        return data
    print("[startup] best_models.json not found — /predict/best unavailable until retrained.")
    return {}


def _load_metrics() -> Dict[str, Any]:
    """Load metrics.json written by train_models.py."""
    path = os.path.join(MODELS_DIR, "metrics.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    print("[startup] metrics.json not found — /models/metrics unavailable until retrained.")
    return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create SQLite tables
    Base.metadata.create_all(bind=engine)
    # create_all only creates MISSING TABLES — it never adds a column to a table
    # that already exists, and the deployed DB holds real trips that can't be
    # regenerated (raw readings aren't persisted). See app/migrations.py.
    added = ensure_columns(engine, TripMetrics, ServiceRecord, VehicleBaseline, ComponentHealthFloor, Part, Garage, DTCEvent)
    if added:
        print(f"[startup] schema guard added {len(added)} column(s): {', '.join(added)}")
    # Load ML models and best-model selection into app state
    app.state.models = _load_all_models()
    app.state.best_models = _load_best_models()
    app.state.metrics = _load_metrics()
    yield
    # No cleanup needed for SQLite / in-process models


app = FastAPI(
    title="Predictive Vehicle Maintenance API",
    description=(
        "Processes OBD-II and IMU trip data to analyse component degradation "
        "and predict Remaining Useful Life (RUL) for Engine, Brake Pads, "
        "Tires, and Battery using Random Forest and Gradient Boosting models."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router, tags=["Ingest"], dependencies=[Depends(require_user)])
app.include_router(predict_router, tags=["Predict"], dependencies=[Depends(require_user)])
app.include_router(service_router, tags=["Service"], dependencies=[Depends(require_user)])
app.include_router(marketplace_router, tags=["Marketplace"], dependencies=[Depends(require_user)])
app.include_router(admin_parts_router)
app.include_router(admin_garages_router)
# The explain layer only rewords a diagnosis the caller already holds, but it
# spends money per request, so it stays behind the same auth as everything else.
app.include_router(advice_router, tags=["Advice"], dependencies=[Depends(require_user)])
app.include_router(recommend_router, tags=["Advice"], dependencies=[Depends(require_user)])
app.include_router(faults_router, tags=["Faults"], dependencies=[Depends(require_user)])
app.include_router(fault_plan_router, tags=["Faults"], dependencies=[Depends(require_user)])
app.include_router(explain_router, tags=["Explain"], dependencies=[Depends(require_user)])


@app.get("/health", tags=["Health"])
def health_check():
    registry = getattr(app.state, "models", None)
    best = getattr(app.state, "best_models", {})
    # Models load on first use, so this reports what can be served rather than
    # what is resident in memory.
    loaded = registry.available() if registry is not None else []
    return {
        "status": "ok",
        "models_loaded": loaded,
        "best_model_per_component": {
            c: v["algorithm"].upper() for c, v in best.items()
        } if best else "not available — run train_models.py",
    }
