---
"@neuledge/context": patch
---

Fix `context install` to accept the `registry/name@version` shorthand (e.g., `context install npm/next@16.1.7`). Previously the `@version` suffix was treated as part of the package name, causing the install to fail with "No packages found". Scoped packages like `npm/@trpc/server@10.0.0` are also handled correctly.
