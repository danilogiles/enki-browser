// EnkiBrowserLauncher.exe, inside app\<version>\: starts this version's Chromium with the
// profile, the built-in extensions and the privacy switches, then looks for an update.
//
// It exists because a prebuilt Chromium cannot be told any of this by itself: off-store
// extensions can only be force-installed through policy on domain-managed Windows machines, and
// the policy registry key is shared by every Chromium on the computer. Passing everything on the
// command line keeps Enki Browser self-contained.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string root = Path.GetFullPath(Path.Combine(appDir, "..", ".."));
        string chrome = Path.Combine(appDir, "chromium", "chrome.exe");
        if (!File.Exists(chrome))
        {
            MessageBox.Show("Enki Browser is incomplete: " + chrome + " is missing. Reinstall it.",
                "Enki Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        // Check, verify and stage now, without opening a window (used by tests and scripts).
        if (args.Contains("--enki-update-check"))
        {
            if (!Updater.Disabled(root)) Updater.CheckAndStage(root, appDir, true);
            return 0;
        }

        // From the update notification's twin on the command line: restart into the installed update.
        if (args.Contains("--enki-restart-to-update"))
        {
            Watcher.RequestRestart(root);
            return 0;
        }

        var flags = new List<string>();

        // A file named "portable" next to EnkiBrowser.exe keeps the profile beside the program (a
        // USB stick, a synced folder). Chromium ties the profile to this machine with a machine id,
        // which portable mode turns off; its encryption of passwords and cookies stays on.
        bool portable = File.Exists(Path.Combine(root, "portable"));
        string userData = Environment.GetEnvironmentVariable("ENKI_BROWSER_USER_DATA");
        if (string.IsNullOrEmpty(userData))
            userData = portable ? Path.Combine(root, "User Data") : Path.Combine(Install.DataDir, "User Data");
        flags.Add("--user-data-dir=" + userData);
        Migration.Run(userData, root, appDir);
        ShellIdentity.RepairShortcuts(root);
        if (portable)
        {
            // Saved passwords and cookies stay encrypted (Chromium's key, protected by Windows for
            // this user) even here: security first. The price is that logins do not travel with a
            // portable profile to another computer; the rest of the profile does.
            flags.Add("--disable-machine-id");
        }

        // Every folder under extensions/ is built in: Enki, the blocker, Enki Shield, the theme.
        string extDir = Path.Combine(appDir, "extensions");
        if (Directory.Exists(extDir))
            flags.Add("--load-extension=" + string.Join(",", Directory.GetDirectories(extDir).OrderBy(d => d)));

        string flagFile = Path.Combine(appDir, "config", "flags.txt");
        if (File.Exists(flagFile))
            flags.AddRange(File.ReadAllLines(flagFile).Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith("#")));

        // Whatever Windows or the user passed (a URL, a file to open) goes last, unchanged.
        flags.AddRange(args.Where(a => !a.StartsWith("--enki-")));

        Process.Start(new ProcessStartInfo(chrome, Win.JoinArgs(flags))
        {
            UseShellExecute = false,
            WorkingDirectory = Path.Combine(appDir, "chromium"),
        });

        // With the browser already up, stay behind (no window) while it is open: to tidy up when it
        // closes (shortcuts, old versions) and, unless updates are off, to keep it up to date, so a
        // slow download never delays anything the user sees. See Watcher.cs.
        Watcher.Run(root, appDir, userData, args.Where(a => a.StartsWith("--") && !a.StartsWith("--enki-")),
            Environment.GetEnvironmentVariable("ENKI_BROWSER_UPDATE_NOW") == "1");
        return 0;
    }
}
