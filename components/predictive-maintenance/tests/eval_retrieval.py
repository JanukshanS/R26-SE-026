"""Does retrieval actually find the right passage?

WHY A SEPARATE FILE AND NOT A TEST. Every case here needs an embedding call,
so this costs money and needs a network. The unit tests must stay free and
offline, so this is run deliberately:

    python -m tests.eval_retrieval

WHAT IT MEASURES. For each query, whether the expected document appears at all
in the top k (recall@k) and whether it appears first (precision@1). Recall is
the number that matters for this system: the passages are handed to a language
model that reads all of them, so a correct passage at position three is nearly
as useful as one at position one. Precision@1 is reported because a sharp drop
in it is an early warning that the corpus has developed two sections competing
to answer the same question.

WHAT IT DOES NOT MEASURE. Whether the retrieved passage is factually correct -
that is a question about the corpus, which is hand-written and reviewed, not
about retrieval. And whether the model then used the passage well, which is
visible in the response and not reducible to a number.

Cases deliberately include queries phrased as a driver would say them
("something is grinding when I stop"), not just as the system generates them,
because a corpus tuned only to its own generated queries would look perfect
and generalise badly.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Tuple

# Load the same .env the service uses, so the embedding key is found no matter
# which directory this is invoked from.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:  # pragma: no cover - dotenv is a dev convenience
    pass

from app.services.knowledge import DEFAULT_TOP_K, get_index

# (query, expected document stem, component or None)
CASES: List[Tuple[str, str, str]] = [
    # Procedure questions - what the system itself asks for a worn part.
    ("what will the mechanic do to replace my brake pads", "brake-pad-replacement", "brake"),
    ("how long does a brake pad change take", "brake-pad-replacement", "brake"),
    ("do both sides need doing at once", "brake-pad-replacement", "brake"),
    ("what does an oil and filter change involve", "engine-oil-service", "engine"),
    ("how is a new tyre fitted and balanced", "tyre-replacement", "tire"),
    ("what happens when a car battery is replaced", "battery-replacement", "battery"),

    # Symptom questions, phrased the way a driver would say them.
    ("something is grinding when I stop", "brake-warning-signs", "brake"),
    ("the brake pedal feels soft and sinks", "brake-warning-signs", "brake"),
    ("my steering wheel shakes at high speed", "tyre-replacement", "tire"),
    ("the engine is running hot", "engine-service-major", "engine"),
    ("car will not start in the morning", "battery-replacement", "battery"),

    # Where retrieval has to pick between neighbouring topics.
    ("is it dangerous to drive with worn tyres in heavy rain", "tyre-replacement", "tire"),
    ("why do my brakes wear out so fast in Colombo traffic", "brake-warning-signs", "brake"),
    ("my hybrid battery light is on which battery is it", "hybrid-vehicles", "battery"),
    ("what does long term fuel trim mean", "obd-readings-explained", None),
    ("how do I know the garage really changed the part", "checking-the-work", None),
    ("is the part warranty separate from the labour warranty", "checking-the-work", None),
    ("why does heat kill batteries here", "sri-lanka-driving-conditions", "battery"),
]


def main() -> int:
    index = get_index()
    if not index.passages:
        print("No corpus found - nothing to evaluate.")
        return 1
    if not index.is_semantic:
        print("WARNING: running on the keyword fallback, not embeddings.")
        print("Scores below are a floor, not the real figure.\n")

    hits = 0
    firsts = 0
    failures: List[str] = []

    for query, expected, component in CASES:
        results = index.search(query, component=component, k=DEFAULT_TOP_K)
        docs = [r.passage.doc for r in results]

        found = expected in docs
        first = bool(docs) and docs[0] == expected
        hits += int(found)
        firsts += int(first)

        mark = "PASS" if found else "MISS"
        rank = f"#{docs.index(expected) + 1}" if found else "-"
        print(f"  [{mark}] {rank:>3}  {query}")
        if not found:
            got = docs[0] if docs else "(nothing retrieved)"
            failures.append(f"{query!r}\n         expected {expected}, top hit was {got}")

    total = len(CASES)
    print(f"\n  recall@{DEFAULT_TOP_K}: {hits}/{total} ({hits / total:.0%})")
    print(f"  precision@1: {firsts}/{total} ({firsts / total:.0%})")

    if failures:
        print("\n  Misses:")
        for f in failures:
            print(f"    - {f}")

    # A miss is a corpus gap or a query the corpus cannot answer, both worth
    # knowing about, so this exits non-zero and can gate a build if wanted.
    return 0 if hits == total else 1


if __name__ == "__main__":
    sys.exit(main())
