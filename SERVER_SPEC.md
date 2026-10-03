# Context Download Server — API Specification

A Context download server hosts pre-built documentation packages (`.db` files) and serves them to AI agents via the MCP protocol. This document specifies the HTTP API that a compatible server must implement.

The default server is `https://api.context.neuledge.com`. Anyone can run their own.

## Base URL

All endpoints are relative to a configurable base URL. Clients store server configuration in `~/.context/config.json`:

```json
{
  "servers": [
    { "name": "neuledge", "url": "https://api.context.neuledge.com", "default": true },
    { "name": "internal", "url": "https://context.acme.corp" }
  ]
}
```

## Endpoints

### Search packages

```
GET /search?registry=<registry>&name=<name>[&version=<version>]
```

Find available documentation packages.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `registry` | yes | Package manager: `npm`, `pip`, `cargo`, etc. |
| `name` | yes | Package name (e.g., `nextjs`, `django`) |
| `version` | no | Specific version. Omit to return all available versions. |

**Response `200 OK`:**

```json
[
  {
    "name": "nextjs",
    "registry": "npm",
    "version": "15.1.0",
    "description": "The React Framework for the Web",
    "size": 3400000
  }
]
```

Returns an empty array `[]` when no packages match. Results are sorted by version descending (latest first).

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Package name |
| `registry` | string | Package manager |
| `version` | string | Semver version |
| `description` | string? | Short description |
| `size` | number? | `.db` file size in bytes |

### Get package metadata

```
GET /packages/<registry>/<name>/<version>
```

Check if a package version exists and return its metadata. The publish pipeline compares `build_fingerprint` to skip packages whose source, resolved definition, and ingestion implementation are unchanged.

**Response `200 OK`:**

```json
{
  "registry": "npm",
  "name": "nextjs",
  "version": "15.1.0",
  "source_commit": "abc1234",
  "build_fingerprint": "<SHA-256 of build inputs>",
  "ingestion_revision": "<automatically generated SHA-256>"
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `registry` | string | Package manager |
| `name` | string | Package name |
| `version` | string | Semver version or `"latest"` |
| `source_commit` | string? | Git commit SHA for versioned or unversioned Git packages |
| `build_fingerprint` | string? | Opaque SHA-256 copied from the uploaded database's `meta` table |
| `ingestion_revision` | string? | Automatic ingestion revision copied from the uploaded database's `meta` table |

Servers supporting automatic freshness checks must extract and persist these optional metadata values on every upload, including replacements, and return them here. The client treats fingerprints as opaque; servers should not recompute them. Older packages and servers can omit these fields: versioned packages retain existence-based skipping, unversioned Git packages retain `source_commit` comparison, and unversioned ZIP packages continue rebuilding. The CLI identifies legacy skips and offers `--force` for migration. Returning the fingerprint after a successful rebuild enables subsequent automatic checks; a server that continues omitting it retains the legacy behavior.

**Response `404 Not Found`:**

```json
{ "error": "Package not found" }
```

### Download package

```
GET /packages/<registry>/<name>/<version>/download
```

Download the `.db` file.

**Response `200 OK`:**
- `Content-Type: application/octet-stream`
- `Content-Length: <size>`
- Body: raw SQLite `.db` file

**Response `404 Not Found`:**

```json
{ "error": "Package not found" }
```

### Publish package (authenticated)

```
POST /packages/<registry>/<name>/<version>
Authorization: Bearer <key>
Content-Type: application/octet-stream
Body: raw .db file
```

Upload a new documentation package. Requires a valid API key.

**Response `200 OK`** — Package published successfully.

**Response `401 Unauthorized`:**

```json
{ "error": "Invalid or missing authorization" }
```

**Response `409 Conflict`** — Package version already exists (optional; servers may also allow overwrites).

The publisher uploads stale or explicitly forced builds to the same registry/name/version. `--force` bypasses client freshness checks only; it does not grant replacement permission or change the API request. If this endpoint rejects replacement with HTTP 409, the publisher reports the conflict and preserves the rebuilt local `.db`. Updating an immutable release requires a server-supported replacement or artifact revision policy; no alternative version is invented by the client.

## Package format (`.db` file)

Packages are SQLite databases with the following schema:

```sql
-- Package metadata (key-value pairs)
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Documentation chunks (one per section)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  doc_path TEXT NOT NULL,      -- e.g. "docs/routing/middleware.md"
  doc_title TEXT NOT NULL,     -- e.g. "Middleware"
  section_title TEXT NOT NULL, -- e.g. "Convention"
  content TEXT NOT NULL,       -- markdown text
  tokens INTEGER NOT NULL,     -- approximate token count
  has_code INTEGER DEFAULT 0   -- 1 if contains code blocks
);

-- Full-text search index
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  doc_title, section_title, content,
  content='chunks', content_rowid='id',
  tokenize='porter unicode61'
);
```

**Required meta keys:**

| Key | Description |
|-----|-------------|
| `name` | Package name (e.g., `nextjs`) |
| `version` | Package version (e.g., `15.1.0`) |

**Optional meta keys:**

| Key | Description |
|-----|-------------|
| `description` | Short package description |
| `source_url` | URL of the source repository |
| `source_commit` | Actual Git commit SHA used to build the package |
| `build_fingerprint` | Deterministic SHA-256 of resolved package build inputs |
| `ingestion_revision` | SHA-256 generated from ingestion code and locked dependencies at build time |

## Error format

All error responses use a consistent JSON format:

```json
{ "error": "Human-readable error message" }
```

## Rate limiting

Servers may implement rate limiting. When rate-limited, respond with:

- `429 Too Many Requests`
- `Retry-After: <seconds>` header

## Implementation notes

- Path parameters (`registry`, `name`, `version`) should be URL-decoded. They contain alphanumeric characters, hyphens, dots, `@` signs, and `/` (for scoped packages like `@trpc/server`).
- Clients URL-encode path parameters with `encodeURIComponent()`. Servers must decode accordingly (e.g., `%40trpc%2Fserver` → `@trpc/server`).
- The server is responsible for storage. Files can be stored on disk, S3, or any blob store.
- The server should serve `.db` files with `Content-Length` so clients can show download progress.
- The publish endpoint requires authentication. The mechanism (API key, OAuth, etc.) is server-specific. The default Neuledge server uses Bearer token authentication.
