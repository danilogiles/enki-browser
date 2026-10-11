// The address bar's search engine page (chrome-extension://<Shield>/search.html?q=%s).
// Reads only `q`, decides locally, and replaces itself; no request is made before the redirect,
// and DuckDuckGo gets only q. Incognito always goes to DuckDuckGo (Enki is off there).
// "@ddg …" / "@enki …" choose for one search. Anything that fails or is slow → DuckDuckGo.
(() => {
  const ENKI_ID = "caelfocbikejgdamghjlkpmbbaobehlp";
  const raw = new URLSearchParams(location.search).get("q") ?? "";
  const ddg = (q) => location.replace("https://duckduckgo.com/?q=" + encodeURIComponent(q));
  const enki = (q) => location.replace(`chrome-extension://${ENKI_ID}/search.html?q=` + encodeURIComponent(q));
  if (chrome.extension.inIncognitoContext) return ddg(raw.replace(/^@(ddg|enki)\s+/i, ""));
  const m = /^@(ddg|enki)\s+/i.exec(raw);
  const q = m ? raw.slice(m[0].length) : raw;
  let done = false;
  const go = (toEnki) => { if (done) return; done = true; (toEnki ? enki : ddg)(q); };
  setTimeout(() => go(false), 300);
  (async () => {
    const s = await chrome.storage.local.get("searchSetupDone");
    // Setup check, whatever the current choice (Enki reads it via shield:incognitoAllowed and
    // flips its own choice). Cloak's rule: a boolean and the day it was first set, never the words or a
    // count, and never from Incognito (which returned above).
    if (s.searchSetupDone !== true) await chrome.storage.local.set({ searchSetupDone: true, searchSetupDoneAt: new Date().toISOString().slice(0, 10) });
    if (m && m[1].toLowerCase() === "ddg") return go(false);
    // Enki in normal windows only while Incognito searches can still reach DuckDuckGo.
    const incognitoAllowed = (await chrome.extension.isAllowedIncognitoAccess()) === true;
    if (m) return go(incognitoAllowed);
    // Enki owns the choice and may turn Enki AI on now that both steps are done; it gets this
    // boolean only, never the search words. Its answer routes this same search.
    const engine = await chrome.runtime.sendMessage(ENKI_ID, { type: "enki:getSearchEngine", incognitoAllowed });
    go(engine === "enki" && incognitoAllowed);
  })().catch(() => go(false));
})();
