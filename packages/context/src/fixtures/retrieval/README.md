# Retrieval fixtures

These small, hand-written documentation samples exercise the real package builder
(parsing, chunking, deduplication, and FTS indexing) without network access.
They are regression examples, not copies of upstream documentation.

`search.retrieval.test.ts` defines the query expectations. Each expected source
must appear among the first **three distinct documents** returned. Language
queries additionally require the intended document first: both signal documents
mention GDScript and C#, providing competing matches for the same API concept.
Assertions cover document and section attribution (Markdown title metadata and
HTML filename fallback), complete fenced examples,
and the search budget of 2,000 estimated content tokens (one token per four
characters, rounded up per snippet).

A separate budget test builds numbered copies of the GDScript example. Unique
content keeps deduplication from collapsing them, so matching content exceeds
the budget and retrieval must select a subset while preserving examples.
