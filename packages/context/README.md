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

## How It Works

Context is an MCP server backed by a [community-driven package registry](registry/) with **100+ popular libraries** already built and ready to use. When your AI agent needs documentation, it searches the registry, downloads the right package, and queries it locally — all automatically.

**Install once. Configure once. Then just ask your AI.**

```
You: "How do I create middleware in Next.js 16?"

AI:  [finds Next.js on the registry → downloads docs → queries locally]
     "In Next.js 16, create a middleware.ts file in your project root..."
     (accurate, version-specific answer — no hallucination)
```

No copy-pasting docs. No stale training data. No manual setup per library.

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

Add to your Zed settings (`cmd+,` or `ctrl+,`):

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

The registry covers popular open-source libraries, but Context also works with any documentation source. Use `context add` to build packages from private repos, internal libraries, or anything not yet in the registry.

```bash
# Build from a git repository
context add https://github.com/your-company/design-system

# Build from a local directory
context add ./my-project

# Specific version tag
context add https://github.com/vercel/next.js/tree/v16.0.0
```

Once built, share packages with your team — they're portable `.db` files that install instantly:

```bash
# Export a package
context add ./my-project --name my-lib --pkg-version 2.0 --save ./packages/

# Teammate installs it (no build step needed)
context add ./packages/my-lib@2.0.db
```

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

### `context serve`

Start the MCP server (used by AI agents).

```bash
context serve
```

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
│  │    AI    │    │   Context MCP   │    │ ~/.context │ │
│  │  Agent   │───▶│     Server      │───▶│  /packages │ │
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
                   │   Registry    │
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
