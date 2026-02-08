# I Got Tired of Context7's Rate Limits, So I Built a Local-First Alternative With Claude Code

I've been using Context7 as an MCP server for months. It's a neat idea: your AI agent queries a cloud service for up-to-date library docs instead of relying on stale training data. It mostly worked. Until it didn't.

In January 2026, Context7 slashed their free tier from ~6,000 to 1,000 requests per month and added a 60 requests/hour rate limit. I hit those limits within the first week. Suddenly, in the middle of a coding session, my AI assistant would just... stop being helpful. It'd fall back to hallucinating Next.js 14 patterns when I needed Next.js 16, or suggest deprecated Prisma APIs. The exact problem Context7 was supposed to solve.

So I built my own. It took about a week, most of it pair-programming with Claude Code. The result is [Context](https://github.com/neuledge/context) — a local-first documentation tool for AI agents. No cloud. No rate limits. Sub-10ms queries. And the docs are portable `.db` files you build once and share with your whole team.

Here's how it happened and what I learned.

---

## The "Aha" Moment: Why Not Just Store Docs Locally?

The core insight was embarrassingly simple. Cloud doc services like Context7 and Deepcon do three things:

1. Clone a library's docs repo
2. Index the markdown into searchable chunks
3. Serve results via API

Steps 1 and 2 only need to happen **once per library version**. But these services run them on their servers and charge you per query for step 3. Every. Single. Time.

Why not do steps 1 and 2 locally, store the result as a file, and skip the network entirely?

That's the whole idea. `context add https://github.com/vercel/next.js` clones the repo, parses the docs, indexes everything into a SQLite database, and stores it at `~/.context/packages/nextjs@16.0.db`. Done. That `.db` file now contains every piece of Next.js 16 documentation, pre-indexed and ready for instant queries. No internet needed. No rate limits. No monthly bill.

---

## Building It With Claude Code

I built the entire thing using Claude Code as my primary development partner. Not as a "generate boilerplate and fix it" assistant — as an actual collaborator on architecture decisions, implementation, and debugging.

### The Stack

The project is a TypeScript monorepo. Here's what's under the hood:

- **`better-sqlite3`** — Embedded database. No servers, no config, just a file. This is the critical choice that makes the whole thing work.
- **SQLite FTS5** — Full-text search with BM25 ranking and Porter stemming. The search quality is surprisingly good for what's essentially a few lines of SQL.
- **`@modelcontextprotocol/sdk`** — The MCP server SDK. This is what lets Claude, Cursor, VS Code Copilot, and others query the docs.
- **`remark-parse` + `unified`** — Markdown AST parsing. Needed for intelligent chunking rather than dumb text splitting.
- **`commander` + `@inquirer/prompts`** — CLI framework with interactive prompts for tag selection.

### How the Build Pipeline Works

When you run `context add <repo>`, here's what actually happens:

**1. Source detection.** The CLI figures out if you gave it a git URL, a local directory, or a pre-built `.db` file. Git URL parsing alone handles GitHub, GitLab, Bitbucket, Codeberg, SSH shorthand (`git@host:user/repo`), and monorepo URL patterns.

**2. Shallow clone.** `git clone --depth 1` — we only need the docs, not the full history. The CLI fetches available tags and lets you pick a version interactively, or you can pass `--tag v16.0.0` for automation.

**3. Docs folder detection.** Auto-scans for `docs/`, `documentation/`, or `doc/` directories. Respects `.gitignore`. Filters by language — defaults to English but supports `--lang all` for multilingual repos.

**4. Markdown parsing and chunking.** This is where it gets interesting. The parser:
   - Extracts YAML frontmatter for titles and descriptions
   - Chunks content by H2 headings (the natural unit of documentation)
   - Targets ~800 tokens per chunk with a hard limit of 1,200
   - Splits oversized sections at code block boundaries first, then paragraph boundaries
   - Filters out table-of-contents sections (detected by link ratio >50%)
   - Strips MDX-specific React tags (`<AppOnly>`, `<PagesOnly>`, etc.)
   - Deduplicates identical sections using content hashing

**5. SQLite packaging.** Everything goes into a single `.db` file:

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  doc_path TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  section_title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  has_code INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  doc_title, section_title, content,
  content='chunks', content_rowid='id',
  tokenize='porter unicode61'
);
```

The FTS5 virtual table with Porter stemming means "authentication middleware" matches "authenticating in middleware" without any fancy NLP. BM25 ranking weights section titles at 10x and doc titles at 5x over body content, which makes results feel relevant without needing embeddings.

---

## The Search Pipeline: Keeping It Simple

When Claude (or any MCP client) calls `get_docs({ library: "nextjs@16.0", topic: "middleware" })`, the search pipeline runs entirely in-process:

```
FTS5 query → BM25 ranking → Relevance filter → Token budget → Merge adjacent → Format
```

The relevance filter drops anything scoring below 50% of the top result. The token budget caps output at 2,000 tokens — enough to be useful without flooding the context window. Adjacent chunks from the same document get merged back together so the AI sees coherent sections instead of fragments.

Total latency: under 10ms. Compare that to 100-500ms for a cloud round-trip, plus the time your AI agent spends waiting before it can continue reasoning.

This matters more than it sounds. AI coding agents make dozens of tool calls per session. If each doc lookup adds 300ms of network latency, that's seconds of dead time per interaction. Locally, it's effectively free.

---

## The Real Win: Build Once, Share Everywhere

Here's the feature I'm most excited about, and the one I think cloud services fundamentally can't match.

When you build a documentation package, the result is a single `.db` file. That file is completely self-contained — metadata, content, search index, everything. You can:

```bash
# Build and export
context add https://github.com/your-org/design-system \
  --name design-system --pkg-version 3.1 --save ./packages/

# The result: a portable file
ls -la packages/design-system@3.1.db
# 2.4 MB - your entire design system docs, indexed and ready
```

Now share that file however you want. Upload it to an S3 bucket. Commit it to a repo. Put it on a shared drive. Your teammates install it with:

```bash
context add https://your-cdn.com/design-system@3.1.db
```

No build step on their end. No cloning repos. No waiting for indexing. The pre-built package installs instantly because it's already indexed.

**This is the key architectural advantage of local-first.** With cloud services, every user pays the query cost. With local packages, you pay the build cost once and distribute the result. It's the same principle as compiled binaries vs. interpreted scripts — do the expensive work ahead of time.

For internal libraries, this is huge. You can document your internal APIs, build a package in CI, publish it alongside your npm package, and every developer on the team has instant, private, offline access to up-to-date docs. No cloud service sees your proprietary API queries.

---

## What I Learned Building With Claude Code

A few honest observations from using Claude Code as my primary development tool:

**It's genuinely good at plumbing code.** Git URL parsing, CLI argument handling, SQLite schema design — the kind of code that's tedious but needs to be correct. Claude Code knocked these out quickly and accurately. The git module handles edge cases I wouldn't have thought of: monorepo tag formats like `@ai-sdk/gateway@1.2.3`, SSH shorthand URLs, stripping `-docs` suffixes from repo names.

**It struggles with "taste" decisions.** Things like: what should the chunk size be? How aggressively should we filter low-relevance results? What BM25 weights feel right? These needed human judgment and iteration. I'd try values, test against real docs, adjust, repeat. Claude Code helped implement each variation quickly, but the decision of which one felt right was mine.

**The iteration speed is the real superpower.** The whole project — CLI, build pipeline, search engine, MCP server, tests — came together in about a week. Not because the code is trivial (the markdown parsing alone handles a dozen edge cases), but because the feedback loop was tight. Describe what you want, review what you get, adjust, move on.

**Test-driven prompting works well.** I'd often describe the behavior I wanted in terms of test cases: "this markdown input should produce these chunks." Claude Code would write both the implementation and the tests. When they didn't match, we'd figure out why together.

---

## The Numbers

Here's where Context stands versus the cloud alternatives:

| | Context7 | Deepcon | Context |
|---|:---:|:---:|:---:|
| **Price** | $10/month | $8/month | Free |
| **Free tier** | 1,000 req/month | 100 req/month | Unlimited |
| **Rate limits** | 60 req/hour | Throttled | None |
| **Latency** | 100-500ms | 100-300ms | <10ms |
| **Works offline** | No | No | Yes |
| **Privacy** | Cloud | Cloud | 100% local |
| **Private repos** | $15/1M tokens | No | Free |

---

## Setting It Up

If you want to try it:

```bash
# Install
npm install -g @neuledge/context

# Add some docs
context add https://github.com/vercel/next.js
context add https://github.com/prisma/prisma

# Connect to your AI agent (Claude Code example)
claude mcp add context -- context serve
```

It works with Claude Desktop, Cursor, VS Code Copilot, Windsurf, Zed, and Goose. Any MCP-compatible agent, really. The MCP server exposes a single `get_docs` tool with a dynamic enum of installed libraries — the AI sees exactly what's available and queries it when relevant.

---

## What's Next

The search is currently keyword-based (FTS5 + BM25). It works well for direct queries like "middleware authentication" or "prisma relations," but it doesn't understand semantic similarity. "How do I protect routes?" won't match a section titled "Authentication Guards" unless the words overlap.

I'm planning to add local embeddings for semantic search — still fully offline, probably using ONNX Runtime with a small model. The SQLite architecture makes this straightforward: add an embeddings table, compute vectors at build time, query with cosine similarity at search time.

I'm also thinking about a GraphRAG-style relations table for traversing connected documentation. When you ask about middleware, you probably also want to know about authentication, routing, and error handling. A relations graph could surface those automatically.

And a package registry — a GitHub-based index where the community can discover and share pre-built documentation packages. Instead of everyone independently building the same Next.js docs, build it once and publish it.

---

## The Takeaway

The core lesson from this project: **not everything needs to be a cloud service.**

Documentation for AI agents is a perfect case for local-first. The data changes infrequently (per library version), the queries need to be fast (agents make lots of them), privacy matters (you're asking about your codebase), and the "build once, use forever" model is a natural fit.

If you're frustrated with rate limits, latency, or paying monthly for something that should be a static file — [give it a try](https://github.com/neuledge/context). It's open source (Apache-2.0), it's free, and it works offline.

---

*Context is open source at [github.com/neuledge/context](https://github.com/neuledge/context). Published on npm as `@neuledge/context`.*
