---
"@neuledge/context": patch
---

Only skip repo-meta filenames (`security`, `license`, `changelog`, `contributing`, …) at the scan root, not at every depth. A documentation page that happens to share one of those names was being dropped silently: `context add` on the forgejo docs lost `docs/admin/actions/security.md`, the only source in the repo for `container.valid_volumes`, and reported success. `docker/docs` and `excalidraw/excalidraw` lose pages to the same rule.
