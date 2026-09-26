---
"@neuledge/registry": minor
---

Add `go` as a registry: version discovery through `proxy.golang.org`, with the uppercase-to-`!` module path escaping the proxy requires and the `v` prefix stripped so the shared `isPrerelease` and `compareSemver` keep working. `/@v/list` carries no publish dates, so under `--since` each version that survives dedup gets its date from `/@v/<version>.info`.

Also make `listDefinitions` recurse into any subdirectory, not only `@scope` ones. Every Go module path contains slashes, so `registry/go/github.com/spf13/cobra.yaml` was never loaded — exit code 0, no warning. Scoped npm packages continue to resolve unchanged.

Discovery now logs a warning when a package has published versions but none match its defined ranges, instead of silently finding nothing (e.g. Go `+incompatible` releases).
