// "Check for updates" inside the browser. Enki Shield's settings page asks; this launcher answers,
// through Chromium's native messaging: Chromium starts the program a registered host manifest
// names, with the calling extension's origin as its first argument, and they exchange JSON over
// stdin and stdout, each message prefixed with its length. Only Enki Shield may call it (the
// manifest's allowed_origins), and all it can ask for is what the tray notification already
// offers (check now, and restart into a downloaded update), plus, since 0.8.6, whether Enki
// Browser is the default browser (a registry read on this computer) and opening the Settings page
// where the user makes it so (DefaultBrowser.cs), and protected video (Widevine.cs): its state,
// and turning it on or off. Only two things it does go over the network: the update check, and,
// once the user turned protected video on (opt-in, never by default), the Widevine module's download
// from Google and its daily check for a newer one (Widevine.cs: HTTPS, Google's SHA-256, Google's signature).
//
// The manifest names the launcher of the version that started the browser, so it is written at
// every start; the registry entry pointing at it lives under HKCU\Software\Chromium, where Chromium
// looks, and is removed by the uninstaller (Install.Unregister). Updates themselves are unchanged: the same signed,
// verified download as the background check (Updater.cs), only started by a click.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

static class NativeHost
{
    public const string Name = "io.github.danilogiles.enki_browser";

    /// Chromium starts a native messaging host with the caller's origin as the first argument.
    public static bool IsCall(string[] args)
    {
        return args.Length > 0 && args[0].StartsWith("chrome-extension://", StringComparison.Ordinal);
    }

    /// Makes this launcher the host Enki Shield talks to.
    public static void Register(string root, string appDir)
    {
        // The HKCU key is shared by every copy: a test-isolated one must leave the real install's in place.
        if (Isolation.TestIsolated(root)) return;
        try
        {
            var json = new JavaScriptSerializer();
            var v = json.DeserializeObject(File.ReadAllText(Path.Combine(appDir, "version.json"))) as Dictionary<string, object>;
            string shield = v != null && v.ContainsKey("shieldExtensionId") ? v["shieldExtensionId"] as string : null;
            if (string.IsNullOrEmpty(shield)) return;
            string dir = Path.Combine(root, ".update");
            Directory.CreateDirectory(dir);
            string manifest = Path.Combine(dir, "native-host.json");
            File.WriteAllText(manifest, json.Serialize(new Dictionary<string, object>
            {
                { "name", Name },
                { "description", "Enki Browser: updates and default browser" },
                { "path", Path.Combine(appDir, "EnkiBrowserLauncher.exe") },
                { "type", "stdio" },
                { "allowed_origins", new[] { "chrome-extension://" + shield + "/" } },
            }));
            using (var key = Registry.CurrentUser.CreateSubKey(Install.NativeHostKey)) key.SetValue("", manifest);
        }
        catch (Exception e) { Updater.Log(root, "check-for-updates link skipped: " + e.Message); }
    }

    /// One request, one reply (chrome.runtime.sendNativeMessage), then exit. `args` is the host's
    /// command line: the caller's origin, then on Windows --parent-window=<HWND>.
    public static int Run(string root, string appDir, string[] args)
    {
        var json = new JavaScriptSerializer();
        Dictionary<string, object> reply;
        try
        {
            var request = json.DeserializeObject(Read(Console.OpenStandardInput())) as Dictionary<string, object>;
            string type = request != null && request.ContainsKey("type") ? request["type"] as string : null;
            string refused = HostGuard.Acts(type) ? Refusal(root, args) : null;
            if (refused != null)
            {
                // Shield shows "Unavailable in this copy." (shield/updates.js, widevine.js, options.js).
                Updater.Log(root, "native host: refused " + type + ": " + refused);
                reply = new Dictionary<string, object> { { "unavailable", true }, { "error", "unavailable in this copy" }, { "opened", false }, { "restarting", false } };
            }
            else if (type == "check") reply = Check(root, appDir);
            else if (type == "default-status") reply = DefaultStatus(root);
            else if (type == "open-default-apps")
            {
                // Only for an install Windows knows as a browser; Settings would not list it otherwise.
                bool registered = DefaultBrowser.IsRegistered(Registry.CurrentUser, root);
                reply = new Dictionary<string, object> { { "opened", registered && DefaultBrowser.OpenSettings() } };
            }
            // Protected video (Widevine.cs): only on a click in Shields' settings, which shows what it is first.
            else if (type == "widevine-status") reply = Widevine.Status(Install.UserData(root));
            else if (type == "widevine-install")
            {
                string userData = Install.UserData(root);
                Widevine.Install(root, appDir, userData);
                reply = Widevine.Status(userData);
                reply["restartNeeded"] = true;
            }
            else if (type == "widevine-remove")
            {
                Widevine.Remove(root, Install.UserData(root));
                reply = Widevine.Status(Install.UserData(root));
            }
            else if (type == "restart")
            {
                // The running browser's own launcher restarts it, as the tray's "Restart and update" does.
                // false: no launcher is watching this browser, so nothing will restart it; the page says so.
                reply = new Dictionary<string, object> { { "restarting", Watcher.RequestRestart(root) } };
            }
            else reply = Status(root, appDir, null);
        }
        catch (Exception e) { reply = new Dictionary<string, object> { { "error", e.Message } }; }
        Write(Console.OpenStandardOutput(), json.Serialize(reply));
        return 0;
    }

    /// Null when the request may act; otherwise why not. The calling browser is the process that
    /// owns --parent-window, or else the first chrome.exe up the parent chain (Chromium starts hosts
    /// through cmd.exe). Unknown callers are refused: these requests come from Shield's settings
    /// page, which always has a window, and a refusal only greys out one button.
    static string Refusal(string root, string[] args)
    {
        if (Isolation.TestIsolated(root)) return "this is a test-isolated copy";
        string appFolder = Win.LongPath(Path.Combine(root, "app"));
        string exe = null;
        long hwnd = HostGuard.ParentWindow(args);
        if (hwnd != 0)
        {
            uint pid;
            if (GetWindowThreadProcessId(new IntPtr(hwnd), out pid) != 0 && pid != 0) exe = ExePath((int)pid);
        }
        if (exe == null) exe = ChromeAncestor();
        if (exe == null) return "the calling browser could not be identified";
        exe = Win.LongPath(exe);
        return HostGuard.Under(exe, appFolder) ? null : "the calling browser (" + exe + ") is not this install's";
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    static string ExePath(int pid)
    {
        try { using (var p = System.Diagnostics.Process.GetProcessById(pid)) return p.MainModule.FileName; }
        catch { return null; }
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    /// The nearest chrome.exe among this process's ancestors (at most four steps up), or null.
    static string ChromeAncestor()
    {
        var parents = new Dictionary<uint, uint>();
        var names = new Dictionary<uint, string>();
        IntPtr snap = IntPtr.Zero;
        try
        {
            snap = CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0);
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return null;
            var e = new PROCESSENTRY32 { dwSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(PROCESSENTRY32)) };
            for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e)) { parents[e.th32ProcessID] = e.th32ParentProcessID; names[e.th32ProcessID] = e.szExeFile; }
        }
        catch { return null; }
        finally { if (snap != IntPtr.Zero && snap != new IntPtr(-1)) CloseHandle(snap); }
        uint id = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        for (int i = 0; i < 4 && parents.TryGetValue(id, out id) && id != 0; i++)
        {
            string name;
            if (names.TryGetValue(id, out name) && string.Equals(name, "chrome.exe", StringComparison.OrdinalIgnoreCase)) return ExePath((int)id);
        }
        return null;
    }

    /// Whether this install is registered as a browser and is the user's default for links.
    /// Portable copies are never registered (Install.SyncRegistration).
    static Dictionary<string, object> DefaultStatus(string root)
    {
        return new Dictionary<string, object>
        {
            { "registered", DefaultBrowser.IsRegistered(Registry.CurrentUser, root) },
            { "isDefault", DefaultBrowser.IsDefault(Registry.CurrentUser) },
            { "portable", File.Exists(Path.Combine(root, "portable")) },
            { "testIsolated", Isolation.TestIsolated(root) },
        };
    }

    static Dictionary<string, object> Check(string root, string appDir)
    {
        if (Updater.Disabled(root)) return Status(root, appDir, null);
        string error;
        Version latest = Updater.CheckNow(root, appDir, out error);
        var status = Status(root, appDir, latest);
        if (error != null) status["error"] = error;
        return status;
    }

    /// The version the browser is running, the newer one installed and waiting for a restart (if
    /// any), and the newest release the check saw.
    static Dictionary<string, object> Status(string root, string appDir, Version latest)
    {
        Version running = RunningVersion(root) ?? Updater.ReadVersion(appDir);
        string installed = null;
        try { installed = File.ReadAllText(Path.Combine(root, "current")).Trim(); } catch { }
        Version v;
        bool ready = installed != null && Version.TryParse(installed, out v) && v > running
            && File.Exists(Path.Combine(root, "app", installed, "EnkiBrowserLauncher.exe"));
        return new Dictionary<string, object>
        {
            { "running", running.ToString() },
            { "ready", ready ? installed : null },
            { "latest", latest != null ? latest.ToString() : null },
            { "updatesOff", Updater.Disabled(root) },
        };
    }

    /// From the browser's own processes (app\<version>\chromium\chrome.exe): a launcher started
    /// after an update was installed is the new version, but the open browser is still the old one.
    static Version RunningVersion(string root)
    {
        string app = Win.LongPath(Path.Combine(root, "app")) + "\\";
        Version found = null;
        foreach (var p in Win.BrowserProcesses(root))
        {
            try
            {
                string path = Win.LongPath(p.MainModule.FileName);
                if (!path.StartsWith(app, StringComparison.OrdinalIgnoreCase)) continue;
                Version v;
                if (Version.TryParse(path.Substring(app.Length).Split('\\')[0], out v) && (found == null || v < found)) found = v;
            }
            catch { }
        }
        return found;
    }

    static string Read(Stream input)
    {
        var size = new byte[4];
        if (input.Read(size, 0, 4) < 4) return "{}";
        int length = BitConverter.ToInt32(size, 0);
        if (length <= 0 || length > 1024 * 1024) return "{}";
        var data = new byte[length];
        int read = 0;
        while (read < length) { int n = input.Read(data, read, length - read); if (n <= 0) break; read += n; }
        return Encoding.UTF8.GetString(data, 0, read);
    }

    static void Write(Stream output, string message)
    {
        var data = Encoding.UTF8.GetBytes(message);
        output.Write(BitConverter.GetBytes(data.Length), 0, 4);
        output.Write(data, 0, data.Length);
        output.Flush();
    }
}
