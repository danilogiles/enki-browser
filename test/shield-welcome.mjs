// The one-time "Make Enki Browser your default browser" page (shield/default-browser.js), with a
// fake launcher and fake storage: when it opens, that it opens at most once per profile, and that
// deciding needs nothing but the launcher's local registry read. Runs anywhere.
//
//   node test/shield-welcome.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE, SEEN, defaultStatus, openDefaultApps, welcomeOnce } from "../shield/default-browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Nothing here may reach the network.
globalThis.fetch = () => { throw new Error("network used"); };

function profile(reply) {
  const data = {}, pages = [], messages = [];
  const env = {
    data, pages, messages,
    reply,
    native: async (m) => { messages.push(m.type); await new Promise((r) => setTimeout(r, 5)); return typeof env.reply === "function" ? env.reply(m) : env.reply; },
    storage: { get: async (k) => ({ [k]: data[k] }), set: async (o) => { Object.assign(data, o); } },
    openPage: async (p) => { pages.push(p); },
  };
  env.show = welcomeOnce(env);
  return env;
}

{
  const p = profile(null);
  const r = await p.show();
  check("no launcher (Linux, macOS, portable): no page, asked again next start", r === "unavailable" && !p.pages.length && !(SEEN in p.data), r);
}
{
  const p = profile({ updater: true, running: "0.8.4", ready: null });
  const r = await p.show();
  check("an older launcher (answers with its update status): no page", r === "unavailable" && !p.pages.length && !(SEEN in p.data), r);
}
{
  const p = profile({ registered: false, isDefault: false, portable: false });
  let r = await p.show();
  check("not registered yet (first start after a self-update): no page, nothing stored", r === "unavailable" && !p.pages.length && !(SEEN in p.data), r);
  p.reply = { registered: true, isDefault: false, portable: false };
  r = await p.show();
  check("registered on a later start: the page opens then", r === "shown" && p.pages.join() === PAGE, r);
}
{
  const p = profile({ registered: true, isDefault: false, portable: true });
  const r = await p.show();
  check("a portable copy: no page", r === "unavailable" && !p.pages.length, r);
}
{
  const p = profile({ registered: true, isDefault: false, portable: false });
  const first = await p.show();
  const again = [await p.show(), await p.show()];
  check("registered and not the default: the page opens once", first === "shown" && p.pages.length === 1 && p.pages[0] === "welcome.html", `${first}, ${p.pages.join()}`);
  check("never again in that profile, whatever the answer", again.every((r) => r === "seen") && p.pages.length === 1, again.join());
  check("the launcher is asked nothing after that", p.messages.length === 1 && p.messages[0] === "default-status", p.messages.join());
}
{
  const p = profile({ registered: true, isDefault: false, portable: false });
  const r = await Promise.all([p.show(), p.show(), p.show()]);
  check("onInstalled and onStartup on the same start: one page (they share one run)", p.pages.length === 1 && p.messages.length === 1, `${r.join()}; ${p.pages.length} page(s)`);
}
{
  const p = profile({ registered: true, isDefault: true, portable: false });
  const r = await p.show();
  p.reply = { registered: true, isDefault: false, portable: false };
  const later = await p.show();
  check("already the default: no page, and none later if another browser takes over", r === "default" && later === "seen" && !p.pages.length, `${r}, ${later}`);
}
{
  const p = profile({ registered: true, isDefault: false, portable: false });
  p.openPage = async () => { throw new Error("tabs.create failed"); };
  p.show = welcomeOnce(p);
  let error = null;
  try { await p.show(); } catch (e) { error = e.message; }
  const again = await p.show();
  check("stored before the page opens: a failure never shows it twice", error && SEEN in p.data && again === "seen", `${error}, ${again}`);
}
{
  const status = await defaultStatus(async () => ({ error: "boom" }));
  const opened = await openDefaultApps(async (m) => (m.type === "open-default-apps" ? { opened: true } : null));
  const refused = await openDefaultApps(async () => ({ opened: false }));
  const none = await openDefaultApps(async () => null);
  check("launcher errors read as unknown; Settings opened only when the launcher says so", status === null && opened && !refused && !none);
}

// ---- wiring: no new permission, Chromium's own bar still off, background and page hooked up
{
  const manifest = JSON.parse(readFileSync(path.join(root, "shield", "manifest.json"), "utf8"));
  const expected = ["declarativeNetRequest", "webNavigation", "webRequest", "tabs", "storage", "alarms", "contentSettings", "browsingData", "nativeMessaging"];
  check("Enki Shield asks for no new permission", JSON.stringify(manifest.permissions) === JSON.stringify(expected) && !manifest.optional_permissions, manifest.permissions.join(", "));
  const flags = readFileSync(path.join(root, "config", "flags.txt"), "utf8");
  check("Chromium's default browser bar stays off (--no-default-browser-check)", /^--no-default-browser-check\s*$/m.test(flags));
  const bg = readFileSync(path.join(root, "shield", "background.js"), "utf8");
  check("the background script offers the page on install and on start", /welcomeOnce\(/.test(bg) && /onStartup\.addListener\(offerDefault\)/.test(bg) && /onInstalled\.addListener\(offerDefault\)/.test(bg));
  const html = readFileSync(path.join(root, "shield", "welcome.html"), "utf8");
  check("welcome.html loads welcome.js and has the two buttons", /src="welcome\.js"/.test(html) && /id="open-settings"/.test(html) && /id="not-now"/.test(html));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
