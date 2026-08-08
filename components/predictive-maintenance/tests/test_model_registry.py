"""Lazy model loading: only what is asked for, loaded once."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import _ModelRegistry, MODELS_DIR


def test_registry_is_lazy_cached_and_truthy():
    reg = _ModelRegistry(MODELS_DIR, ["engine_rf", "engine_gb", "missing_rf"])

    assert len(reg) == 2
    assert reg._cache == {}, "must not load anything at construction"
    assert reg.get("missing_rf") is None

    model = reg.get("engine_rf")
    assert model is not None
    assert reg.get("engine_rf") is model, "second get must hit the cache"
    assert set(reg._cache) == {"engine_rf"}, "must not load models nobody asked for"

    assert bool(reg) is True
    assert not _ModelRegistry(MODELS_DIR, ["missing_rf"])


if __name__ == "__main__":
    test_registry_is_lazy_cached_and_truthy()
    print("ok")
