# The Community Registry

Every file here is one **package definition** — a small YAML file describing where a
library's documentation lives and how to build it. A daily job reads these, builds a
searchable `.db` package from each, and publishes it so `context install` can fetch it.

Adding a library means adding one YAML file. No code.

## Where the file goes

The **directory name is the registry** the package is distributed by, and the
**filename is the package name within it**:

```
registry/npm/react.yaml          → npm/react
registry/pip/fastapi.yaml        → pip/fastapi
registry/npm/@trpc/server.yaml   → npm/@trpc/server     (scoped: use a subdirectory)
```

Maven coordinates use `_` in place of `:`, since `:` isn't filesystem-safe:

```
registry/maven/org.springframework.boot_spring-boot.yaml
```

**If the project isn't distributed by a package manager at all** — a language runtime,
a daemon, a CLI tool — give it a directory named after the project containing a single
self-named file. That's how the language runtimes are already done:

```
registry/python/python.yaml
registry/java/java.yaml
```

So Docker, Kubernetes, Podman and systemd would be `registry/docker/docker.yaml`,
`registry/kubernetes/kubernetes.yaml`, and so on.

The `name:` field inside the file must match the path, or loading fails.

## Which shape to use

A definition is either **unversioned** (one `source:`, always built from the current
tip and published as `latest`) or **versioned** (a `versions:` list). Not both.

### Unversioned — simplest, start here

```yaml
name: drizzle-orm
description: "TypeScript ORM"
repository: https://github.com/drizzle-team/drizzle-orm

source:
  type: git
  url: https://github.com/drizzle-team/drizzle-orm-docs
  docs_path: src/content/docs
```

Add `ref: <branch>` if the docs aren't on the default branch.

### Versioned by zip — for projects publishing docs archives

```yaml
versions:
  - versions: ["3.14"]
    source:
      type: zip
      url: "https://docs.python.org/3/archives/python-{version}-docs-html.zip"
      docs_path: "python-{version}-docs-html"
      exclude_paths:
        - "changelog.html"
```

`{version}` is substituted in both `url` and `docs_path`.

### Versioned by git tag — **only for npm, pip, maven and hex**

```yaml
versions:
  - min_version: "15.0.0"
    tag_pattern: "v{version}"
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs
```

> **This shape only works in `npm/`, `pip/`, `maven/` and `hex/`.** Those are the only
> registries with a version-discovery API, and this shape asks "which versions exist?"
> before matching them against `min_version`. In any other directory there is nothing
> to ask, so the build fails with `Unsupported registry: <dir>` — and because one bad
> definition fails the whole nightly publish, it takes every other package down with it.
>
> Outside those four directories, use **unversioned** or **versioned-by-zip**.

## Supported documentation formats

Markdown (`.md`, `.mdx`), HTML, AsciiDoc (`.adoc`) and reStructuredText (`.rst`).
Point `docs_path` at the directory holding them; everything else in the repo is ignored.

## Before opening a PR

Build your definition locally to confirm it produces real content:

```bash
pnpm install
pnpm --filter @neuledge/registry registry build <name>
```

A healthy build reports a few hundred sections. A handful usually means `docs_path` is
pointing at the wrong directory.

Then open the PR. New definitions are welcome — the registry is only as good as its
coverage.
