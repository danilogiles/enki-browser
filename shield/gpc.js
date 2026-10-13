// Global Privacy Control (https://globalprivacycontrol.org): pages that ask see that the user
// does not want their data sold or shared. Every request also carries the header (Sec-GPC: 1,
// rules/gpc.json); this is the same signal for scripts, which read navigator.globalPrivacyControl.
// It runs in the page's own world, before its scripts (manifest: world MAIN, document_start).
// A getter on the prototype, like the browsers that ship GPC natively, not a property a page
// could tell apart from one.
Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true, configurable: true, enumerable: true });
