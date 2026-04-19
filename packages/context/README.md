<p align="center">
  <h1 align="center">Context</h1>
  <p align="center">
    <strong>Up-to-date docs for AI agents — local, instant, plug and play.</strong>
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@neuledge/context"><img src="https://img.shields.io/npm/v/@neuledge/context.svg" alt="npm version"></a>
  <a href="https://github.com/neuledge/context/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0-blue.svg" alt="TypeScript"></a>
</p>

---

AI agents are trained on outdated docs. When libraries release new versions, your AI doesn't know — and confidently gives you wrong answers.

```js
// Your AI, mass-trained on AI SDK v5 docs, will suggest:
import { Experimental_Agent as Agent, stepCountIs } from 'ai';

// But v6 changed the API entirely:
import { ToolLoopAgent } from 'ai';
```

The fix isn't better prompting. It's giving your AI the right docs.

## How It Works

Context is an MCP server backed by a [community-driven package registry](registry/) with **100+ popular libraries** already built and ready to use. When your AI agent needs documentation, it searches the registry, downloads the right package, and queries it locally — all automatically.

**Install once. Configure once. Then just ask your AI.**

<p align="center">
  <img src="https://media.githubusercontent.com/media/neuledge/context/main/packages/context/assets/ai-sdk-demo.gif" alt="Context demo" width="800">
</p>

---

## :rocket: Quick Start

### 1. Install

```bash
npm install -g @neuledge/context
```

### 2. Connect to your AI agent

Context works with any MCP-compatible agent. Pick yours:

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add context -- context serve
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your config file:
- **Linux**: `~/.config/claude/claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "context": {
      "command": "context",
      "args": ["serve"]
    }
  }
}
```

Restart Claude Desktop to apply changes.

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-specific):

```json
{
  "mcpServers": {
    "context": {
      "command": "context",
      "args": ["serve"]
    }
  }
}
```

Or use **Settings > Developer > Edit Config** to add the server through the UI.

</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Either use the CLI

```bash
codex mcp add context -- context serve
```

Or add to `~/.codex/config.toml` (global) or `.codex/config.toml` (project-specific):

```toml
[mcp_servers.context]
command = "context"
args = ["serve"]
```

Restart OpenAI Codex to apply changes.

</details>

<details>
<summary><strong>VS Code (GitHub Copilot)</strong></summary>

> Requires VS Code 1.102+ with GitHub Copilot

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "context": {
      "type": "stdio",
      "command": "context",
      "args": ["serve"]
    }
  }
}
```

Click the **Start** button that appears in the file, then use Agent mode in Copilot Chat.

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:
- **Windows**: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

```json
{
  "mcpServers": {
    "context": {
      "command": "context",
      "args": ["serve"]
    }
  }
}
```

Or access via **Windsurf Settings > Cascade > MCP Servers**.

</details>

<details>
<summary><strong>Zed</strong></summary>

Add to your Zed `settings.json` (press `cmd+,` or `ctrl+,` twice):

```json
{
  "context_servers": {
    "context": {
      "command": {
        "path": "context",
        "args": ["serve"]
      }
    }
  }
}
```

Check the Agent Panel settings to verify the server shows a green indicator.

</details>

<details>
<summary><strong>Goose</strong></summary>

Run `goose configure` and select **Command-line Extension**, or add directly to `~/.config/goose/config.yaml`:

```yaml
extensions:
  context:
    type: stdio
    command: context
    args:
      - serve
    timeout: 300
```

</details>


<details>
<summary><strong>OpenCode</strong></summary>

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "context": {
      "command": ["context", "serve"],
      "enabled": true,
      "type": "local"
    }
  }
}
```

</details>

### 3. Ask your AI anything

That's it. Just ask:

> "How do I create middleware in Next.js?"

Your agent searches the [community registry](registry/), downloads the docs, and answers with accurate, version-specific information. Everything happens automatically — no manual `context install` needed for registry packages.

---

## The Community Registry

The registry is what makes Context plug and play. It's a growing collection of **100+ pre-built documentation packages** maintained by the community. Think of it like a package manager, but for AI-ready docs.

**Popular packages available today:**

| Category | Libraries |
|----------|-----------|
| **Frameworks** | Next.js, Nuxt, Astro, SvelteKit, Remix, Hono |
| **React ecosystem** | React, React Router, TanStack Query, Zustand, Redux Toolkit |
| **Databases & ORMs** | Prisma, Drizzle, Mongoose, TypeORM |
| **Styling** | Tailwind CSS, shadcn/ui, Styled Components |
| **Testing** | Vitest, Playwright, Jest, Testing Library |
| **APIs & Auth** | tRPC, GraphQL, NextAuth.js, Passport |
| **AI & LLMs** | LangChain, AI SDK, OpenAI, Anthropic SDK |

[Browse the full registry →](registry/)

**Anyone can contribute.** If a library you use isn't listed, [submit a PR](registry/) to add it — your contribution helps every Context user.

---

## Why Local?

Context runs entirely on your machine. Docs are downloaded once and stored as compact SQLite databases in `~/.context/packages/`. After that, everything is local.

- **Fast** — Local SQLite queries return in under 10ms
- **Offline** — Works on flights, in coffee shops, anywhere
- **Private** — Your queries never leave your machine
- **Free** — No subscriptions, no rate limits, no usage caps
- **Reliable** — No outages, no API changes, no service shutdowns

---

## Beyond the Registry

The registry covers popular open-source libraries, but Context also works with any documentation source. Use `context add` to build packages from private repos, internal libraries, websites with [llms.txt](https://llmstxt.org/), or anything not yet in the registry.

```bash
# Build from a git repository
context add https://github.com/your-company/design-system

# Build from a local directory
context add ./my-project

# Specific version tag
context add https://github.com/vercel/next.js/tree/v16.0.0

# Build from a website's llms.txt
context add https://svelte.dev
```

Once built, share packages with your team — they're portable `.db` files that install instantly:

```bash
# Export a package
context add ./my-project --name my-lib --pkg-version 2.0 --save ./packages/

# Teammate installs it (no build step needed)
context add ./packages/my-lib@2.0.db
```

---

## :whale: Docker

Run Context as a containerized HTTP server for multi-client or Kubernetes deployments:

```bash
# Run from the repository root (required for the monorepo lockfile)
docker build -t context:local -f packages/context/Dockerfile .
docker run --rm -p 8080:8080 context:local
```

The container starts Context with HTTP transport on port 8080, accessible at `http://localhost:8080/mcp`. The image uses a multi-stage build with `node:22-bookworm-slim` for native module compatibility.

---

## :books: CLI Reference

### `context browse <package>`

Search for packages available on the registry server.

```bash
# Browse by registry/name
context browse npm/next

# Output:
#   npm/next@15.1.3           3.4 MB  The React Framework for the Web
#   npm/next@15.0.4           3.2 MB  The React Framework for the Web
#   ...
#
#   Found 12 versions. Install with: context install npm/next

# Browse with just a name (defaults to npm)
context browse react
```

### `context install <registry/name> [version]`

Download and install a pre-built package from the registry server.

```bash
# Install latest version
context install npm/next

# Install a specific version
context install npm/next 15.0.4

# Install from other registries
context install pip/django
```

### `context add <source>`

Build and install a documentation package from source. Use this for libraries not in the registry, or for private/internal docs. The source type is auto-detected.

**From git repository:**

Works with GitHub, GitLab, Bitbucket, Codeberg, or any git URL:

```bash
# HTTPS URLs
context add https://github.com/vercel/next.js
context add https://gitlab.com/org/repo
context add https://bitbucket.org/org/repo

# Specific tag or branch
context add https://github.com/vercel/next.js/tree/v16.0.0

# SSH URLs
context add git@github.com:user/repo.git
context add ssh://git@github.com/user/repo.git

# Custom options
context add https://github.com/vercel/next.js --path packages/docs --name nextjs
```

**From local directory:**

Build a package from documentation in a local folder:

```bash
# Auto-detects docs folder (docs/, documentation/, doc/)
context add ./my-project

# Specify docs path explicitly
context add /path/to/repo --path docs

# Custom package name and version
context add ./my-lib --name my-library --pkg-version 1.0.0
```

| Option | Description |
|--------|-------------|
| `--pkg-version <version>` | Custom version label |
| `--path <path>` | Path to docs folder in repo/directory |
| `--name <name>` | Custom package name |
| `--save <path>` | Save a copy of the package to the specified path |

**Saving packages for sharing:**

```bash
# Save to a directory (auto-names as name@version.db)
context add https://github.com/vercel/next.js --save ./packages/

# Save to a specific file
context add ./my-docs --save ./my-package.db
```

**From website ([llms.txt](https://llmstxt.org/)):**

Many websites publish an `llms.txt` file with AI-ready documentation. Context auto-detects and fetches it. When the site only provides `llms.txt` (an index of links rather than the inlined `llms-full.txt`), Context follows each link and fetches the linked document:

```bash
# Auto-fetches llms-full.txt or llms.txt from the site
context add https://svelte.dev
context add https://mui.com/material-ui

# Direct URL to a specific llms.txt file
context add https://svelte.dev/docs/svelte/llms.txt

# Custom package name
context add https://react-aria.adobe.com --name react-aria
```

**From an arbitrary URL (blog posts, articles, raw Markdown):**

If no `llms.txt` is found, Context falls back to fetching the page directly. HTML pages are run through a readability extractor (defuddle) so subscribe CTAs, navigation, and comment widgets don't end up in the package:

```bash
# A blog post
context add https://overreacted.io/things-i-dont-know-as-of-2018/

# Raw Markdown from GitHub
context add https://raw.githubusercontent.com/neuledge/context/main/README.md --name context-readme
```

For subscriber-only content on platforms you have a paid account for, see [`context auth`](#context-auth) below.

**From URL:**

```bash
context add https://cdn.example.com/react@18.db
```

**From local file:**

```bash
context add ./nextjs@15.0.db
```

**Finding the right documentation repository:**

Many popular projects keep their documentation in a separate repository from their main codebase. If you see a warning about few sections found, the docs likely live elsewhere:

```bash
# Example: React's docs are in a separate repo
context add https://github.com/facebook/react
# ⚠️  Warning: Only 45 sections found...
# The warning includes a Google search link to help find the docs repo

# The actual React docs repository:
context add https://github.com/reactjs/react.dev
```

Common patterns for documentation repositories:
- `project-docs` (e.g., `prisma/docs`)
- `project.dev` or `project.io` (e.g., `reactjs/react.dev`)
- `project-website` (e.g., `expressjs/expressjs.com`)

When the CLI detects few documentation sections, it will show a Google search link to help you find the correct repository.

### `context list`

Show installed packages.

```bash
$ context list

Installed packages:

  nextjs@16.0              4.2 MB    847 sections
  react@18                 2.1 MB    423 sections

Total: 2 packages (6.3 MB)
```

### `context remove <name>`

Remove a package.

```bash
context remove nextjs
```

### `context auth`

Store per-platform cookies or headers so `context add <url>` can fetch subscriber-only content you have a legitimate account for (e.g., a paid Substack or Medium subscription). Credentials are stored in `~/.context/auth.json` with `0600` permissions, and matched by domain (with one level of parent-domain fallback for subdomains).

```bash
# Store cookies for a domain
context auth add substack.com --cookies "substack.sid=YOUR_SID"

# Add a custom header too
context auth add medium.com --cookies "sid=..." --header "x-frontend: web"

# List configured auth
context auth list

# Remove auth
context auth remove substack.com
```

### `context serve`

Start the MCP server (used by AI agents).

```bash
# Stdio transport (default, for single-client MCP integrations)
context serve

# HTTP transport (for multi-client access over the network)
context serve --http
context serve --http 3000
context serve --http 3000 --host 0.0.0.0
```

| Option | Description |
|--------|-------------|
| `--http [port]` | Start as HTTP server instead of stdio (default port: 8080) |
| `--host <host>` | Host to bind to (default: 127.0.0.1) |

The HTTP transport uses the [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) protocol, enabling multiple clients on the local network to connect to a single server instance. The endpoint is available at `http://<host>:<port>/mcp`.

### `context query <library> <topic>`

Query documentation directly from the command line. Useful for testing and debugging.

```bash
# Query a package (use name@version format from 'context list')
context query 'nextjs@16.0' 'middleware authentication'

# Returns the same JSON format as the MCP get_docs tool
```

---

## :gear: Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Your Machine                        │
│                                                         │
│  ┌──────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │    AI    │    │   Context MCP    │    │ ~/.context │ │
│  │  Agent   │───▶│     Server       │───▶│  /packages │ │
│  │          │    │                  │    └────────────┘ │
│  └──────────┘    └────────┬─────────┘         │         │
│                           │            ┌──────────┐     │
│                           │            │  SQLite  │     │
│                           │            │   FTS5   │     │
│                           │            └──────────┘     │
└───────────────────────────┼─────────────────────────────┘
                            │ (first use only)
                            ▼
                   ┌────────────────┐
                   │   Community    │
                   │   Registry     │
                   └────────────────┘
```

**First time you ask about a library:**
1. The MCP server searches the community registry
2. Downloads the pre-built documentation package (a SQLite `.db` file)
3. Stores it locally in `~/.context/packages/`

**Every time after:**
1. FTS5 full-text search finds relevant sections locally
2. Smart filtering keeps results within token budget
3. Your AI gets focused, accurate documentation in under 10ms

---

## :question: FAQ

### Can I use Context with non-JavaScript frameworks like Spring Boot, Django, or Rails?

**Yes!** Context is language-agnostic. It natively supports Markdown (`.md`, `.mdx`), AsciiDoc (`.adoc`), reStructuredText (`.rst`), and HTML — no conversion needed.

```bash
# Python - FastAPI (Markdown)
context add https://github.com/fastapi/fastapi --path docs/en/docs

# Python - Django (reStructuredText)
context add https://github.com/django/django --path docs

# Java - Spring Boot (AsciiDoc)
context add https://github.com/spring-projects/spring-boot --path spring-boot-project/spring-boot-docs/src/docs

# Rust - The Rust Book
context add https://github.com/rust-lang/book --path src
```

Point Context at the docs folder with `--path` and it handles the rest.

### Can I contribute package definitions for new ecosystems?

Yes! The `registry/` directory has YAML definitions organized by package manager:

- **`registry/npm/`** — JavaScript/TypeScript (Next.js, React, Tailwind, etc.)
- **`registry/pip/`** — Python (FastAPI, Flask, Django, Pydantic)
- **`registry/maven/`** — Java (Spring Boot, JUnit, Micrometer)

To add a package, create a YAML file. Two source types are supported:

**Git source** — clone a repo at a version tag:

```yaml
# registry/pip/my-library.yaml
name: my-library
description: "Short description of the library"
repository: https://github.com/org/my-library

versions:
  - min_version: "2.0.0"
    source:
      type: git
      url: https://github.com/org/my-library
      docs_path: docs
    tag_pattern: "v{version}"
```

**ZIP source** — download HTML docs from a URL (supports `{version}` placeholder):

```yaml
# registry/python/python.yaml
name: python
description: "Python programming language official documentation"

versions:
  - versions: ["3.14", "3.13", "3.12"]
    source:
      type: zip
      url: "https://docs.python.org/3/archives/python-{version}-docs-html.zip"
      docs_path: "python-{version}-docs-html"
      exclude_paths:
        - "whatsnew/**"
        - "changelog.html"
```

Version discovery is supported for npm, PyPI, and Maven Central. See existing definitions for examples.

---

## :wrench: Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Lint
pnpm lint
```

---

## :page_facing_up: License

[Apache-2.0](LICENSE)
