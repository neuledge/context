---
"@neuledge/context": patch
---

Only skip repo-meta filenames (`security`, `license`, `changelog`, `contributing`, and the rest) when the scan starts at the repository root. They were matched by basename at every depth, and also at the top of a `docs_path` folder, so an ordinary documentation page that happens to share one of those names was dropped without a word. `context add` on the forgejo docs lost `docs/admin/actions/security.md`, the only source in that repo for `container.valid_volumes`, and still reported success. `docker/docs` and `excalidraw/excalidraw` lose pages to the same rule.
