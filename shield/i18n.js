// Shields in the browser's language (Chrome's extension i18n, _locales/*/messages.json).
// English stays in the HTML as the fallback; elements carry data-i18n (text),
// data-i18n-aria-label and data-i18n-title with the message name.
export const t = (key, fallback, ...subs) => (globalThis.chrome?.i18n?.getMessage(key, subs.map(String)) || fallback);

export function localize(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const m = chrome.i18n.getMessage(el.dataset.i18n);
    if (m) el.textContent = m;
  }
  for (const attr of ["aria-label", "title"]) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      const m = chrome.i18n.getMessage(el.getAttribute(`data-i18n-${attr}`));
      if (m) el.setAttribute(attr, m);
    }
  }
  // The language the messages actually came from, for screen readers and hyphenation.
  const lang = chrome.i18n.getMessage("langCode");
  if (lang) document.documentElement.lang = lang;
}
// Node tests import modules that use t(); they have no page to localize.
if (globalThis.document && globalThis.chrome?.i18n) localize();
