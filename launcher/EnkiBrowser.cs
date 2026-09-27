// Enki Browser launcher.
//
// Starts the bundled Chromium with its own profile, the built-in extensions and the privacy
// switches from config/flags.txt. It exists because a prebuilt Chromium cannot be told any of
// this by itself: off-store extensions can only be force-installed through policy on
// domain-managed Windows machines, and the policy registry key is shared by every Chromium on
// the computer. Passing everything on the command line keeps Enki Browser self-contained.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

static class EnkiBrowser
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string chrome = Path.Combine(root, "chromium", "chrome.exe");
        if (!File.Exists(chrome))
        {
            MessageBox.Show("Enki Browser is incomplete: " + chrome + " is missing. Reinstall it.",
                "Enki Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        // Updater entry points that never open a window: check, verify and stage now.
        if (args.Contains("--enki-update-check"))
        {
            if (!Updater.Disabled(root)) Updater.CheckAndStage(root, true);
            return 0;
        }
        // A release downloaded last time installs before the browser starts, while nothing
        // holds its files. The new launcher then takes over, so new launch logic applies at once.
        if (!Updater.Disabled(root) && Updater.ApplyStaged(root))
        {
            Process.Start(new ProcessStartInfo(Path.Combine(root, "EnkiBrowser.exe"), string.Join(" ", args.Select(Quote))) { UseShellExecute = false });
            return 0;
        }

        var flags = new List<string>();

        // A file named "portable" next to the launcher keeps the profile beside the program
        // (a USB stick, a synced folder). Chromium otherwise ties profile encryption to this
        // machine, so a portable profile has to opt out of that.
        bool portable = File.Exists(Path.Combine(root, "portable"));
        string userData = Environment.GetEnvironmentVariable("ENKI_BROWSER_USER_DATA");
        if (string.IsNullOrEmpty(userData))
        {
            userData = portable
                ? Path.Combine(root, "User Data")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EnkiBrowser", "User Data");
        }
        flags.Add("--user-data-dir=" + userData);
        if (portable)
        {
            flags.Add("--disable-encryption");
            flags.Add("--disable-machine-id");
        }

        string extensions = string.Join(",", new[] { "enki", "ublock-lite" }
            .Select(name => Path.Combine(root, "extensions", name))
            .Where(Directory.Exists));
        if (extensions.Length > 0) flags.Add("--load-extension=" + extensions);

        string flagFile = Path.Combine(root, "config", "flags.txt");
        if (File.Exists(flagFile))
        {
            flags.AddRange(File.ReadAllLines(flagFile)
                .Select(line => line.Trim())
                .Where(line => line.Length > 0 && !line.StartsWith("#")));
        }

        // Whatever Windows or the user passed (a URL, a file to open) goes last, unchanged.
        flags.AddRange(args.Where(a => !a.StartsWith("--enki-")));

        var start = new ProcessStartInfo(chrome, string.Join(" ", flags.Select(Quote)))
        {
            UseShellExecute = false,
            WorkingDirectory = Path.Combine(root, "chromium"),
        };
        Process.Start(start);

        // With the browser already up, look for a newer release. This process has no window,
        // so a slow download never delays anything the user sees.
        if (!Updater.Disabled(root))
            Updater.CheckAndStage(root, Environment.GetEnvironmentVariable("ENKI_BROWSER_UPDATE_NOW") == "1");
        return 0;
    }

    /// Quotes one argument the way CommandLineToArgvW parses it back.
    static string Quote(string arg)
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
}
