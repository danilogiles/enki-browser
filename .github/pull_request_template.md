## Why

<!-- What problem this solves, for whom. Link the issue: "Fixes #123". -->

## What changed

<!-- The approach, and anything you tried and rejected. -->

## How I verified it

<!-- What you did in the browser and what happened; which of test/verify.mjs, update.mjs, setup.mjs you ran. Screenshots for anything visible. "Should work" is not a result. -->

## Checklist

- [ ] `node test/verify.mjs` passes on the build (and `update.mjs` if the launcher or updater changed)
- [ ] Every commit is signed off (`git commit -s`)
- [ ] Nothing new leaves the browser, or `PRIVACY.md` says what, when and why
- [ ] Downloads are pinned in `upstream.json`; third-party changes are files in `patches/`
