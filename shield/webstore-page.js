// "Install in Enki" on a Chrome Web Store extension page (the worker's half is webstore.js).
// A card of Shield's own, in a closed shadow root so the store page can neither read nor restyle
// it; only real (isTrusted) clicks and key presses count, so the page cannot press it either.
// It sends no address, and the id only as a cross-check: the worker reads the id from this tab's
// address as Chromium reports it, refuses if it is not the one the card sends, and builds
// Google's address itself. The extension's name, read from the page, is
// only shown back to the user. Looks and words: Ink's mocks 01 and 02 (docs/WEBSTORE.md).
(() => {
  if (window.top !== window || globalThis.__enkiShieldStore) return;
  globalThis.__enkiShieldStore = true;
  const ID = /^[a-p]{32}$/;
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;
  const idHere = () => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[0] === "detail" && ID.test(parts.at(-1) ?? "") && parts.length <= 3 ? parts.at(-1) : null;
  };
  const nameHere = () => (document.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  const CSS = `
:host{all:initial}
.w{all:initial;box-sizing:border-box;display:block;position:fixed;top:76px;right:24px;z-index:2147483647;width:330px;background:#191a1a;border:1px solid #3a3c3c;border-radius:12px;padding:12px;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Inter,sans-serif;color:#e8e8e6;box-shadow:0 6px 18px rgba(0,0,0,.18)}
.w *{box-sizing:border-box;font:inherit;color:inherit}
.by{display:flex;align-items:center;gap:6px;font-size:11px;color:#9a9c99;margin-bottom:8px}
.by svg{color:#38bdf8}
.btn{min-height:44px;padding:0 16px;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;width:100%}
.btn.primary{background:#38bdf8;color:#06202d;border:1px solid #38bdf8}
.btn.ghost{background:transparent;color:#e8e8e6;border:1px solid #5a5c5b}
.btn[aria-disabled=true]{opacity:.7;cursor:progress}
.btn.primary.held{opacity:1;background:#1f3a47;color:#6f8f9e;border-color:#2b4a58;cursor:not-allowed}
.btn.primary.held svg{opacity:.6}
.btn:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
.hint{display:flex;gap:6px;align-items:flex-start;margin:8px 2px 0;font-size:11.5px;color:#b7b8b5}
.note{margin:6px 2px 0;font-size:11.5px;color:#9a9c99}
.err{margin:8px 2px 0;font-size:12px;color:#fbbf24}
.card{margin-top:10px;border:1.5px solid #f59e0b;background:linear-gradient(rgba(245,158,11,.08),rgba(245,158,11,.08)),#222424;border-radius:12px;padding:14px}
.head{display:flex;gap:10px;align-items:flex-start}
.badge{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:rgba(245,158,11,.14);color:#fbbf24;flex:none}
.kicker{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#fbbf24;font-weight:600}
h2{margin:2px 0 0;font-size:15.5px;line-height:1.3;font-weight:600}
ul{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}
li{color:#b7b8b5;font-size:12.5px}
li.hl{color:#e8e8e6}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
[hidden]{display:none!important}`;
  const SHIELD = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>';
  const WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';

  let host = null;
  let failNow = null; // shows "the download didn't start" on the card on screen
  function remove() { host?.remove(); host = null; failNow = null; }

  function render(id) {
    remove();
    const name = nameHere() || id;
    host = document.createElement("enki-shield-store");
    const root = host.attachShadow({ mode: "closed" });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const style = el("style"); style.textContent = CSS;
    const w = el("div", "w");
    const by = el("div", "by"); by.innerHTML = SHIELD; by.append("Enki Shield");
    const install = el("button", "btn primary", t("cws_install_button"));
    install.type = "button";
    install.setAttribute("aria-label", t("cws_install_button_aria", name));
    const hint = el("div", "hint", t("cws_install_hint"));
    const note = el("div", "note", t("cws_store_button_note"));
    const err = el("div", "err"); err.hidden = true; err.setAttribute("role", "alert");

    // The broad-access note (mock 02), the same for every extension: Shield does not open the
    // .crx, so it does not know this one's permissions; Chromium's prompt lists them next.
    const card = el("div", "card"); card.hidden = true;
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-labelledby", "t"); card.setAttribute("aria-describedby", "d");
    const head = el("div", "head");
    const badge = el("div", "badge"); badge.innerHTML = WARN;
    const titles = el("div");
    const kicker = el("div", "kicker", t("access_badge"));
    const h2 = el("h2", null, t("access_title_generic", name)); h2.id = "t";
    titles.append(kicker, h2); head.append(badge, titles);
    const ul = el("ul"); ul.id = "d";
    ul.append(el("li", "hl", t("access_body_read")), el("li", null, t("access_body_data")), el("li", null, t("access_body_next")));
    const btns = el("div", "btns");
    const cancel = el("button", "btn ghost", t("access_cancel")); cancel.type = "button";
    const go = el("button", "btn primary", t("access_continue")); go.type = "button";
    btns.append(cancel, go);
    card.append(head, ul, btns);
    w.append(by, install, hint, note, err, card);
    root.append(style, w);
    (document.body ?? document.documentElement).append(host);

    let busy = false;
    let held = false; // the access note is open: Install looks and acts disabled (mock 01b)
    const setBusy = (on) => {
      busy = on;
      install.textContent = on ? t("cws_install_busy") : t("cws_install_button");
      install.setAttribute("aria-disabled", String(on || held));
    };
    const hold = (on) => {
      held = on;
      install.classList.toggle("held", on);
      install.setAttribute("aria-disabled", String(on || busy));
      install.tabIndex = on ? -1 : 0;
    };
    const fail = (key) => { setBusy(false); err.textContent = t(key); err.hidden = false; };
    const close = () => { card.hidden = true; hold(false); install.focus(); };
    failNow = fail;

    install.addEventListener("click", (e) => {
      if (!e.isTrusted || busy || held) return;
      err.hidden = true;
      if (!idHere()) return fail("cws_error_id");
      const now = nameHere() || id; // the store may fill in its heading after the card appeared
      h2.textContent = t("access_title_generic", now);
      install.setAttribute("aria-label", t("cws_install_button_aria", now));
      card.hidden = false;
      hold(true);
      cancel.focus();
    });
    cancel.addEventListener("click", (e) => { if (e.isTrusted) close(); });
    card.addEventListener("keydown", (e) => { if (e.isTrusted && e.key === "Escape") { e.preventDefault(); close(); } });
    go.addEventListener("click", async (e) => {
      if (!e.isTrusted || busy) return;
      card.hidden = true;
      hold(false);
      setBusy(true);
      install.focus();
      let r;
      // The id in the address now, which must still be the one this card was drawn for; the
      // worker checks it against the address Chromium reports for this tab.
      const want = idHere();
      if (!want || want !== id) return fail("cws_error_id");
      try { r = await chrome.runtime.sendMessage({ what: "enki-shield:cws-install", id: want, name: nameHere() }); } catch { r = null; }
      if (!r?.ok) return fail(r?.error === "id" || r?.error === "mismatch" ? "cws_error_id" : "cws_error_download");
      // The download and Chromium's prompt take over; the button is usable again after a moment.
      setTimeout(() => { if (busy) setBusy(false); }, 4000);
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id === chrome.runtime.id && msg?.what === "enki-shield:cws-failed") failNow?.("cws_error_download");
  });

  // The store is a single-page app: follow its address.
  let shown;
  const sync = () => {
    const id = idHere();
    if (id === shown && (!id || host?.isConnected)) return;
    shown = id;
    if (id) render(id); else remove();
  };
  sync();
  setInterval(sync, 700);
})();
