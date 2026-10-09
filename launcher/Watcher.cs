// Keeps Enki Browser up to date while it is open, the way other browsers do.
//
// The launcher that started the browser stays behind without a window (one per install; later
// launches only open windows). It looks for a release at start and then every few hours; the
// updater installs it beside the running version. When one is ready, a notification offers to
// restart now — tabs and windows come back — and otherwise the next start opens it anyway.
// Nothing restarts on its own: a half-written form is the user's to lose, not ours.
//
// Restarting. The launcher sends a browser window the menu's Exit command (WM_COMMAND IDC_EXIT),
// which Chromium runs like a click on Exit: every window is saved for the next session, pending
// cookies and storage are written, and a page with unsaved changes can still ask first. Then
// --restore-last-session brings every window back on the new version.
// Rejected on the way: closing windows one by one keeps only the last one in the session;
// chrome://quit is refused from the command line and from extensions; WM_ENDSESSION (the log-off
// message) restored the windows but skipped writing cookies changed in the last half minute, so a
// login made just before "Restart and update" was gone; and a private DevTools pipe works, but
// Chromium closes itself when the pipe drops, so ending the launcher would take the browser down.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Watcher
{
    /// How often the running launcher asks the updater; the updater's own interval decides when
    /// that actually goes to the network.
    static readonly TimeSpan CheckEvery = TimeSpan.FromMinutes(15);

    static string Id(string root)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Win.LongPath(root).ToLowerInvariant()))).Replace("-", "").Substring(0, 16);
    }

    /// `EnkiBrowser.exe --enki-restart-to-update`: asks the running watcher to restart into the
    /// installed update, as clicking its notification does.
    public static void RequestRestart(string root)
    {
        EventWaitHandle signal;
        if (EventWaitHandle.TryOpenExisting("EnkiBrowserRestart-" + Id(root), out signal))
            using (signal) signal.Set();
        else
            Updater.Log(root, "restart requested, but no running Enki Browser is watching for updates");
    }

    /// Runs until the browser started from `appDir` has closed. `switches` are the command-line
    /// switches it was started with, passed again when it restarts.
    public static void Run(string root, string appDir, string userData, IEnumerable<string> switches, bool forceFirst)
    {
        bool owner;
        using (var mutex = new Mutex(true, "EnkiBrowserWatcher-" + Id(root), out owner))
        {
            if (!owner)
            {
                // Another window's launcher is already watching; just make sure this start checked.
                if (!Updater.Disabled(root)) Updater.CheckAndStage(root, appDir, forceFirst);
                return;
            }
            bool restart;
            using (var signal = new EventWaitHandle(false, EventResetMode.AutoReset, "EnkiBrowserRestart-" + Id(root)))
            using (var watch = new Watch(root, appDir, userData, signal, forceFirst))
            {
                Application.Run(watch);
                restart = watch.Restart;
            }
            mutex.ReleaseMutex();
            // Started after the mutex is released, so the new version's launcher can watch in turn.
            if (restart) Relaunch(root, userData, switches);
            // The browser has closed (or restarted into another version): nothing old is in use.
            else { Updater.RemoveOldVersions(root, appDir); Updater.RefreshStub(root, appDir); ShellIdentity.RepairShortcuts(root); }
        }
    }

    class Watch : ApplicationContext
    {
        readonly string root, appDir, userData;
        readonly EventWaitHandle signal;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 2000 };
        readonly Version running;
        DateTime nextCheck = DateTime.MinValue;
        DateTime started = DateTime.UtcNow;
        bool forceNext;
        int checking; // 1 while a check runs on the thread pool
        volatile string ready; // the installed version that is newer than the running one
        NotifyIcon tray;
        public bool Restart;

        readonly bool updatesOff;

        public Watch(string root, string appDir, string userData, EventWaitHandle signal, bool forceFirst)
        {
            updatesOff = Updater.Disabled(root);
            this.root = root; this.appDir = appDir; this.userData = userData; this.signal = signal; forceNext = forceFirst;
            running = Updater.ReadVersion(appDir);
            timer.Tick += delegate { Tick(); };
            timer.Start();
        }

        void Tick()
        {
            if (signal.WaitOne(0)) { RestartNow(); return; }
            // Give Chromium a moment to appear before deciding it has closed.
            if (Win.BrowserProcesses(appDir).Count == 0 && DateTime.UtcNow - started > TimeSpan.FromSeconds(30)) { ExitThread(); return; }

            if (ready != null && tray == null) Offer(ready);
            if (ready == null && !updatesOff && DateTime.UtcNow >= nextCheck && Interlocked.CompareExchange(ref checking, 1, 0) == 0)
            {
                nextCheck = DateTime.UtcNow + CheckEvery;
                bool force = forceNext; forceNext = false;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        Updater.CheckAndStage(root, appDir, force);
                        // The protected-video module, if the user turned it on: about once a day (Widevine.cs).
                        Widevine.UpdateIfDue(root, appDir, userData);
                        string installed = File.ReadAllText(Path.Combine(root, "current")).Trim();
                        Version v;
                        if (Version.TryParse(installed, out v) && v > running
                            && File.Exists(Path.Combine(root, "app", installed, "EnkiBrowserLauncher.exe")))
                            ready = installed;
                    }
                    catch (Exception e) { Updater.Log(root, "watch: " + e.Message); }
                    finally { Interlocked.Exchange(ref checking, 0); }
                });
            }
        }

        /// A tray icon with a notification; it stays until the restart or until the browser closes.
        void Offer(string version)
        {
            try
            {
                var menu = new ContextMenuStrip();
                menu.Items.Add(Win.T("Reiniciar e atualizar agora", "Reiniciar y actualizar ahora", "Restart and update now"), null, delegate { RestartNow(); });
                menu.Items.Add(Win.T("Depois", "Más tarde", "Later"), null, delegate { tray.Visible = false; });
                tray = new NotifyIcon
                {
                    Icon = Icon.ExtractAssociatedIcon(Path.Combine(appDir, "chromium", "chrome.exe")),
                    Text = Win.T("Enki Browser " + version + ": reinicie para atualizar", "Enki Browser " + version + ": reinicia para actualizar", "Enki Browser " + version + ": restart to update"),
                    ContextMenuStrip = menu,
                    Visible = true,
                };
                tray.BalloonTipClicked += delegate { RestartNow(); };
                tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) RestartNow(); };
                tray.ShowBalloonTip(15000,
                    Win.T("Enki Browser " + version + " está pronto", "Enki Browser " + version + " está listo", "Enki Browser " + version + " is ready"),
                    Win.T("Clique para reiniciar e atualizar. Suas abas voltam como estavam; se preferir, ele atualiza na próxima vez que você abrir.",
                          "Haz clic para reiniciar y actualizar. Tus pestañas vuelven como estaban; si prefieres, se actualiza la próxima vez que lo abras.",
                          "Click to restart and update. Your tabs come back as they were; or it updates the next time you open it."),
                    ToolTipIcon.Info);
                Updater.Log(root, version + " is ready; offering to restart");
            }
            catch (Exception e) { Updater.Log(root, "could not show the update notification: " + e.Message); }
        }

        void RestartNow()
        {
            if (Restart) return;
            if (ready == null) { Updater.Log(root, "restart requested, but no update is installed yet"); return; }
            Updater.Log(root, "restarting into " + ready);
            if (tray != null) tray.Visible = false;
            EndSession(appDir);
            for (int i = 0; i < 80 && Win.BrowserProcesses(appDir).Count > 0; i++) Thread.Sleep(250);
            if (Win.BrowserProcesses(appDir).Count > 0)
            {
                // Still open (a "leave page?" prompt, say): leave it to the user; the update waits.
                Updater.Log(root, "the browser did not close; " + ready + " opens the next time it starts");
                if (tray != null) tray.Visible = true;
                return;
            }
            Restart = true;
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Dispose();
                if (tray != null) { tray.Visible = false; tray.Dispose(); }
            }
            base.Dispose(disposing);
        }
    }

    static void Relaunch(string root, string userData, IEnumerable<string> switches)
    {
        var args = switches.Where(a => a != "--restore-last-session").ToList();
        args.Add("--restore-last-session");
        // With more than one profile Chromium opens on its profile picker, and the tabs only came
        // back after the user picked one. Reopen the profile last used, which is the one whose
        // windows were just closed for the update.
        if (!args.Any(a => a.StartsWith("--profile-directory=")))
        {
            string last = LastUsedProfile(userData);
            if (last != null) args.Add("--profile-directory=" + last);
        }
        Process.Start(new ProcessStartInfo(Path.Combine(root, "EnkiBrowser.exe"), Win.JoinArgs(args)) { UseShellExecute = false, WorkingDirectory = root });
    }

    internal static string LastUsedProfile(string userData)
    {
        try
        {
            var state = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = int.MaxValue }
                .DeserializeObject(File.ReadAllText(Path.Combine(userData, "Local State"))) as Dictionary<string, object>;
            var profile = state != null && state.ContainsKey("profile") ? state["profile"] as Dictionary<string, object> : null;
            // The profiles open when the browser closed come first; Chromium writes last_used only
            // for a profile other than Default, so neither may be there, and then it is Default.
            string last = null;
            var active = profile != null && profile.ContainsKey("last_active_profiles") ? profile["last_active_profiles"] as object[] : null;
            if (active != null && active.Length > 0) last = active[0] as string;
            if (string.IsNullOrEmpty(last) && profile != null && profile.ContainsKey("last_used")) last = profile["last_used"] as string;
            if (string.IsNullOrEmpty(last)) last = "Default";
            return last.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 ? last : "Default";
        }
        catch { return "Default"; }
    }

    // ---- the menu's Exit command to one of the browser's windows

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    const uint WM_COMMAND = 0x0111;
    const int IDC_EXIT = 34031; // chrome/app/chrome_command_ids.h

    static void EndSession(string appDir)
    {
        var pids = new HashSet<uint>(Win.BrowserProcesses(appDir).Select(p => (uint)p.Id));
        IntPtr target = IntPtr.Zero;
        EnumWindows((hwnd, l) =>
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            var name = new StringBuilder(64);
            GetClassName(hwnd, name, name.Capacity);
            if (pids.Contains(pid) && IsWindowVisible(hwnd) && name.ToString() == "Chrome_WidgetWin_1") { target = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        if (target != IntPtr.Zero) PostMessage(target, WM_COMMAND, new IntPtr(IDC_EXIT), IntPtr.Zero);
    }
}
