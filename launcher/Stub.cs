// EnkiBrowser.exe at the install root: the only program shortcuts point to, and one updates
// never replace. It opens the version named in `current` and tidies old ones. Updating means
// adding app\<version> and rewriting `current`; nothing running is ever renamed or moved.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class Stub
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        if (args.Contains("--uninstall")) return Uninstaller.Start(root, args);
        string from = args.FirstOrDefault(a => a.StartsWith("--uninstall-from="));
        if (from != null) return Uninstaller.Run(from.Substring("--uninstall-from=".Length).Trim('"'), args.Contains("/S"), !args.Contains("/NoIntegration"));

        string version = CurrentVersion(root);
        string launcher = version == null ? null : Path.Combine(root, "app", version, "EnkiBrowserLauncher.exe");
        if (launcher == null || !File.Exists(launcher))
        {
            MessageBox.Show(Win.T(
                "O Enki Browser está incompleto. Instale de novo com o EnkiBrowserSetup, em github.com/danilogiles/enki-browser/releases.",
                "Enki Browser está incompleto. Vuelve a instalarlo con EnkiBrowserSetup, en github.com/danilogiles/enki-browser/releases.",
                "Enki Browser is incomplete. Reinstall it with EnkiBrowserSetup from github.com/danilogiles/enki-browser/releases."),
                "Enki Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Process.Start(new ProcessStartInfo(launcher, Win.JoinArgs(args)) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(launcher) });
        RemoveOldVersions(root, version);
        return 0;
    }

    /// `current` names the version to open. If it is missing or points nowhere, the newest
    /// complete version folder is used, so a half-finished write can never strand the user.
    static string CurrentVersion(string root)
    {
        try
        {
            string v = File.ReadAllText(Path.Combine(root, "current")).Trim();
            if (v.Length > 0 && File.Exists(Path.Combine(root, "app", v, "EnkiBrowserLauncher.exe"))) return v;
        }
        catch { }
        return Versions(root).FirstOrDefault();
    }

    /// Complete version folders, newest first.
    static string[] Versions(string root)
    {
        string app = Path.Combine(root, "app");
        if (!Directory.Exists(app)) return new string[0];
        return Directory.GetDirectories(app)
            .Select(Path.GetFileName)
            .Where(n => { Version _; return Version.TryParse(n, out _) && File.Exists(Path.Combine(app, n, "EnkiBrowserLauncher.exe")); })
            .OrderByDescending(n => new Version(n))
            .ToArray();
    }

    /// Keeps the current version and the newest other one (a way back if an update misbehaves);
    /// deletes older ones and abandoned partial downloads, never one a browser is running from.
    static void RemoveOldVersions(string root, string current)
    {
        try
        {
            string app = Path.Combine(root, "app");
            string previous = Versions(root).FirstOrDefault(v => v != current);
            foreach (string dir in Directory.GetDirectories(app))
            {
                string name = Path.GetFileName(dir);
                if (name == current || name == previous) continue;
                if (Win.BrowserProcesses(dir).Count > 0) continue;
                try { Directory.Delete(dir, true); } catch { /* in use; next time */ }
            }
        }
        catch { }
    }
}

static class Uninstaller
{
    /// A program cannot delete the folder it runs from, so the uninstaller first copies itself to
    /// the temp folder and runs from there — the same approach NSIS-built uninstallers use.
    public static int Start(string root, string[] args)
    {
        string copy = Path.Combine(Path.GetTempPath(), "EnkiBrowser-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
        File.Copy(Path.Combine(root, "EnkiBrowser.exe"), copy);
        string extra = (args.Contains("/S") ? " /S" : "") + (args.Contains("/NoIntegration") ? " /NoIntegration" : "");
        Process.Start(new ProcessStartInfo(copy, "--uninstall-from=" + Win.Quote(root) + extra) { UseShellExecute = false });
        return 0;
    }

    /// integrate=false leaves shortcuts and the Apps entry alone: a test install never made them,
    /// and removing them would remove the real install's.
    public static int Run(string root, bool silent, bool integrate)
    {
        bool removeData = false;
        if (!silent)
        {
            var ok = MessageBox.Show(
                Win.T("Remover o Enki Browser deste computador?", "¿Quitar Enki Browser de este equipo?", "Remove Enki Browser from this computer?"),
                "Enki Browser", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
            if (ok != DialogResult.OK) return 1;
            removeData = MessageBox.Show(
                Win.T("Apagar também seus dados de navegação (histórico, favoritos, configurações do Enki)?\n\nEscolha Não para mantê-los caso reinstale.",
                      "¿Borrar también tus datos de navegación (historial, favoritos, ajustes de Enki)?\n\nElige No para conservarlos si lo reinstalas.",
                      "Also delete your browsing data (history, bookmarks, Enki settings)?\n\nChoose No to keep them in case you reinstall."),
                "Enki Browser", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }
        Win.CloseBrowser(root);
        if (integrate)
        {
            Install.RemoveShortcuts();
            Install.Unregister();
        }
        Win.DeleteTree(root);
        if (removeData) Win.DeleteTree(Install.DataDir);
        if (!silent)
            MessageBox.Show(Win.T("O Enki Browser foi removido.", "Enki Browser se ha quitado.", "Enki Browser has been removed."),
                "Enki Browser", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }
}
