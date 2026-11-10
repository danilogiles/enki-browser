// Helpers shared by the entry stub, the launcher and the installer.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Win
{
    /// Quotes one argument the way CommandLineToArgvW parses it back.
    public static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        var sb = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"') { sb.Append('\\', backslashes * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', backslashes); sb.Append(c); }
            backslashes = 0;
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    public static string JoinArgs(IEnumerable<string> args) { return string.Join(" ", args.Select(Quote)); }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint size);

    /// The long form of a path: C:\Users\RUNNER~1\... and C:\Users\runneradmin\... must compare equal.
    public static string LongPath(string path)
    {
        var sb = new StringBuilder(1024);
        uint n = 0;
        try { n = GetLongPathName(path, sb, (uint)sb.Capacity); }
        catch (DllNotFoundException) { } // not Windows: the unit tests also run under Mono
        catch (EntryPointNotFoundException) { }
        return (n > 0 && n < sb.Capacity ? sb.ToString() : Path.GetFullPath(path)).TrimEnd('\\');
    }

    /// Enki Browser processes (chrome.exe) running from inside `dir`, and no other browser's.
    public static List<Process> BrowserProcesses(string dir)
    {
        string prefix = LongPath(dir) + "\\";
        var found = new List<Process>();
        foreach (var p in Process.GetProcessesByName("chrome"))
        {
            try { if (LongPath(p.MainModule.FileName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) found.Add(p); }
            catch { /* another user's or an elevated process: not ours */ }
        }
        return found;
    }

    public static void CloseBrowser(string dir)
    {
        foreach (var p in BrowserProcesses(dir)) { try { p.CloseMainWindow(); } catch { } }
        for (int i = 0; i < 20 && BrowserProcesses(dir).Count > 0; i++) Thread.Sleep(250);
        foreach (var p in BrowserProcesses(dir)) { try { p.Kill(); } catch { } }
        for (int i = 0; i < 20 && BrowserProcesses(dir).Count > 0; i++) Thread.Sleep(250);
        // The launcher stays beside a running browser and leaves a few seconds after it; the
        // uninstaller and the installer remove its folder, so it goes now. (Only called from
        // outside the launcher: the uninstaller's temp copy of the stub, and the installer.)
        foreach (var p in Processes("EnkiBrowserLauncher", dir)) { try { p.Kill(); p.WaitForExit(5000); } catch { } }
    }

    /// Processes with this executable name running from inside `dir`.
    static List<Process> Processes(string name, string dir)
    {
        string prefix = LongPath(dir) + "\\";
        var found = new List<Process>();
        foreach (var p in Process.GetProcessesByName(name))
        {
            try { if (LongPath(p.MainModule.FileName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) found.Add(p); }
            catch { }
        }
        return found;
    }

    /// Deletes a folder, retrying while an antivirus scan or a closing process holds a file.
    public static void DeleteTree(string path)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, true); else if (File.Exists(path)) File.Delete(path); return; }
            catch (IOException) { if (attempt >= 10) throw; Thread.Sleep(300); }
            catch (UnauthorizedAccessException) { if (attempt >= 10) throw; Thread.Sleep(300); }
        }
    }

    static readonly string Lang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
    /// Portuguese, Spanish or English, following Windows' display language.
    public static string T(string pt, string es, string en) { return Lang == "pt" ? pt : Lang == "es" ? es : en; }
}

// Test-isolated mode: a private test copy that must never touch the Enki Browser already installed
// on the same computer. Normal installs (no marker) behave exactly as before.
//
// The marker is a file named "test-isolated" next to EnkiBrowser.exe, and it only counts when it is
// what scripts/windows-test-package.py writes: a first line "enki-test-isolated/1", a "label=" and a
// "token=" (32 hex digits), the same token as in the test-copy.json the script writes into the
// Shield of the version `current` names (app\<version>\extensions\shield). That file is also how
// Shield knows to hide everything that needs the native host (shield/testcopy.js), so a valid
// marker always comes with Shield's visible "Test copy, updates off". A stray or hand-made file next
// to a real install is ignored (Problem says why; the launcher logs it) and updates go on.
//
// Most of what the launcher writes is scoped to its own folder, but some of it is per user and
// shared by every copy: the "Check for updates" native messaging host (one HKCU key that names
// whichever copy started last), the Apps entry and browser registration (DefaultBrowser.cs), the
// updater's machine-wide "EnkiBrowserUpdater" mutex and its update staging, and the uninstaller's
// shortcuts, HKCU entries and %LOCALAPPDATA%\EnkiBrowser profile. A test copy skips all of them:
//  - the profile lives beside the program (<root>\User Data), as for a portable copy;
//  - NativeHost.Register, Install.SyncRegistration (and with it DefaultBrowser.Register/Repair) do not run;
//  - updates are off (Updater.Disabled): no check, download, staging, `current` rewrite,
//    restart offer, or Widevine refresh;
//  - --uninstall removes only the copy's own folder (its profile is inside it), never the real
//    install's shortcuts, registry entries or profile.
// What still runs is scoped to this copy: Migration and Widevine.Tidy on the copy's own profile,
// the Watcher (per-root mutex, tidies only this root's app\ folder and stub) and ShellIdentity
// (repairs only shortcuts that open this root's own chrome.exe). Process identity is unchanged:
// the browser still starts through EnkiBrowser.exe → EnkiBrowserLauncher.exe → chrome.exe.
static class Isolation
{
    public const string Marker = "test-isolated";
    public const string Header = "enki-test-isolated/1";
    public const string ShieldFile = "test-copy.json";

    public static bool TestIsolated(string root) { return Problem(root) == null; }

    /// Null when root holds a valid test-isolated marker; otherwise why not ("no marker" when there
    /// is none, which is every normal install).
    public static string Problem(string root)
    {
        try
        {
            if (string.IsNullOrEmpty(root) || !File.Exists(Path.Combine(root, Marker))) return "no marker";
            string[] lines = File.ReadAllLines(Path.Combine(root, Marker)).Select(l => l.Trim()).Where(l => l.Length > 0).ToArray();
            if (lines.Length == 0 || lines[0] != Header) return "the marker is not one the test package script wrote";
            string label = lines.Where(l => l.StartsWith("label=")).Select(l => l.Substring(6)).FirstOrDefault();
            string token = lines.Where(l => l.StartsWith("token=")).Select(l => l.Substring(6)).FirstOrDefault();
            if (string.IsNullOrEmpty(label)) return "the marker has no label";
            if (token == null || token.Length != 32 || !token.All(Uri.IsHexDigit)) return "the marker has no valid token";
            string version = File.ReadAllText(Path.Combine(root, "current")).Trim();
            if (version.Length == 0 || version.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || version.Contains("..")) return "current names no version";
            string shield = Path.Combine(root, "app", version, "extensions", "shield", ShieldFile);
            if (!File.Exists(shield)) return "Shield in " + version + " has no " + ShieldFile;
            string json = File.ReadAllText(shield).Replace(" ", "");
            if (json.IndexOf("\"token\":\"" + token.ToLowerInvariant() + "\"", StringComparison.Ordinal) < 0) return "the token does not match Shield's " + ShieldFile;
            return null;
        }
        catch (Exception e) { return "the marker could not be read: " + e.Message; }
    }
}

// Who may make the native host act (NativeHost.cs). Chromium finds the host by name in HKCU, so a
// browser from another copy (a test copy, a portable one) reaches whichever copy registered last.
// Requests that change something (update, restart, default browser, protected video) are only
// carried out for a browser running from this install's own app\ folder; read-only status still
// answers anyone. The pure parts are here so the unit tests can reach them.
static class HostGuard
{
    /// The requests that act; every other type only reads.
    public static readonly string[] Acting = { "check", "restart", "open-default-apps", "widevine-install", "widevine-remove" };

    public static bool Acts(string type) { return type != null && Acting.Contains(type); }

    /// The window handle Chromium passes on Windows as --parent-window=<HWND>; 0 when absent.
    public static long ParentWindow(IEnumerable<string> args)
    {
        foreach (string a in args ?? new string[0])
        {
            long v;
            if (a != null && a.StartsWith("--parent-window=", StringComparison.Ordinal) && long.TryParse(a.Substring("--parent-window=".Length), out v) && v > 0) return v;
        }
        return 0;
    }

    /// Whether `exe` (already a long, full path) is a chrome.exe inside `appFolder` (<root>\app).
    public static bool Under(string exe, string appFolder)
    {
        if (string.IsNullOrEmpty(exe) || string.IsNullOrEmpty(appFolder)) return false;
        string prefix = appFolder.TrimEnd('\\') + "\\";
        return exe.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && exe.EndsWith("\\chromium\\chrome.exe", StringComparison.OrdinalIgnoreCase)
            && exe.IndexOf("\\..\\", StringComparison.Ordinal) < 0;
    }
}
