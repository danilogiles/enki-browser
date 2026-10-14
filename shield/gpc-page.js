// Global Privacy Control's page half (gpc.js registers it: MAIN world, document_start, every
// frame). Defined on Navigator.prototype, as Firefox and Brave do, so it reads like a built-in.
Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
  get() { return true; }, configurable: true, enumerable: true,
});
