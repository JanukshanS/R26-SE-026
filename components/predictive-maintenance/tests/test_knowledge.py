"""Knowledge base loading and retrieval, entirely offline.

conftest blanks OPENAI_API_KEY, so every path here runs on the keyword
fallback. That is deliberate: these tests must never cost money, never need a
network, and must exercise the degraded path that a demo will actually hit if
a key expires. Retrieval QUALITY is measured separately in
tests/eval_retrieval.py, which does need a key.
"""
from __future__ import annotations

from pathlib import Path

from app.services.knowledge import (
    KnowledgeIndex,
    build_query,
    corpus_fingerprint,
    format_for_prompt,
    load_passages,
)


def write_doc(directory: Path, name: str, body: str) -> None:
    (directory / name).write_text(body, encoding="utf-8")


def test_documents_split_into_one_passage_per_heading(tmp_path: Path):
    write_doc(
        tmp_path,
        "sample.md",
        "---\ntitle: Sample guide\ncomponent: brake\n---\n\n"
        "## First heading\n\nFirst body.\n\n"
        "## Second heading\n\nSecond body.\n",
    )
    passages = load_passages(tmp_path)

    assert len(passages) == 2
    assert [p.heading for p in passages] == ["First heading", "Second heading"]
    assert all(p.title == "Sample guide" for p in passages)
    assert all(p.component == "brake" for p in passages)


def test_section_granularity_is_what_makes_retrieval_meaningful(tmp_path: Path):
    """Two sections of one document must be independently retrievable.

    If a whole document were one passage, every question about brakes would
    return the same block and retrieval would be a lookup wearing a costume.
    """
    write_doc(
        tmp_path,
        "brakes.md",
        "---\ntitle: Brakes\ncomponent: brake\n---\n\n"
        "## What the mechanic does\n\nThe caliper is unbolted and the pads slide out.\n\n"
        "## Warning signs\n\nA grinding noise means metal on metal.\n",
    )
    index = KnowledgeIndex(load_passages(tmp_path), None)

    procedure = index.search("what does the mechanic do to the caliper", k=1)
    symptom = index.search("grinding noise metal", k=1)

    assert procedure and procedure[0].passage.heading == "What the mechanic does"
    assert symptom and symptom[0].passage.heading == "Warning signs"


def test_missing_frontmatter_still_loads(tmp_path: Path):
    write_doc(tmp_path, "bare.md", "## Heading\n\nSome text.\n")
    passages = load_passages(tmp_path)

    assert len(passages) == 1
    # Falls back to the filename rather than dropping the document.
    assert passages[0].title
    assert passages[0].component == "general"


def test_missing_directory_yields_no_passages(tmp_path: Path):
    assert load_passages(tmp_path / "does-not-exist") == []


def test_unrelated_query_retrieves_nothing(tmp_path: Path):
    """The relevance floor must actually reject.

    Without it, top-k always returns something, so an unrelated question comes
    back with confident-looking citations attached to irrelevant text.
    """
    write_doc(
        tmp_path,
        "brakes.md",
        "---\ntitle: Brakes\ncomponent: brake\n---\n\n"
        "## Replacement\n\nThe caliper is unbolted and the pads slide out.\n",
    )
    index = KnowledgeIndex(load_passages(tmp_path), None)

    assert index.search("chocolate cake recipe baking flour sugar") == []


def test_empty_query_retrieves_nothing(tmp_path: Path):
    write_doc(tmp_path, "a.md", "## H\n\nSome brake text.\n")
    index = KnowledgeIndex(load_passages(tmp_path), None)

    assert index.search("   ") == []


def test_fingerprint_changes_when_a_document_is_edited(tmp_path: Path):
    """The embedding cache is keyed on this.

    A fingerprint that ignored an edit would serve vectors describing the old
    text, so retrieval would silently match the previous meaning - a failure
    with no error attached to it.
    """
    write_doc(tmp_path, "a.md", "---\ntitle: A\n---\n\n## H\n\nOriginal text.\n")
    before = corpus_fingerprint(load_passages(tmp_path))

    write_doc(tmp_path, "a.md", "---\ntitle: A\n---\n\n## H\n\nEdited text.\n")
    after = corpus_fingerprint(load_passages(tmp_path))

    assert before != after


def test_fingerprint_is_stable_when_nothing_changed(tmp_path: Path):
    write_doc(tmp_path, "a.md", "---\ntitle: A\n---\n\n## H\n\nText.\n")
    assert corpus_fingerprint(load_passages(tmp_path)) == corpus_fingerprint(
        load_passages(tmp_path)
    )


def test_query_differs_by_urgency():
    """Different situations must search for different things.

    This is the whole justification for retrieval over a per-component lookup:
    a critical part needs the procedure, a healthy one needs the warning signs.
    """
    critical = build_query(component="brake", urgency="critical", headline="Replace now")
    healthy = build_query(component="brake", urgency="healthy", headline="Looks fine")

    assert critical != healthy
    assert "mechanic" in critical
    assert "warning signs" in healthy


def test_prompt_block_labels_every_passage(tmp_path: Path):
    write_doc(
        tmp_path,
        "brakes.md",
        "---\ntitle: Brakes\ncomponent: brake\n---\n\n"
        "## Replacement\n\nThe caliper is unbolted.\n",
    )
    index = KnowledgeIndex(load_passages(tmp_path), None)
    rendered = format_for_prompt(index.search("caliper unbolted replacement"))

    # The citation must survive into the prompt, since the response attributes
    # the wording back to it.
    assert "Brakes - Replacement" in rendered
    assert "caliper" in rendered


def test_prompt_block_is_empty_when_nothing_retrieved():
    # An empty string is what tells the caller to omit the reference section
    # entirely rather than sending an empty heading.
    assert format_for_prompt([]) == ""


def test_readme_is_not_indexed_as_reference_material(tmp_path: Path):
    """Documentation about the corpus must not become part of the corpus.

    The loader globs *.md, so a README sitting beside the guides was being
    indexed - which meant a driver asking about brakes could be answered with
    text explaining how retrieval works.
    """
    write_doc(tmp_path, "README.md", "## How this works\n\nRetrieval uses cosine similarity.\n")
    write_doc(tmp_path, "_draft.md", "## Draft\n\nUnfinished notes.\n")
    write_doc(
        tmp_path,
        "brakes.md",
        "---\ntitle: Brakes\ncomponent: brake\n---\n\n## Replacement\n\nThe caliper is unbolted.\n",
    )

    docs = {p.doc for p in load_passages(tmp_path)}
    assert docs == {"brakes"}
