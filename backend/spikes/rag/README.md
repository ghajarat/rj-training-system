# Phase 3 — RAG spike

Throwaway prototype that proves the chatbot pipeline end to end before the real
chatbot (Phase 5) is built on it. Not wired into Express, no auth, no UI.

```
SOP file ─► chunk ─► embed (OpenAI, 1536-d) ─► documents + embeddings tables
question ─► embed ─► pgvector cosine search ─► top-k chunks ─► Claude ─► answer + [n] citations
```

| File | Does |
|---|---|
| `chunker.js` | Reads .pdf/.txt/.md, splits by heading, packs paragraphs into ~1,500-char chunks with overlap |
| `providers.js` | `embed()` → OpenAI embeddings, `generate()` → Claude Messages API (plain `fetch`, no SDKs) |
| `rag.js` | Retrieval SQL, similarity floor, grounded prompt, citation extraction |
| `ingest.js` / `ask.js` / `eval.js` | The three commands below |
| `samples/sample-sop-cabin-preflight.md` | **Fictional** SOP for testing — not a real RJ procedure |
| `eval-questions.json` | 10 in-scope + 4 out-of-scope questions with expected answers |

## Run it

From `backend/`, with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` filled in `.env`:

```
npm install
npm run rag:ingest
npm run rag:ask -- "What do I do if a smoke hood indicator is pink?"
npm run rag:eval
```

- Ingest your own SOP: `npm run rag:ingest -- "C:\path\to\sop.pdf"`
- See what was retrieved and the scores: add `--debug` to `rag:ask`
- No API keys / no credit: set `RAG_FAKE=1` in `.env`. Everything runs offline
  with fake embeddings and a quote-the-top-chunk "answer". It tests the
  database half only; answer quality in this mode means nothing.

## What the eval measures

| Metric | Meaning |
|---|---|
| Retrieval hit rate | Right section was in the top 4 chunks |
| Answer accuracy | Answer contains the expected facts **and** cites a source |
| Refusal rate | Out-of-scope questions get the "couldn't find this" reply |
| avg / p95 ms | End-to-end time per question (NFR target: < 5 s) |
| In vs out-of-scope top score | Use these to set `RAG_MIN_SIMILARITY` |

Results are saved to `last-eval.json` (git-ignored). Copy the summary into
the testing chapter.

## Findings so far (offline run, 17 Oct 2026)

- Schema works as designed: `VECTOR(1536)` + HNSW cosine index, insert and
  search through `pg` with a `'[…]'::vector` parameter. Re-ingesting a file
  replaces its chunks via `ON DELETE CASCADE`.
- Retrieval hit rate 100% on the sample SOP even with the crude offline
  embedder; real embeddings should only do better.
- PDFs lose Markdown headings, so the chunker also treats short numbered lines
  ("5.1 Portable oxygen bottles") as headings. Without that, every PDF chunk
  was cited as "Introduction".
- Still to record with real keys: accuracy, refusal rate, latency, and the
  similarity gap between in- and out-of-scope questions.

## Carry into Phase 5

- Add `chunk_index`, `section` and `embedding_model` columns to `embeddings`
  (the spike stores the model as a `#embed=` suffix on `documents.file_url`
  and parses the section out of `chunk_text`). Schema change → update the ERD.
- Scanned PDFs return no text; detect that at upload and tell the admin.
- The refusal check is a string match on a fixed sentence. Return a
  structured `found: false` flag instead.
- `text-embedding-3-small` also gives 1536 dims and is a drop-in swap, but any
  model change means re-embedding every document.
