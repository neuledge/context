---
"@neuledge/context": patch
---

Update `defuddle` to 0.19.3, fixing GHSA-jg4p-g6xj-4qmf (XSS via unescaped attribute interpolation in site extractors). This affects HTML documentation sources; earlier versions pulled in the vulnerable 0.17.0.
