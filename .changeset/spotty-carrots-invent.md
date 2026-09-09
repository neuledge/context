---
"@neuledge/registry": minor
---

Add `go` as a registry: version discovery through `proxy.golang.org`, with the uppercase-to-`!` module path escaping the proxy requires and the `v` prefix stripped so the shared `isPrerelease` and `compareSemver` keep working. `/@v/list` carries no publish dates, so `--since` filtering is unavailable for Go rather than merely slow.

Also make `listDefinitions` recurse into any subdirectory, not only `@scope` ones. Every Go module path contains slashes, so `registry/go/github.com/spf13/cobra.yaml` was never loaded — exit code 0, no warning. Scoped npm packages continue to resolve unchanged.
