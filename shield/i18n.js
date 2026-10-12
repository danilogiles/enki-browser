// Enki Shield in the browser's language: English, Portuguese or Spanish (chrome.i18n, _locales/).
//
// The pages keep their English wording in the markup, so they read right before this runs and in
// any other language; elements marked data-i18n (text), data-i18n-html (this extension's own
// markup, never page or site text), data-i18n-aria and data-i18n-title are filled in from
// messages.json. The phishing warning (blocked.js) and the first-run guide (welcome.js) carry their
// own three-language tables and do not use this.

/** A message in the browser's language, with $1… filled in; the key itself only if it is missing. */
export function t(key, ...subs) {
  return chrome.i18n.getMessage(key, subs.map(String)) || key;
}

export function localize(root = document) {
  const fill = (attr, apply) => {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const text = chrome.i18n.getMessage(el.getAttribute(attr));
      if (text) apply(el, text);
    }
  };
  fill("data-i18n", (el, text) => { el.textContent = text; });
  fill("data-i18n-html", (el, text) => { el.innerHTML = text; });
  fill("data-i18n-aria", (el, text) => el.setAttribute("aria-label", text));
  fill("data-i18n-title", (el, text) => el.setAttribute("title", text));
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
