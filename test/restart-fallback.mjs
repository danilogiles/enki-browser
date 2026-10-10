// "Restart to update" in Shields' settings must never hang on "Restarting…" (0.8.5/0.8.6 did when
// the launcher did not restart). Runs shield/updates.js's handler with stand-in elements and a
// fake clock: after 10 seconds, a grey helper line and a "Try again" button.
//   node test/restart-fallback.mjs
import { readFileSync } from "node:fs";
import { RESTART_FALLBACK_MS, RESTART_HELP, restartWithFallback } from "../shield/updates.js";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const els = () => ({ button: { disabled: false, textContent: "Restart to update" }, state: { textContent: "" }, help: { hidden: true, textContent: "" } });
const clock = () => { const t = { pending: [], set: (fn, ms) => t.pending.push({ fn, ms }), fire: () => t.pending.splice(0).forEach((p) => p.fn()) }; return t; };
const tick = () => new Promise((r) => setImmediate(r));

check("the copy is Ink's, exactly", RESTART_HELP === "Didn't restart? Close every Enki window and reopen it.");
check("the fallback waits 10 seconds", RESTART_FALLBACK_MS === 10000);

{ // the launcher accepted, but the browser never closed
  const e = els(), c = clock();
  const shown = restartWithFallback(e, async () => ({ restarting: true }), RESTART_FALLBACK_MS, c.set);
  await tick();
  check("while waiting: Restarting…, button disabled, no helper", e.state.textContent === "Restarting…" && e.button.disabled && e.help.hidden);
  check("one timer of 10 s", c.pending.length === 1 && c.pending[0].ms === 10000);
  c.fire();
  check("after 10 s: the helper line shows", (await shown) === "fallback" && !e.help.hidden && e.help.textContent === RESTART_HELP);
  check("after 10 s: no more Restarting…", e.state.textContent === "");
  check("after 10 s: the button is clickable again as Try again", !e.button.disabled && e.button.textContent === "Try again");
  // Try again
  const c2 = clock();
  restartWithFallback(e, async () => ({ restarting: true }), RESTART_FALLBACK_MS, c2.set);
  await tick();
  check("Try again hides the helper and waits again", e.help.hidden && e.button.disabled && e.state.textContent === "Restarting…");
}
for (const [what, ask] of [["no launcher watching", async () => ({ restarting: false })], ["no native host", async () => null], ["a failed call", async () => { throw new Error("x"); }]]) {
  const e = els(), c = clock();
  const shown = restartWithFallback(e, ask, RESTART_FALLBACK_MS, c.set);
  await tick();
  check(`${what}: the helper shows at once, without waiting`, (await shown) === "fallback" && !e.help.hidden && e.button.textContent === "Try again");
}
const html = readFileSync(new URL("../shield/options.html", import.meta.url), "utf8");
check("the helper line is in the page, hidden, in the secondary grey (not red)",
  /<span id="restart-help"[^>]*hidden>/.test(html) && /#restart-help \{[^}]*color: var\(--muted\)/.test(html) && /#restart-help\[hidden\] \{ display: none; \}/.test(html));
process.exit(failed ? 1 : 0);
