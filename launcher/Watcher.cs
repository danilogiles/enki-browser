// Keeps Enki Browser up to date while it is open, the way other browsers do.
//
// The launcher that started the browser stays behind without a window (one per install; later
// launches only open windows). It looks for a release at start and then every few hours; the
// updater installs it beside the running version. When one is ready, a notification offers to
// restart now — tabs and windows come back — and otherwise the next start opens it anyway.
// Nothing restarts on its own: a half-written form is the user's to lose, not ours.
//
// Restarting. Closing windows one by one would leave only the last one in the saved session, and
// chrome://quit is not accepted from the command line. WM_ENDSESSION, the message Windows sends
// at log-off, makes Chromium save every window and exit; --restore-last-session brings them back.
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
    public static void Run(string root, string appDir, IEnumerable<string> switches, bool forceFirst)
    {
        bool owner;
        using (var mutex = new Mutex(true, "EnkiBrowserWatcher-" + Id(root), out owner))
        {
            if (!owner)
            {
                // Another window's launcher is already watching; just make sure this start checked.
                Updater.CheckAndStage(root, appDir, forceFirst);
                return;
            }
            bool restart;
            using (var signal = new EventWaitHandle(false, EventResetMode.AutoReset, "EnkiBrowserRestart-" + Id(root)))
            using (var watch = new Watch(root, appDir, signal, forceFirst))
            {
                Application.Run(watch);
                restart = watch.Restart;
            }
            mutex.ReleaseMutex();
            // Started after the mutex is released, so the new version's launcher can watch in turn.
            if (restart) Relaunch(root, switches);
            // The browser has closed (or restarted into another version): nothing old is in use.
            else { Updater.RemoveOldVersions(root, appDir); Updater.RefreshStub(root, appDir); }
        }
    }

    class Watch : ApplicationContext
    {
        readonly string root, appDir;
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

        public Watch(string root, string appDir, EventWaitHandle signal, bool forceFirst)
        {
            this.root = root; this.appDir = appDir; this.signal = signal; forceNext = forceFirst;
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
            if (ready == null && DateTime.UtcNow >= nextCheck && Interlocked.CompareExchange(ref checking, 1, 0) == 0)
            {
                nextCheck = DateTime.UtcNow + CheckEvery;
                bool force = forceNext; forceNext = false;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        Updater.CheckAndStage(root, appDir, force);
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

    static void Relaunch(string root, IEnumerable<string> switches)
    {
        var args = switches.Where(a => a != "--restore-last-session").ToList();
        args.Add("--restore-last-session");
        Process.Start(new ProcessStartInfo(Path.Combine(root, "EnkiBrowser.exe"), Win.JoinArgs(args)) { UseShellExecute = false, WorkingDirectory = root });
    }

    // ---- WM_ENDSESSION to one of the browser's windows

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    const uint WM_ENDSESSION = 0x16;

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
        if (target != IntPtr.Zero) PostMessage(target, WM_ENDSESSION, new IntPtr(1), IntPtr.Zero);
    }
}
