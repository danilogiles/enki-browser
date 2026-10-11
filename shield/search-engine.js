// The address bar's search choice, which Enki owns (enki:getSearchEngine / enki:setSearchEngine).
// Shield keeps it honest: "enki" only while Shield may run in Incognito, because the address bar
// cannot be switched back by code and Incognito searches would otherwise end on a blocked page.
export const ENKI_ID = "caelfocbikejgdamghjlkpmbbaobehlp";
export const PAUSED = "search:paused"; // local: true when AI search was turned off for that reason
export const CHOSEN_AT = "search:chosenAt";   // local: when Enki AI was chosen (a timestamp, nothing else)
export const SETUP_DONE = "searchSetupDone"; // local: true once search.html ran from a normal window (+ searchSetupDoneAt, a date)
export const REMINDED = "search:reminded";   // local: the "make Enki your default" reminder was shown
const DAY = 24 * 60 * 60 * 1000;

/** Enki AI was just chosen: remember when, and check again in 24 h. */
export async function markChosen() {
  const at = Date.now();
  await chrome.storage.local.set({ [CHOSEN_AT]: at });
  await chrome.storage.local.remove(REMINDED);
  chrome.alarms?.create("search-reminder", { when: at + DAY });
}

/** True once: 24 h after choosing Enki AI, the address bar still never reached search.html. */
export async function reminderDue() {
  const s = await chrome.storage.local.get([CHOSEN_AT, SETUP_DONE, REMINDED]);
  return typeof s[CHOSEN_AT] === "number" && Date.now() - s[CHOSEN_AT] >= DAY && s[SETUP_DONE] !== true && s[REMINDED] !== true;
}

const ask = (msg) => Promise.race([
  chrome.runtime.sendMessage(ENKI_ID, msg),
  new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 1000)),
]);

/** "enki" | "ddg", or null when Enki does not answer. */
export async function getEngine() {
  const v = await ask({ type: "enki:getSearchEngine" }).catch(() => null);
  return v === "enki" || v === "ddg" ? v : null;
}
export async function setEngine(engine) {
  await ask({ type: "enki:setSearchEngine", engine });
  return getEngine();
}

/** Called on every worker start and when settings opens. */
export async function enforceIncognito() {
  if (chrome.extension.inIncognitoContext) return;
  if (await chrome.extension.isAllowedIncognitoAccess()) return;
  if ((await getEngine()) !== "enki") return;
  await setEngine("ddg").catch(() => {});
  await chrome.storage.local.set({ [PAUSED]: true });
}

/** shield:incognitoAllowed from Enki: exactly that message, from Enki only → { allowed, searchSetupDone }. */
export function listenExternal() {
  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    if (sender.id !== ENKI_ID || !msg || typeof msg !== "object" || Array.isArray(msg)
      || Object.keys(msg).length !== 1 || msg.type !== "shield:incognitoAllowed") return false;
    // Exactly two booleans: never the date of searchSetupDone, never anything else.
    Promise.all([chrome.extension.isAllowedIncognitoAccess(), chrome.storage.local.get(SETUP_DONE)])
      .then(([allowed, s]) => reply({ allowed: allowed === true, searchSetupDone: s[SETUP_DONE] === true }),
        () => reply({ allowed: false, searchSetupDone: false }));
    return true;
  });
}
