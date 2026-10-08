// Installing and removing Enki Browser. Shared by EnkiBrowserSetup.exe and by the stub's
// --uninstall, so there is one implementation of each and no PowerShell involved.
//
// Layout (0.5+), chosen so that nothing is ever renamed or moved while it runs — the pattern
// that made an antivirus quarantine the 0.2–0.4 self-updater:
//   <root>\EnkiBrowser.exe    stub: opens the current version; replaced only after the browser closes (Updater.RefreshStub)
//   <root>\current            the version to open, e.g. "0.5.0"
//   <root>\app\<version>\     one complete release; updates add a folder beside it
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Microsoft.Win32;

static class Install
{
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\EnkiBrowser";

    public static string DefaultRoot
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "EnkiBrowser"); }
    }

    public static string DataDir
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EnkiBrowser"); }
    }

    public static string ShortcutPath(Environment.SpecialFolder folder)
    {
        return Path.Combine(Environment.GetFolderPath(folder), "Enki Browser.lnk");
    }

    /// Files and folders of the 0.1–0.4 layout, which kept one release loose in the root.
    static readonly string[] Legacy = {
        "chromium", "extensions", "config", ".previous", ".update", "enki.ico", "LICENSE", "THIRD_PARTY.md",
        "version.json", "install.ps1", "uninstall.ps1", "Install Enki Browser.cmd",
    };

    public static void RemoveLegacyLayout(string root)
    {
        if (!Directory.Exists(Path.Combine(root, "chromium"))) return;
        foreach (string name in Legacy) Win.DeleteTree(Path.Combine(root, name));
    }

    /// Extracts a release zip (whose top folder is EnkiBrowser\) into root, refusing any entry
    /// that would land outside it. Reports progress from 0 to 1.
    public static string ExtractRelease(Stream zip, string root, Action<double> progress)
    {
        string full = Path.GetFullPath(root).TrimEnd('\\') + "\\";
        string version = null;
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Read))
        {
            // The release folder first, the stub and `current` last: if anything is refused midway
            // (an antivirus, a full disk), no install is left that looks complete but cannot open.
            var entries = archive.Entries.Where(e => e.FullName.Replace('\\', '/').StartsWith("EnkiBrowser/"))
                .OrderBy(e => e.FullName.Replace('\\', '/').StartsWith("EnkiBrowser/app/") ? 0 : e.FullName.EndsWith("/current") ? 2 : 1)
                .ToList();
            // A reinstall of the same version replaces its folder rather than mixing files into it.
            var appVersion = entries.Select(e => e.FullName.Replace('\\', '/').Split('/')).FirstOrDefault(p => p.Length > 3 && p[1] == "app");
            if (appVersion != null) { version = appVersion[2]; Win.DeleteTree(Path.Combine(root, "app", version)); }
            for (int i = 0; i < entries.Count; i++)
            {
                var entry = entries[i];
                string relative = entry.FullName.Replace('\\', '/').Substring("EnkiBrowser/".Length);
                if (relative.Length == 0) continue;
                string target = Path.GetFullPath(Path.Combine(root, relative));
                if (!target.StartsWith(full, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("zip entry escapes its folder: " + entry.FullName);
                if (relative.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                entry.ExtractToFile(target, true);
                if (i % 50 == 0) progress((double)i / entries.Count);
            }
        }
        progress(1);
        return version;
    }

    public static void CreateShortcuts(string root)
    {
        // WScript.Shell through late binding: no interop assembly to ship.
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        foreach (var folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory })
        {
            dynamic link = shell.CreateShortcut(ShortcutPath(folder));
            link.TargetPath = Path.Combine(root, "EnkiBrowser.exe");
            link.WorkingDirectory = root;
            link.IconLocation = Path.Combine(root, "EnkiBrowser.exe") + ",0";
            link.Description = "Enki Browser";
            link.Save();
        }
    }

    public static void RemoveShortcuts()
    {
        foreach (var folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory })
        {
            try { File.Delete(ShortcutPath(folder)); } catch { }
        }
    }

    public static void Register(string root, string version, long sizeKb)
    {
        string stub = Path.Combine(root, "EnkiBrowser.exe");
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", "Enki Browser");
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", "Danilo De Souza");
            key.SetValue("DisplayIcon", stub + ",0");
            key.SetValue("InstallLocation", root);
            key.SetValue("URLInfoAbout", "https://github.com/danilogiles/enki-browser");
            key.SetValue("UninstallString", Win.Quote(stub) + " --uninstall");
            key.SetValue("QuietUninstallString", Win.Quote(stub) + " --uninstall /S");
            key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeKb), RegistryValueKind.DWord);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    /// Keeps the Apps entry's version and publisher in step with what runs. The updater installs a
    /// release beside the old one without running the installer, so without this Settings → Apps
    /// (and winget, which reads the same entry) would keep showing the version first installed and
    /// an older publisher. Only the entry of this install is touched: a portable copy or a test
    /// install elsewhere (InstallLocation differs, or there is no entry) is left alone.
    public static void SyncRegistration(string root, string version)
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey, true))
            {
                if (key == null) return;
                var location = key.GetValue("InstallLocation") as string;
                if (string.IsNullOrEmpty(location) || !string.Equals(Win.LongPath(location), Win.LongPath(root), StringComparison.OrdinalIgnoreCase)) return;
                if ((key.GetValue("DisplayVersion") as string) != version) key.SetValue("DisplayVersion", version);
                if ((key.GetValue("Publisher") as string) != "Danilo De Souza") key.SetValue("Publisher", "Danilo De Souza");
            }
        }
        catch { /* never stop the browser from starting over the Apps entry */ }
    }

    /// Where Chromium finds the manifest of the "Check for updates" host (NativeHost.cs).
    public const string NativeHostKey = @"Software\Chromium\NativeMessagingHosts\io.github.danilogiles.enki_browser";

    public static void Unregister()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(NativeHostKey, false); } catch { }
    }

    public static long FolderSizeKb(string dir)
    {
        try { return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length) / 1024; }
        catch { return 0; }
    }
}
