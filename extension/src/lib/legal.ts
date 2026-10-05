/**
 * Where the terms and privacy policy live. Inside Enki Browser (the build that makes Enki the
 * new tab page) they are the browser's, which cover Enki too; as a standalone extension, Enki's
 * own privacy policy applies.
 */
const BROWSER = "https://github.com/danilogiles/enki-browser/blob/main/";
const EXTENSION = "https://github.com/danilogiles/enkibrowser/blob/main/docs/";

/** Bumped when the terms change enough to ask again. */
export const TERMS_VERSION = "1";

export function legalLinks(): { terms: string; privacy: string } {
  const inBrowser = !!(chrome.runtime.getManifest() as chrome.runtime.Manifest & { chrome_url_overrides?: { newtab?: string } }).chrome_url_overrides?.newtab;
  return inBrowser
    ? { terms: `${BROWSER}TERMS.md`, privacy: `${BROWSER}PRIVACY.md` }
    : { terms: `${BROWSER}TERMS.md`, privacy: `${EXTENSION}PRIVACY_POLICY.md` };
}
