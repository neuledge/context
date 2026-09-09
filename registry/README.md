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
> Outside those four directories, use **unversioned**, **versioned-by-zip**, or **versioned HTML index**.


### Versioned HTML index — for published reference manuals

Use `html-index` when a single HTML table of contents links to all reference
pages. It downloads those links and uses the existing HTML parser:

```yaml
versions:
  - versions: ["258"]
    source:
      type: html-index
      url: "https://www.freedesktop.org/software/systemd/man/{version}/"
      exclude_paths:
        - "index.html"
        - "systemd.directives.html"
```

This source requires explicit numeric release versions (for example `258` or
`3.14.0`) and an HTTPS URL containing a `{version}` directory segment. Moving
aliases such as `latest` are rejected. It works in any registry directory.
The index may be a directory URL or an `.html`/`.htm` file. Only HTML links
within that index's directory and origin are downloaded; fragments are removed,
query links are ignored, and linked pages are not crawled recursively. Redirects
must stay inside the same directory. Exclusions are relative to that directory.

Downloads use four workers by default (`concurrency: 1..10`) and allow up to
2,000 pages (`max_pages: 1..5000`). Exceeding that limit, a failed page, or an
empty index fails the build instead of publishing partial documentation.
Requests have a 30-second timeout, transient failures are retried twice, and
responses are limited to 10 MiB each and 128 MiB per build. Identical pages are
indexed once, which avoids duplicate man-page aliases.

Pinned downloads are reused from `.cache/context/html-index` across builds.
Delete that directory to refetch a corrected upstream release. The nightly
publisher skips releases already present in the registry. Check the publisher's crawling policy
before adding an index source.

For systemd, `systemd/systemd` contains the versioned reference manuals and
`systemd/systemd-guides` contains the Markdown architecture and integration
guides from Git. These are separate sources and packages; `docs_path` selects
a directory within one Git or ZIP source.


## Excluding parts of a source

`docs_path` narrows a source to one directory. When the directory you need also holds
material that belongs to a different package, `exclude_paths` prunes it:

```yaml
source:
  type: git
  url: https://github.com/godotengine/godot-docs
  ref: stable
  exclude_paths:
    - "tutorials/scripting/c_sharp/**"
```

Patterns are glob-style — `*` matches within a path segment, `**` across segments — and
are matched against the path **relative to `docs_path`** when one is set, or to the
repository root when it is not. Excluding everything is an error rather than an empty
package.

Reach for this when a wider `docs_path` would drag in a sibling language or framework
that then outranks the docs you actually want; prefer narrowing `docs_path` when the
content you want is already isolated in its own directory.

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
