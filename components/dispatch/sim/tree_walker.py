"""
============================================================================
Tree Walker — pure-Python evaluator for the exported nested-tree JSON
============================================================================

Reads `ml/exported_tree_tier{1,2}.json` (same JSON the TypeScript runtime
loads at boot) and predicts a probability distribution over service types
for a given input dict.

JSON STRUCTURE
--------------
    {
      "class_names":    [ServiceType, ...],
      "feature_names":  ["Q1_intent=WONT_START", ...],   # one-hot categorical
      "root": {
        "type": "split",
        "feature":   "Q1_intent=WONT_START",   # name (not index)
        "threshold": 0.5,
        "left":  { ...node...  },              # taken when feature_value <= 0.5
        "right": { ...node...  }               # taken when feature_value  > 0.5
      }
    }

    Leaf node:
      {
        "type": "leaf",
        "samples": N,
        "probabilities": { "SERVICE_TYPE": p, ... }
      }

FEATURE ENCODING (mirrors sklearn's one-hot on categorical inputs)
-----------------------------------------------------------------
A categorical field like Q1_intent=WONT_START becomes a boolean feature —
its value in the vector is 1.0 if the input has Q1_intent == "WONT_START",
else 0.0. Numeric features (OBD readings) pass through as their raw values.

Missing input fields → their one-hots stay 0, which is exactly what sklearn
does with `handle_unknown='ignore'`-style encoding. The tree's split at 0.5
routes those observations to the left branch (feature_value <= 0.5), same
as in production.

@author Janukshan Sivakumar - IT22635266
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class DecisionTree:
    """A loaded tree (Tier 1 or Tier 2). Immutable after construction."""

    def __init__(self, tree_json: dict[str, Any]):
        self.class_names:   list[str]   = tree_json["class_names"]
        self.feature_names: list[str]   = tree_json["feature_names"]
        self.root:          dict[str, Any] = tree_json["root"]

    @classmethod
    def load(cls, path: Path) -> "DecisionTree":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    # ------------------------------------------------------------------
    # Feature vector encoding
    # ------------------------------------------------------------------

    def encode(self, input_dict: dict[str, Any]) -> dict[str, float]:
        """
        Return {feature_name: value} covering every one-hot the tree could
        query. Splits reference features by NAME (not index), so we build a
        lookup instead of a positional vector.
        """
        vec: dict[str, float] = {name: 0.0 for name in self.feature_names}

        for field, value in input_dict.items():
            if value is None:
                continue
            # Categorical: multi-select comes as a list; single-select as a scalar
            if isinstance(value, list):
                for v in value:
                    key = f"{field}={v}"
                    if key in vec:
                        vec[key] = 1.0
                continue
            if isinstance(value, (str, bool)):
                key = f"{field}={value}"
                if key in vec:
                    vec[key] = 1.0
                continue
            # Numeric (OBD) — appears as its own bare feature name.
            if isinstance(value, (int, float)) and field in vec:
                vec[field] = float(value)

        return vec

    # ------------------------------------------------------------------
    # Tree traversal
    # ------------------------------------------------------------------

    def predict_proba(self, input_dict: dict[str, Any]) -> dict[str, float]:
        """Walk from root to leaf. Returns the leaf's `probabilities` dict."""
        vec  = self.encode(input_dict)
        node = self.root
        while node.get("type") == "split":
            f = node["feature"]
            t = node["threshold"]
            v = vec.get(f, 0.0)
            node = node["left"] if v <= t else node["right"]
        # Guarantee every class name has an entry (older leaves may omit zeros).
        raw = node.get("probabilities", {})
        return {c: float(raw.get(c, 0.0)) for c in self.class_names}

    def predict(self, input_dict: dict[str, Any]) -> tuple[str, float]:
        """Argmax + probability. Ties break by class-name order."""
        probs = self.predict_proba(input_dict)
        best_c, best_p = "", -1.0
        for c in self.class_names:
            if probs[c] > best_p:
                best_p, best_c = probs[c], c
        return best_c, best_p


# ─────────────────────────────────────────────────────────────────────────
# Convenience: load both tiers once and reuse across all strategies
# ─────────────────────────────────────────────────────────────────────────

_TIER_1: DecisionTree | None = None
_TIER_2: DecisionTree | None = None


def get_tree(tier: int, ml_dir: Path | None = None) -> DecisionTree:
    """Lazy-loaded, module-cached — every strategy shares the same trees."""
    global _TIER_1, _TIER_2
    if ml_dir is None:
        ml_dir = Path(__file__).parent.parent / "ml"
    if tier == 1:
        if _TIER_1 is None:
            _TIER_1 = DecisionTree.load(ml_dir / "exported_tree_tier1.json")
        return _TIER_1
    if tier == 2:
        if _TIER_2 is None:
            _TIER_2 = DecisionTree.load(ml_dir / "exported_tree_tier2.json")
        return _TIER_2
    raise ValueError(f"Unknown tier: {tier}")
