---
"@neuledge/context": patch
---

Fix `context add` failing on branch refs (e.g. `/tree/heartbeat`) with a
cryptic `Command failed: git checkout ... 2>/dev/null` error. The URL ref
is now passed directly to `git clone --branch`, avoiding the broken
post-clone checkout path on shallow clones. When `checkoutRef` still runs
(e.g. `--tag` or interactive selection), it now falls back to
`FETCH_HEAD` for branches and surfaces git's real stderr in thrown errors
instead of suppressing it.
