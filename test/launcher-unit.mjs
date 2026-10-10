// Compiles test/LauncherTests.cs with the launcher sources it tests and runs it: the .NET
// Framework csc on Windows (as the build does), Mono's mcs and mono elsewhere. The registry tests
// write only under HKCU\Software\EnkiTest-<random> and delete it; under Mono the registry is a
// throwaway folder.
//
//   node test/launcher-unit.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  path.join(root, "test", "LauncherTests.cs"),
  ...["Args.cs", "Common.cs", "DefaultBrowser.cs", "Migration.cs", "WidevineTrust.cs"].map((f) => path.join(root, "launcher", f)),
];
const work = mkdtempSync(path.join(os.tmpdir(), "enki-launcher-unit-"));
const exe = path.join(work, "LauncherTests.exe");
const refs = ["System.Core.dll", "System.Web.Extensions.dll"];

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env });
  if (r.error) throw r.error;
  return r.status;
}

let status;
try {
  if (process.platform === "win32") {
    const windir = process.env.WINDIR ?? "C:\\Windows";
    const csc = ["Framework64", "Framework"].map((f) => path.join(windir, "Microsoft.NET", f, "v4.0.30319", "csc.exe")).find(existsSync);
    if (!csc) throw new Error("The .NET Framework C# compiler (csc.exe) was not found.");
    if (run(csc, ["/nologo", "/target:exe", ...refs.map((r) => `/r:${r}`), `/out:${exe}`, ...sources]) !== 0) throw new Error("compiling the launcher tests failed");
    status = run(exe, []);
  } else {
    const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
    if (!has("mcs") || !has("mono")) throw new Error("Mono (mcs and mono) is needed to run the launcher tests outside Windows.");
    // -langversion:5 holds the sources to what the .NET Framework csc the build uses accepts.
    // The three programs first, as build/build.mjs compiles them (its BuildInfo.g.cs stood in for).
    const buildInfo = path.join(work, "BuildInfo.g.cs");
    writeFileSync(buildInfo, 'static class UpdateKey { public const string Modulus = ""; public const string Exponent = ""; }\n');
    const src = (f) => path.join(root, "launcher", f);
    const programs = {
      stub: ["Stub.cs", "Args.cs", "Common.cs", "Install.cs", "DefaultBrowser.cs"].map(src),
      launcher: ["Launcher.cs", "Updater.cs", "NativeHost.cs", "Widevine.cs", "WidevineTrust.cs", "Migration.cs", "Watcher.cs", "ShellIdentity.cs", "Args.cs", "Common.cs", "Install.cs", "DefaultBrowser.cs"].map(src),
      setup: [path.join(root, "installer", "Setup.cs"), ...["Common.cs", "Install.cs", "DefaultBrowser.cs"].map(src)],
    };
    const programRefs = ["System.Windows.Forms.dll", "System.Drawing.dll", "Microsoft.CSharp.dll", "System.IO.Compression.dll", "System.IO.Compression.FileSystem.dll", ...refs];
    for (const [name, files] of Object.entries(programs)) {
      if (run("mcs", ["-nologo", "-langversion:5", "-target:winexe", ...programRefs.map((r) => `-r:${r}`), `-out:${path.join(work, name + ".exe")}`, ...files, buildInfo]) !== 0)
        throw new Error(`compiling the ${name} failed`);
      console.log(`PASS the ${name} compiles as C# 5`);
    }
    if (run("mcs", ["-nologo", "-langversion:5", "-target:exe", ...refs.map((r) => `-r:${r}`), `-out:${exe}`, ...sources]) !== 0) throw new Error("compiling the launcher tests failed");
    status = run("mono", [exe], { ...process.env, MONO_REGISTRY_PATH: path.join(work, "registry") });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(status ?? 1);
