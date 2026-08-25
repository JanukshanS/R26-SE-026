# Knowledge base

Curated automotive reference material, retrieved at request time and used to
ground the repair description the driver reads.

## Why it exists

Everything else this service tells a driver is grounded in something
checkable:

| Output | Grounded in |
| --- | --- |
| Urgency, headline, actions | `app/advice.py` — deterministic rules |
| Garage and part recommendation | the database, every id validated before use |
| Price benchmark | drivers' own logged `service_records` |
| **Repair description (`how_its_done`)** | **this corpus** |

That last row used to come from the language model's training data alone. It
was the only ungrounded claim on the screen, and the one a driver uses to judge
whether the work they paid for was actually carried out.

The model still writes the text — choosing what matters for this driver and
saying it plainly — but it now summarises a document instead of recalling a
fact, and the response names which documents it used.

## How retrieval works

1. Each `*.md` file is split at level-2 headings into **passages**. Section
   granularity is the point: it lets "what will they do" and "why is it
   grinding" pull different passages out of the same file.
2. Passages are embedded once with `text-embedding-3-small` and cached in
   `.embeddings.json`, keyed by a hash of the corpus and the model name.
   Editing any document invalidates the cache automatically.
3. A query built from the **diagnosis** — component, urgency, headline,
   vehicle — retrieves the top 4 by cosine similarity, with a small bonus for
   passages tagged to the component in question.

Because the query is built from the diagnosis rather than a fixed per-component
string, a critical brake retrieves the replacement procedure while a healthy
one retrieves warning signs. That is what makes this retrieval rather than a
dictionary lookup.

### Why not a vector database

The corpus is 65 passages. Cosine similarity over an in-memory list is exact,
needs no extra service, and takes under a millisecond. pgvector would add an
operational dependency to make an already-instant search differently instant.

## Frontmatter

```yaml
---
title: Brake pad replacement      # shown in the citation
component: brake                  # brake | engine | tire | battery | general
topics: [replacement, procedure]  # documentation only, not used for matching
---
```

## Adding or editing a document

Write it, save it, done — the fingerprint changes and the next request
re-embeds. Two things worth honouring:

- **One question per `##` section.** A section answering two questions
  retrieves for both and is fully relevant to neither.
- **Add an eval case** in `tests/eval_retrieval.py` for anything new, phrased
  the way a driver would say it.

## Measuring retrieval

```bash
python -m tests.eval_retrieval     # needs an API key; costs a fraction of a cent
```

Reports **recall@4** (does the right document appear at all) and
**precision@1** (does it come first). Recall is the number that matters here:
all four passages go to a model that reads them all, so a correct passage at
position three is nearly as useful as one at position one. Precision@1 is
watched because a sharp drop means two sections have started competing to
answer the same question.

Current: **recall@4 100% (18/18), precision@1 78% (14/18)**.

`tests/test_knowledge.py` covers loading, splitting, fingerprinting and the
relevance floor. Those run offline and free, on the keyword fallback.

## Degradation

Every failure path yields fewer or no passages rather than raising. No API key,
no network, no corpus on disk: retrieval returns nothing, `sources` comes back
empty, the UI says "General guidance" instead of naming a document, and the
recommendation is exactly what it was before this existed.

The keyword fallback (token overlap) covers the case where the corpus embedded
earlier but a query cannot. It is much weaker than embeddings — the two score
on different scales, which is why `MIN_SCORE_SEMANTIC` and `MIN_SCORE_KEYWORD`
are separate numbers.

## Cost and latency

Embedding the whole corpus is a fraction of a cent and happens once per edit.
Each request adds one query embedding, roughly 0.7s, on top of the chat call
that was already there. The first request after a cold start with no cache file
pays about 6s to build the index; every request after that reads the cache.
