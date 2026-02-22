# Context Download Server — API Specification

A Context download server hosts pre-built documentation packages (`.db` files) and serves them to AI agents via the MCP protocol. This document specifies the HTTP API that a compatible server must implement.

The default server is `https://context.neuledge.com`. Anyone can run their own.

## Base URL

All endpoints are relative to a configurable base URL. Clients store server configuration in `~/.context/config.json`:

```json
{
  "servers": [
    { "name": "neuledge", "url": "https://context.neuledge.com", "default": true },
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

- Path parameters (`registry`, `name`, `version`) should be URL-decoded. They contain only alphanumeric characters, hyphens, dots, and `@` signs.
- The server is responsible for storage. Files can be stored on disk, S3, or any blob store.
- The server should serve `.db` files with `Content-Length` so clients can show download progress.
