// "Check for updates" inside the browser. Enki Shield's settings page asks; this launcher answers,
// through Chromium's native messaging: Chromium starts the program a registered host manifest
// names, with the calling extension's origin as its first argument, and they exchange JSON over
// stdin and stdout, each message prefixed with its length. Only Enki Shield may call it (the
// manifest's allowed_origins), and all it can ask for is what the tray notification already
// offers (check now, and restart into a downloaded update), plus, since 0.8.5, whether Enki
// Browser is the default browser (a registry read on this computer) and opening the Settings page
// where the user makes it so (DefaultBrowser.cs). Nothing it does goes over the network but the
// update check.
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

    /// One request, one reply (chrome.runtime.sendNativeMessage), then exit.
    public static int Run(string root, string appDir)
    {
        var json = new JavaScriptSerializer();
        Dictionary<string, object> reply;
        try
        {
            var request = json.DeserializeObject(Read(Console.OpenStandardInput())) as Dictionary<string, object>;
            string type = request != null && request.ContainsKey("type") ? request["type"] as string : null;
            if (type == "check") reply = Check(root, appDir);
            else if (type == "default-status") reply = DefaultStatus(root);
            else if (type == "open-default-apps")
            {
                // Only for an install Windows knows as a browser; Settings would not list it otherwise.
                bool registered = DefaultBrowser.IsRegistered(Registry.CurrentUser, root);
                reply = new Dictionary<string, object> { { "opened", registered && DefaultBrowser.OpenSettings() } };
            }
            else if (type == "restart")
            {
                // The running browser's own launcher restarts it, as the tray's "Restart and update" does.
                Watcher.RequestRestart(root);
                reply = new Dictionary<string, object> { { "restarting", true } };
            }
            else reply = Status(root, appDir, null);
        }
        catch (Exception e) { reply = new Dictionary<string, object> { { "error", e.Message } }; }
        Write(Console.OpenStandardOutput(), json.Serialize(reply));
        return 0;
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
