"""Retrieval over a small curated automotive knowledge base.

WHY THIS EXISTS. Everything else this service tells a driver is grounded in
something checkable: urgency comes from app/advice.py, garages and parts come
from the database, prices come from logged service records, and every id the
model returns is validated against a real row before it is believed.

One field was not. `how_its_done` on the recommendation - the description of
what the mechanic will physically do - came entirely from the model's own
training data. Nothing in the system had verified it. It is also the one claim
on that screen with safety consequences if it is wrong, since a driver uses it
to judge whether the work they paid for was actually carried out.

So this module retrieves passages from a corpus we wrote and can point at, and
those passages are handed to the model as the source it must write from. The
model still does the writing - selecting what is relevant to this driver and
saying it plainly - but it is now summarising a document instead of recalling
a fact, and the response names which documents it used.

HOW IT WORKS.

  1. Markdown files in knowledge/ are split into passages at level-2 headings.
     Each passage keeps its document title and heading, so a citation can name
     both.
  2. Passages are embedded once and the vectors cached on disk, keyed by a
     hash of the corpus. Editing any document invalidates the cache.
  3. A query built from the diagnosis retrieves the top passages by cosine
     similarity, with a small bonus for passages tagged to the component in
     question.

WHY NOT A VECTOR DATABASE. The corpus is a few dozen passages. Cosine
similarity over an in-memory array is exact, needs no extra service, and takes
under a millisecond. pgvector would add an operational dependency to make an
already-instant search differently instant.

DEGRADATION. Every failure path here returns fewer or no passages rather than
raising. No API key, no network, no corpus on disk: retrieval yields nothing,
the prompt says nothing about sources, and the caller behaves exactly as it
did before this module existed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

# knowledge/ sits beside app/, at the service root.
KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"
CACHE_PATH = KNOWLEDGE_DIR / ".embeddings.json"

EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_TIMEOUT_SEC = float(os.getenv("OPENAI_EMBED_TIMEOUT_SEC", "20"))

# Four passages is roughly a page of reference material: enough for the model
# to have something to say about both the procedure and what to check, without
# crowding out the garage and part data it also has to weigh.
DEFAULT_TOP_K = 4

# Relevance floors. Without one, top-k always returns something, so an
# unrelated question still retrieves four confident-looking citations.
#
# TWO NUMBERS BECAUSE THERE ARE TWO SCALES, and using one for both was a real
# bug in the first version of this file: cosine similarity and token overlap
# do not produce comparable values, so a floor tuned on one silently does
# almost nothing on the other.
#
# Measured on this corpus with text-embedding-3-small: on-topic queries score
# 0.50 to 0.70, while clearly unrelated ones ("how do I bake a cake", "capital
# of France") stay under 0.15. 0.30 sits in the middle of that gap rather than
# hugging either edge.
MIN_SCORE_SEMANTIC = 0.30
MIN_SCORE_KEYWORD = 0.15

# Passages tagged to the component being diagnosed, or to general advice, get a
# small nudge. Deliberately small: it breaks ties in favour of the right
# component without letting a barely-relevant brake passage outrank a strongly
# matching general one.
COMPONENT_BONUS = 0.06


@dataclass(frozen=True)
class Passage:
    """One level-2 section of one document."""

    id: str
    doc: str          # file stem, e.g. "brake-pad-replacement"
    title: str        # document title from frontmatter
    heading: str      # the level-2 heading this section sits under
    component: str    # brake | engine | tire | battery | general
    text: str

    @property
    def citation(self) -> str:
        return f"{self.title} - {self.heading}"


@dataclass(frozen=True)
class Retrieved:
    passage: Passage
    score: float


def _parse_frontmatter(raw: str) -> Tuple[Dict[str, str], str]:
    """Minimal YAML-ish frontmatter reader.

    Deliberately not a YAML dependency: the frontmatter here is a handful of
    scalar keys plus one bracketed list, and the corpus is ours, so a real
    parser would buy nothing but an import.
    """
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    head, body = raw[3:end], raw[end + 4 :]

    meta: Dict[str, str] = {}
    for line in head.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip().strip("[]")
    return meta, body


def _split_sections(body: str) -> List[Tuple[str, str]]:
    """Split on level-2 headings into (heading, text) pairs.

    Section granularity is what makes retrieval meaningful here. A whole
    document per vector would return the same brake file for every brake
    question; splitting at headings lets "what will they do" and "why is it
    grinding" pull genuinely different passages out of the same file.
    """
    parts = re.split(r"^##\s+(.+)$", body, flags=re.MULTILINE)
    # re.split with one capture group yields [preamble, head1, text1, ...].
    sections: List[Tuple[str, str]] = []
    for i in range(1, len(parts) - 1, 2):
        heading = parts[i].strip()
        text = " ".join(parts[i + 1].split()).strip()
        if text:
            sections.append((heading, text))
    return sections


def load_passages(directory: Path = KNOWLEDGE_DIR) -> List[Passage]:
    """Read and split the corpus. Missing directory yields an empty list."""
    if not directory.is_dir():
        return []

    passages: List[Passage] = []
    for path in sorted(directory.glob("*.md")):
        # Documentation about the corpus is not part of the corpus. Without
        # this, README.md is indexed as reference material and a driver asking
        # about brakes can be answered with text about how retrieval works.
        # Leading underscore is the same escape hatch for drafts.
        if path.stem.lower() == "readme" or path.stem.startswith("_"):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, body = _parse_frontmatter(raw)
        title = meta.get("title") or path.stem.replace("-", " ").capitalize()
        component = (meta.get("component") or "general").strip().lower()

        for index, (heading, text) in enumerate(_split_sections(body)):
            passages.append(
                Passage(
                    id=f"{path.stem}#{index}",
                    doc=path.stem,
                    title=title,
                    heading=heading,
                    component=component,
                    text=text,
                )
            )
    return passages


def corpus_fingerprint(passages: Sequence[Passage]) -> str:
    """Hash of everything that would change an embedding.

    The model name is in here too: switching embedding models silently reusing
    old vectors would compare points from two different spaces, which produces
    plausible-looking nonsense rather than an error.
    """
    h = hashlib.sha256()
    h.update(EMBED_MODEL.encode("utf-8"))
    for p in passages:
        h.update(p.id.encode("utf-8"))
        h.update(p.text.encode("utf-8"))
    return h.hexdigest()


# ── Embeddings ────────────────────────────────────────────────────────────

def _api_key() -> str:
    # Read at call time, never at import. Read at import, this silently
    # disables itself depending on whether dotenv ran first.
    return os.getenv("OPENAI_API_KEY", "").strip()


def _base_url() -> str:
    return os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


def _embed(texts: Sequence[str]) -> Optional[List[List[float]]]:
    """Embed a batch. None on any failure, so callers degrade instead of 500."""
    key = _api_key()
    if not key or not texts:
        return None
    try:
        with httpx.Client(timeout=EMBED_TIMEOUT_SEC) as client:
            resp = client.post(
                f"{_base_url()}/embeddings",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": EMBED_MODEL, "input": list(texts)},
            )
        if resp.status_code != 200:
            print(f"[knowledge] embeddings returned {resp.status_code}; retrieval disabled")
            return None
        rows = sorted(resp.json()["data"], key=lambda r: r["index"])
        return [r["embedding"] for r in rows]
    except Exception as exc:  # noqa: BLE001 - every failure degrades the same way
        print(f"[knowledge] embeddings unavailable: {exc}")
        return None


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# ── Keyword fallback ──────────────────────────────────────────────────────

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on",
    "at", "as", "by", "with", "that", "this", "be", "are", "was", "will",
    "what", "how", "why", "my", "your", "you", "we", "i", "do", "does", "not",
    "can", "has", "have", "from", "its", "so", "if", "than", "then",
}


def _tokens(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z]+", text.lower()) if t not in _STOPWORDS and len(t) > 2]


def _keyword_score(query: str, passage: Passage) -> float:
    """Jaccard-ish overlap, used when embeddings are unavailable.

    Far weaker than embeddings, and it exists for two reasons: the eval suite
    must be runnable with no API key and no network, and a demo must not lose
    the citation feature because a key expired.
    """
    q = set(_tokens(query))
    if not q:
        return 0.0
    p = set(_tokens(passage.heading + " " + passage.text))
    if not p:
        return 0.0
    return len(q & p) / len(q)


# ── The index ─────────────────────────────────────────────────────────────

class KnowledgeIndex:
    """Passages plus their vectors, built once and reused."""

    def __init__(self, passages: List[Passage], vectors: Optional[List[List[float]]]):
        self.passages = passages
        self.vectors = vectors

    @property
    def is_semantic(self) -> bool:
        """True when real embeddings backed the index, false on keyword fallback."""
        return self.vectors is not None

    def search(
        self, query: str, *, component: Optional[str] = None, k: int = DEFAULT_TOP_K
    ) -> List[Retrieved]:
        if not self.passages or not query.strip():
            return []

        scores: List[float]
        semantic = False
        if self.vectors is not None:
            embedded = _embed([query])
            if embedded:
                qv = embedded[0]
                scores = [_cosine(qv, v) for v in self.vectors]
                semantic = True
            else:
                # The corpus embedded earlier but this query could not. Falling
                # back keeps the feature working rather than returning nothing,
                # and the floor has to follow the scale we actually used.
                scores = [_keyword_score(query, p) for p in self.passages]
        else:
            scores = [_keyword_score(query, p) for p in self.passages]

        floor = MIN_SCORE_SEMANTIC if semantic else MIN_SCORE_KEYWORD

        wanted = (component or "").strip().lower()
        ranked: List[Retrieved] = []
        for passage, score in zip(self.passages, scores):
            if wanted and passage.component in (wanted, "general"):
                score += COMPONENT_BONUS
            if score >= floor:
                ranked.append(Retrieved(passage=passage, score=score))

        ranked.sort(key=lambda r: -r.score)
        return ranked[:k]


_index: Optional[KnowledgeIndex] = None


def get_index(*, refresh: bool = False) -> KnowledgeIndex:
    """Build or return the index. Never raises.

    Built lazily on first use rather than at startup: an embedding call in the
    application lifespan would make the whole service fail to boot when OpenAI
    is unreachable, to add a feature that is meant to be optional.
    """
    global _index
    if _index is not None and not refresh:
        return _index

    passages = load_passages()
    if not passages:
        print(f"[knowledge] no documents found in {KNOWLEDGE_DIR}")
        _index = KnowledgeIndex([], None)
        return _index

    vectors = _load_cached_vectors(passages) if not refresh else None
    if vectors is None:
        vectors = _embed([f"{p.title}. {p.heading}. {p.text}" for p in passages])
        if vectors is not None:
            _save_cached_vectors(passages, vectors)

    mode = "embeddings" if vectors is not None else "keyword fallback"
    print(f"[knowledge] indexed {len(passages)} passages from "
          f"{len({p.doc for p in passages})} documents ({mode})")
    _index = KnowledgeIndex(passages, vectors)
    return _index


def _load_cached_vectors(passages: Sequence[Passage]) -> Optional[List[List[float]]]:
    if not CACHE_PATH.is_file():
        return None
    try:
        blob = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if blob.get("fingerprint") != corpus_fingerprint(passages):
        # Corpus edited since the cache was written. Silently rebuilding is
        # correct here: a stale vector for edited text retrieves the old
        # meaning, which is worse than paying for one embedding call.
        return None
    vectors = blob.get("vectors")
    if not isinstance(vectors, list) or len(vectors) != len(passages):
        return None
    return vectors


def _save_cached_vectors(passages: Sequence[Passage], vectors: List[List[float]]) -> None:
    try:
        CACHE_PATH.write_text(
            json.dumps({"fingerprint": corpus_fingerprint(passages), "vectors": vectors}),
            encoding="utf-8",
        )
    except OSError as exc:
        # A read-only deployment is fine - it just re-embeds on each boot.
        print(f"[knowledge] could not cache embeddings: {exc}")


def build_query(
    *,
    component: str,
    urgency: str,
    headline: str,
    vehicle: Optional[str] = None,
    part_name: Optional[str] = None,
) -> str:
    """The text we search with.

    Built from the diagnosis rather than from a fixed per-component string, so
    that a critical brake with a part chosen retrieves different passages from
    a healthy one being checked routinely - which is the whole justification
    for doing retrieval here instead of a dictionary lookup.
    """
    bits = [headline, f"{component} replacement procedure", f"urgency {urgency}"]
    if part_name:
        bits.append(part_name)
    if vehicle:
        bits.append(vehicle)
    if urgency in ("critical", "soon"):
        bits.append("what the mechanic does and what to check afterwards")
    else:
        bits.append("warning signs and when it needs attention")
    return ". ".join(b for b in bits if b)


def format_for_prompt(results: Sequence[Retrieved]) -> str:
    """Render passages for the model, each labelled with its citation."""
    if not results:
        return ""
    lines = []
    for i, r in enumerate(results, start=1):
        lines.append(f"[{i}] {r.passage.citation}\n{r.passage.text}")
    return "\n\n".join(lines)
