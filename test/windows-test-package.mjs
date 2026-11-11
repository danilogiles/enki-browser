// scripts/windows-test-package.py: the label can never break out of test-copy.json, the marker or
// the shortcut script, and what it writes is what the launcher (Common.cs) and Shield read.
// Runs on a tiny stand-in build zip (no real browser), with python3.
//   node test/windows-test-package.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "windows-test-package.py");
const work = mkdtempSync(path.join(os.tmpdir(), "enki-test-package-"));
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const py = (args, input) => spawnSync("python3", args, { encoding: "utf8", input });

try {
  // A stand-in build: the files the script requires, with the marker string the launcher carries.
  const zip = path.join(work, "build.zip");
  const made = py(["-c", `
import sys, zipfile
m = "test-isolated".encode("utf-16-le")
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("EnkiBrowser/current", "0.8.16\\n")
    for f in ("EnkiBrowser/EnkiBrowser.exe", "EnkiBrowser/app/0.8.16/EnkiBrowser.exe", "EnkiBrowser/app/0.8.16/EnkiBrowserLauncher.exe"):
        z.writestr(f, b"MZ" + m)
    z.writestr("EnkiBrowser/app/0.8.16/chromium/chrome.exe", b"MZ")
    z.writestr("EnkiBrowser/app/0.8.16/version.json", '{"enkiBrowser":"0.8.16"}')
    z.writestr("EnkiBrowser/app/0.8.16/extensions/shield/manifest.json", "{}")
    z.writestr("EnkiBrowser/app/0.8.16/extensions/shield/testcopy.js", "//")
    z.writestr("EnkiBrowser/portable", "")
`, zip]);
  check("stand-in build zip made", made.status === 0, made.stderr);

  for (const label of ['a"b', "a'b", "a b", "a\\b", "a\nb", "a;b", "x".repeat(41), ""]) {
    const out = path.join(work, "bad");
    const r = py([script, zip, "--label", label, "--out", out]);
    check(`label ${JSON.stringify(label)} is refused, nothing written`, r.status !== 0 && !existsSync(path.join(out, `Enki-LiveChat-${label}-Windows-x64`)), r.stderr.trim());
  }

  // Even a label the CLI refuses is escaped by the writer (defense in depth).
  const esc = py(["-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("pkg", sys.argv[1]); pkg = importlib.util.module_from_spec(spec); spec.loader.exec_module(pkg)
text = pkg.shield_json('a"b\\\\c</x>', "0" * 32)
back = json.loads(text)
print(json.dumps({"ok": back["label"] == 'a"b\\\\c</x>' and back["token"] == "0" * 32 and back["testCopy"] is True and '"token":"' + "0" * 32 + '"' in text}))
try:
    pkg.marker_text_for('a"\\nb', "0" * 32); print(json.dumps({"marker": "accepted"}))
except ValueError:
    print(json.dumps({"marker": "refused"}))
`, script]);
  const [jsonOk, markerOk] = esc.stdout.trim().split("\n").map((l) => JSON.parse(l));
  check("test-copy.json is real JSON: a quote and a backslash in the label come back as written", jsonOk?.ok === true, esc.stderr);
  check("the marker writer refuses a label that could add a line", markerOk?.marker === "refused");

  const out = path.join(work, "out");
  const r = py([script, zip, "--label", "v0.8_16-rc.1", "--source", 'commit "x"', "--out", out]);
  check("a label with '.', '_' and '-' is accepted", r.status === 0, r.stderr);
  const base = path.join(out, "Enki-LiveChat-v0.8_16-rc.1-Windows-x64");
  const shield = JSON.parse(readFileSync(path.join(base, "EnkiBrowser/app/0.8.16/extensions/shield/test-copy.json"), "utf8"));
  const lines = readFileSync(path.join(base, "EnkiBrowser/test-isolated"), "utf8").split(/\r?\n/);
  check("marker and Shield file carry the same label and token",
    lines[0] === "enki-test-isolated/1" && lines[1] === "label=v0.8_16-rc.1" && lines[2] === `token=${shield.token}` && /^[0-9a-f]{32}$/.test(shield.token) && shield.label === "v0.8_16-rc.1" && shield.testCopy === true);
  check("no portable file; no-update present", !existsSync(path.join(base, "EnkiBrowser/portable")) && existsSync(path.join(base, "EnkiBrowser/no-update")));
  const ps1 = readFileSync(path.join(base, "Create-Test-Shortcut.ps1"), "utf8");
  check("the shortcut targets EnkiBrowser.exe", ps1.includes("$link.TargetPath = $stub") && ps1.includes("'EnkiBrowser.exe'") && !/chrome\.exe/i.test(ps1));
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
