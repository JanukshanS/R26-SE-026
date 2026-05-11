from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import joblib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers.ingest import router as ingest_router
from app.routers.predict import router as predict_router

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")

_COMPONENT_SUFFIXES = ["engine_rf", "engine_gb", "brake_rf", "brake_gb",
                       "tire_rf", "tire_gb", "battery_rf", "battery_gb"]


def _load_all_models() -> Dict[str, Any]:
    loaded: Dict[str, Any] = {}
    for key in _COMPONENT_SUFFIXES:
        path = os.path.join(MODELS_DIR, f"{key}.joblib")
        if os.path.exists(path):
            loaded[key] = joblib.load(path)
        else:
            loaded[key] = None
    n_loaded = sum(1 for v in loaded.values() if v is not None)
    print(f"[startup] Loaded {n_loaded}/8 ML models from '{MODELS_DIR}'")
    if n_loaded == 0:
        print("[startup] No models found — run train_models.py then restart the server.")
    return loaded


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

app.include_router(ingest_router, tags=["Ingest"])
app.include_router(predict_router, tags=["Predict"])


@app.get("/health", tags=["Health"])
def health_check():
    models = getattr(app.state, "models", {})
    best = getattr(app.state, "best_models", {})
    loaded = [k for k, v in models.items() if v is not None]
    return {
        "status": "ok",
        "models_loaded": loaded,
        "best_model_per_component": {
            c: v["algorithm"].upper() for c, v in best.items()
        } if best else "not available — run train_models.py",
    }
