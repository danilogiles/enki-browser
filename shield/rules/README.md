# Enki Shield's static rules

`debounce.json` skips tracking redirects and Google's AMP copies (issue #19):

- Links that carry their destination in a parameter (`google.com/url?q=…`, `l.facebook.com/l.php?u=…`,
  `youtube.com/redirect?q=…`, `out.reddit.com/…?url=…`, `duckduckgo.com/l/?uddg=…`, Steam, Instagram,
  Slack) are redirected to Shield's own `debounce.html?u=…`, so the tracker is never contacted.
  Declarative rules cannot percent-decode the destination; `debounce.js` does, and opens it only if it is
  an `http(s)` address. The rules name the page as `chrome-extension://__SHIELD_ID__/…`; the build writes
  Shield's fixed id there (`build/common.mjs`), so a copy loaded straight from `shield/` (a test)
  redirects nowhere useful.
- Google's AMP viewer (`google.*/amp/s/…`) and the AMP cache (`*.cdn.ampproject.org/c/s/…`) carry the
  publisher's address in the path and go straight there. AMP pages a site hosts itself are left by
  `amp.js`, which follows `<link rel="canonical">`.

The patterns are this project's own, written from the services' public link formats.
