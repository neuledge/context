# Context Server API Specification

This document describes the HTTP API that a Context download server must implement to be compatible with `@neuledge/context`'s `search_packages` and `download_package` MCP tools.

The default server is `https://context.neuledge.com`. The base URL is configurable via `~/.context/config.json`.

---

## Endpoints

All endpoints are relative to the base URL.

### Search Packages

```
GET /search?registry=<registry>&name=<name>[&version=<version>]
```

Search for available documentation packages.

**Query parameters:**

| Parameter  | Required | Description                                           |
|------------|----------|-------------------------------------------------------|
| `registry` | yes      | Package manager registry (e.g., `npm`, `pip`)         |
| `name`     | yes      | Package name (e.g., `nextjs`, `react`)                |
| `version`  | no       | Specific version. Omit to return all available versions |

**Response:** `200 OK` with JSON array of package objects:

```json
[
  {
    "registry": "npm",
    "name": "nextjs",
    "version": "15.0.4",
    "description": "The React Framework for the Web",
    "sizeBytes": 4194304
  }
]
```

Returns an empty array `[]` when no packages match.

---

### Check Package Existence

```
HEAD /packages/<registry>/<name>/<version>
```

Check if a specific package version exists.

**Response:**
- `200 OK` — Package exists
- `404 Not Found` — Package does not exist

---

### Get Package Metadata

```
GET /packages/<registry>/<name>/<version>
```

Get metadata for a specific package version.

**Response:** `200 OK` with JSON:

```json
{
  "registry": "npm",
  "name": "nextjs",
  "version": "15.0.4",
  "description": "The React Framework for the Web",
  "sizeBytes": 4194304,
  "sectionCount": 1200
}
```

Returns `404 Not Found` if the package does not exist.

---

### Download Package

```
GET /packages/<registry>/<name>/<version>/download
```

Download the `.db` package file.

**Response:** `200 OK` with binary SQLite database file (Content-Type: `application/octet-stream`).

Returns `404 Not Found` if the package does not exist.

---

### Publish Package

```
POST /packages/<registry>/<name>/<version>
Authorization: Bearer <key>
Content-Type: application/octet-stream
```

Upload a new `.db` package file. This endpoint is used by the registry build pipeline.

**Request body:** Raw SQLite database file.

**Response:**
- `200 OK` or `201 Created` — Published successfully
- `401 Unauthorized` — Missing or invalid auth key
- `400 Bad Request` — Invalid package file

---

## Configuration

Users can configure additional servers in `~/.context/config.json`:

```json
{
  "servers": [
    {
      "name": "neuledge",
      "url": "https://context.neuledge.com",
      "default": true
    },
    {
      "name": "my-server",
      "url": "https://my-context-server.example.com"
    }
  ]
}
```

The `search_packages` and `download_package` MCP tools accept an optional `server` parameter to select a non-default server by name.
