// Private Windows test copies (docs/WINDOWS-TEST-COPY.md). scripts/windows-test-package.py writes
// test-copy.json into the test package's copy of this extension; normal builds never have it. In
// a test copy, Shield never talks to the native host: the copy registers none of its own, so the
// host Chromium would find is the real install's, and any click would act on the real install.
// Everything that needs the host (updates, restart, default browser, protected video) is hidden
// and the visible label TEST_COPY says why.

export const TEST_COPY = "Test copy, updates off";
export const UNAVAILABLE = "Unavailable in this copy.";

let cached = null;
/** { label } in a test copy, else null. Read once per page or worker. */
export function testCopy(read = () => fetch(chrome.runtime.getURL("test-copy.json")).then((r) => (r.ok ? r.json() : null))) {
  return (cached ??= (async () => {
    try {
      const j = await read();
      return j && j.testCopy === true ? { label: typeof j.label === "string" ? j.label : "" } : null;
    } catch { return null; } // normal builds: the file does not exist
  })());
}

/** Tests only: forget the cached answer. */
export function resetTestCopy() { cached = null; }
