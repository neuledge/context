---
"@neuledge/context": patch
---

Keep every installed version of a package usable. Installing a second version of the same package (for example upgrading `occtswift` from `1.15.9` to `1.15.10`) used to hide one of them: only one version per name was tracked, and which one survived depended on the order the package files happened to be read in. `context list` showed a single entry, and `context query occtswift@1.15.10` reported "Package not found" even though the package was installed — removing the older version was the only workaround.

All installed versions are now listed and addressable. `name@version` resolves to that exact version, and a bare name resolves to the highest installed version, compared numerically so `1.15.10` beats `1.15.9` (prereleases rank below their release; labels such as `latest` rank below any numbered version). `context serve --libs pkg@1.15.9` now pins the session to exactly that version while a newer one stays installed; a bare `--libs pkg` exposes every installed version.

`context remove` no longer ignores the version in its argument: `context remove pkg@1.15.9` removes exactly that version, and a bare name is refused with the list of installed versions when there is more than one, instead of deleting an arbitrary one. `context add` now points out when the version just installed is not the one a bare name resolves to.
