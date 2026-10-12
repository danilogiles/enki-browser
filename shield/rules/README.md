# Enki Shield's static rules

`query-filter.json` removes tracking parameters (`utm_*`, `fbclid`, `gclid`, …) from page and frame
addresses before they load. One rule per parameter: each matches `^name=` (`^` is a separator, so
`?name=` or `&name=`) and removes the whole list in one redirect.

Why not one rule with a regular expression: a `regexFilter` alternating all the names compiles to
more than Chromium's 2 KB limit, case-sensitive or not, and in a static ruleset Chromium skips such
a rule **silently** (the ruleset still reports as enabled). That shipped once in a branch and
stripped nothing; `test/verify.mjs` checks the result in the browser. Adding a name: add it to every
rule's `removeParams` and add its own rule.
