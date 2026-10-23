// Decides the "third-party cookies are blocked" check in test/verify.mjs from what Chromium
// actually holds and does, not from the wording of chrome://settings.
//
// profile.cookie_controls_mode: 0 allow, 1 block third-party, 2 block in incognito only (the
// registered default). Enki's config/initial_preferences.json sets 1. (It also used to set
// block_third_party_cookies, which Chromium 154 does not register and never read.)
//
// A policy (BlockThirdPartyCookies, or any other source that enforces the pref) outranks the
// profile, and the settings page then shows the policy's value. A label check read that as Enki
// shipping the wrong default. This check fails in that case too, but says so: the build cannot be
// judged on a machine whose policy decides the setting.
export const BLOCK_THIRD_PARTY = 1;

/**
 * @param {object} s
 * @param {{value:number, enforcement?:string, controlledBy?:string}|null} s.pref
 *        chrome.settingsPrivate.getPref("profile.cookie_controls_mode"): the value in effect.
 * @param {number|null|undefined} s.profileValue  profile.cookie_controls_mode in the profile's
 *        Preferences file (Enki's own value; null if missing or not yet written).
 * @param {{firstParty:boolean, thirdParty:boolean}|null} s.network  whether the test cookie came
 *        back on a first-party request (the control) and on a cross-site iframe request.
 * @returns {{ok:boolean, detail:string}}
 */
export function judgeThirdPartyCookies({ pref, profileValue, network }) {
  if (!pref || typeof pref.value !== "number") return { ok: false, detail: "profile.cookie_controls_mode not readable from the settings page" };
  if (pref.enforcement || pref.controlledBy) {
    return { ok: false, detail: `overridden by machine policy: cookie_controls_mode=${pref.value} (${[pref.enforcement, pref.controlledBy].filter(Boolean).join(", ")}); ` +
      `Enki's own value in the profile: ${profileValue ?? "missing"}` };
  }
  if (pref.value !== BLOCK_THIRD_PARTY) return { ok: false, detail: `cookie_controls_mode=${pref.value}, expected ${BLOCK_THIRD_PARTY} (block third-party)` };
  if (!network) return { ok: false, detail: "the third-party cookie request did not run" };
  if (!network.firstParty) return { ok: false, detail: "control failed: the test cookie was not sent even first-party, so the third-party result says nothing" };
  return { ok: !network.thirdParty, detail: `cookie_controls_mode=1, third-party cookie ${network.thirdParty ? "SENT" : "not sent"}` };
}
