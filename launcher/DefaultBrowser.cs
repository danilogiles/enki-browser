// Enki Browser as a browser Windows knows: listed in Settings → Default apps and in "Open with",
// with Enki's icon, opening links and files through the stub. Per user (HKCU) only, never
// administrator rights, never Software\Policies.
//
// Windows 10 and 11 do not let a program make itself the default: the choice (UserChoice) is
// hash-protected and, on Windows 11, guarded by a driver. What a program can do is register its
// capabilities and open the Settings page where the user picks it. Chromium does the same.
//
// Everything points at the stub, <root>\EnkiBrowser.exe, which updates never move or rename, and
// every command is exactly "<stub>" --single-argument %1 (Args.cs: the URL reaches Chromium as one
// literal argument, never as switches). Written by the installer and, for installs from before
// 0.8.6, by the launcher at start (Install.SyncRegistration); removed by the uninstaller. Portable
// copies get none of it.
//
// Chromium's own "Make default" button (chrome://settings/defaultBrowser) and its PDF prompt register
// a "Chromium" browser that points at app\<version>\chromium\chrome.exe: links opened that way ran
// without the launcher (no Enki, no Shields, another profile), and once that version folder was
// cleaned up after an update, Windows showed the entry with a blank icon. Repair() points such
// entries of this install back at the stub, with its icon, at every start.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.Win32;

static class DefaultBrowser
{
    /// The name under RegisteredApplications, which ms-settings:defaultapps?registeredAppUser= takes.
    public const string Name = "EnkiBrowser";
    public const string ClientKey = @"Software\Clients\StartMenuInternet\" + Name;
    public const string CapabilitiesKey = ClientKey + @"\Capabilities";
    public const string RegisteredApplicationsKey = @"Software\RegisteredApplications";
    public const string ClassesKey = @"Software\Classes";
    public const string HtmlProgId = "EnkiHTML", UrlProgId = "EnkiURL", PdfProgId = "EnkiPDF";
    public static readonly string[] Schemes = { "http", "https" };
    public static readonly string[] HtmlFiles = { ".htm", ".html", ".shtml", ".xhtml", ".svg", ".webp" };
    public const string PdfFile = ".pdf";
    /// File types Chromium's own registration may have claimed (shell_util.h kPotentialFileAssociations, and .pdf).
    static readonly string[] ChromiumFiles = { ".htm", ".html", ".mhtml", ".shtml", ".svg", ".xht", ".xhtml", ".webp", ".pdf" };

    public sealed class Entry
    {
        public string Key, Name;
        public object Value;
        public RegistryValueKind Kind;
        public Entry(string key, string name, object value) : this(key, name, value, RegistryValueKind.String) { }
        public Entry(string key, string name, object value, RegistryValueKind kind) { Key = key; Name = name; Value = value; Kind = kind; }
    }

    public static string Stub(string root) { return root.TrimEnd('\\') + @"\EnkiBrowser.exe"; }

    /// The one command every entry opens: the stub, then the URL or path as a single literal argument.
    public static string Command(string root) { return "\"" + Stub(root) + "\" --single-argument %1"; }

    /// The stub's own icon, the Enki shield (built from enki.ico).
    public static string Icon(string root) { return "\"" + Stub(root) + "\",0"; }

    /// Every value Enki Browser's registration writes, relative to HKCU.
    public static List<Entry> Entries(string root)
    {
        string command = Command(root), icon = Icon(root);
        string description = Win.T("Navegador privado com assistente de IA", "Navegador privado con asistente de IA", "Private browser with an AI assistant");
        var e = new List<Entry>
        {
            new Entry(ClientKey, "", "Enki Browser"),
            new Entry(ClientKey + @"\DefaultIcon", "", icon),
            new Entry(ClientKey + @"\shell\open\command", "", command),
            new Entry(CapabilitiesKey, "ApplicationName", "Enki Browser"),
            new Entry(CapabilitiesKey, "ApplicationDescription", description),
            new Entry(CapabilitiesKey, "ApplicationIcon", icon),
            new Entry(CapabilitiesKey + @"\StartMenu", "StartMenuInternet", Name),
            new Entry(RegisteredApplicationsKey, Name, CapabilitiesKey),
        };
        foreach (string scheme in Schemes) e.Add(new Entry(CapabilitiesKey + @"\URLAssociations", scheme, UrlProgId));
        foreach (string ext in HtmlFiles) e.Add(new Entry(CapabilitiesKey + @"\FileAssociations", ext, HtmlProgId));
        e.Add(new Entry(CapabilitiesKey + @"\FileAssociations", PdfFile, PdfProgId));

        foreach (var progId in new[]
        {
            new[] { HtmlProgId, "Enki Browser HTML Document" },
            new[] { UrlProgId, "Enki Browser URL" },
            new[] { PdfProgId, "Enki Browser PDF Document" },
        })
        {
            string key = ClassesKey + @"\" + progId[0];
            e.Add(new Entry(key, "", progId[1]));
            e.Add(new Entry(key + @"\DefaultIcon", "", icon));
            e.Add(new Entry(key + @"\shell\open\command", "", command));
            e.Add(new Entry(key + @"\Application", "ApplicationName", "Enki Browser"));
            e.Add(new Entry(key + @"\Application", "ApplicationIcon", icon));
            e.Add(new Entry(key + @"\Application", "ApplicationCompany", "Danilo De Souza"));
            if (progId[0] == UrlProgId)
            {
                e.Add(new Entry(key, "URL Protocol", ""));
                e.Add(new Entry(key, "EditFlags", 2, RegistryValueKind.DWord));
            }
        }
        // "Open with" lists Enki Browser for these files even before anyone makes it the default.
        foreach (string ext in HtmlFiles) e.Add(new Entry(ClassesKey + @"\" + ext + @"\OpenWithProgids", HtmlProgId, ""));
        e.Add(new Entry(ClassesKey + @"\" + PdfFile + @"\OpenWithProgids", PdfProgId, ""));
        return e;
    }

    /// Writes the registration under `hive` (HKCU, or a test key standing in for it). Only values
    /// that differ are written, so a start with everything in place only reads. True if anything changed.
    public static bool Register(RegistryKey hive, string root)
    {
        bool changed = false;
        foreach (var entry in Entries(root)) changed |= Set(hive, entry.Key, entry.Name, entry.Value, entry.Kind);
        return changed;
    }

    static bool Set(RegistryKey hive, string keyPath, string name, object value, RegistryValueKind kind)
    {
        using (var key = hive.CreateSubKey(keyPath))
        {
            object current = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            if (current != null && Equals(current, value) && key.GetValueKind(name) == kind) return false;
            key.SetValue(name, value, kind);
            return true;
        }
    }

    static string Read(RegistryKey hive, string keyPath, string name)
    {
        using (var key = hive.OpenSubKey(keyPath))
            return key == null ? null : key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
    }

    /// Whether Windows has Enki Browser of this install registered as a browser.
    public static bool IsRegistered(RegistryKey hive, string root)
    {
        return string.Equals(Read(hive, ClientKey + @"\shell\open\command", ""), Command(root), StringComparison.OrdinalIgnoreCase)
            && Read(hive, RegisteredApplicationsKey, Name) != null;
    }

    /// Whether the user's choice for https links is Enki Browser. A local registry read; nothing is
    /// sent anywhere. Newer Windows 11 builds keep the choice in UserChoiceLatest.
    public static bool IsDefault(RegistryKey hive)
    {
        const string https = @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\";
        string progId = Read(hive, https + @"UserChoiceLatest\ProgId", "ProgId")
            ?? Read(hive, https + "UserChoiceLatest", "ProgId")
            ?? Read(hive, https + "UserChoice", "ProgId");
        return string.Equals(progId, UrlProgId, StringComparison.OrdinalIgnoreCase);
    }

    /// The executable a command or icon location names: a quoted first token, or everything up to ".exe".
    public static string PathIn(string value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        string v = value.Trim();
        if (v.StartsWith("\""))
        {
            int close = v.IndexOf('"', 1);
            return close > 1 ? v.Substring(1, close - 1) : null;
        }
        int exe = v.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exe > 0) return v.Substring(0, exe + 4);
        int comma = v.LastIndexOf(',');
        return comma > 0 ? v.Substring(0, comma) : v;
    }

    /// Whether a command or icon location names a file inside this install (the stub, or any
    /// version's chrome.exe, existing or already cleaned up).
    public static bool PointsInto(string value, string root)
    {
        string path = PathIn(value);
        if (string.IsNullOrEmpty(path)) return false;
        try
        {
            string file = Win.LongPath(path).Replace('/', '\\'), folder = Win.LongPath(root).Replace('/', '\\').TrimEnd('\\');
            return file.StartsWith(folder + "\\", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// Keys other programs (Chromium's own registration, Windows' "Open with") may have made for
    /// this install, relative to HKCU. Only those whose command or icon points into the install are touched.
    static List<string> ForeignKeys(RegistryKey hive)
    {
        var keys = new List<string>();
        using (var classes = hive.OpenSubKey(ClassesKey))
        {
            if (classes != null)
                foreach (string name in classes.GetSubKeyNames())
                    if (name.StartsWith("ChromiumHTM", StringComparison.OrdinalIgnoreCase) || name.StartsWith("ChromiumPDF", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(name, "chromium", StringComparison.OrdinalIgnoreCase))
                        keys.Add(ClassesKey + @"\" + name);
        }
        keys.Add(ClassesKey + @"\Applications\chrome.exe");
        keys.Add(ClassesKey + @"\Applications\EnkiBrowser.exe");
        using (var clients = hive.OpenSubKey(@"Software\Clients\StartMenuInternet"))
        {
            if (clients != null)
                foreach (string name in clients.GetSubKeyNames())
                    if (name.StartsWith("Chromium", StringComparison.OrdinalIgnoreCase)) keys.Add(@"Software\Clients\StartMenuInternet\" + name);
        }
        return keys;
    }

    /// Points other programs' entries for this install at the stub, with its icon: commands become
    /// Command(root), icons Icon(root). A choice the user already made for one of them (UserChoice
    /// names its ProgID, which cannot be changed from here) keeps working, now through the launcher.
    /// True if anything changed.
    public static bool Repair(RegistryKey hive, string root)
    {
        bool changed = false;
        foreach (string key in ForeignKeys(hive))
        {
            using (var probe = hive.OpenSubKey(key))
                if (probe == null) continue;
            string command = Read(hive, key + @"\shell\open\command", "");
            bool ours = PointsInto(command, root);
            if (ours && command != Command(root)) changed |= Set(hive, key + @"\shell\open\command", "", Command(root), RegistryValueKind.String);
            foreach (var icon in new[] { new[] { @"\DefaultIcon", "" }, new[] { @"\Capabilities", "ApplicationIcon" }, new[] { @"\Application", "ApplicationIcon" } })
            {
                string value = Read(hive, key + icon[0], icon[1]);
                if (value != null && PointsInto(value, root) && value != Icon(root)) changed |= Set(hive, key + icon[0], icon[1], Icon(root), RegistryValueKind.String);
            }
            // Windows' own "Open with" entry for the stub has no icon of its own; give it the shield.
            if (ours && key.EndsWith(@"\Applications\EnkiBrowser.exe", StringComparison.OrdinalIgnoreCase))
            {
                if (Read(hive, key + @"\DefaultIcon", "") == null) changed |= Set(hive, key + @"\DefaultIcon", "", Icon(root), RegistryValueKind.String);
                changed |= Set(hive, key, "FriendlyAppName", "Enki Browser", RegistryValueKind.String);
            }
        }
        return changed;
    }

    /// Removes Enki Browser's registration and every other entry that opens this install (which
    /// would open nothing once it is gone). Entries of another install are left alone.
    public static void Unregister(RegistryKey hive, string root)
    {
        var removedProgIds = new List<string>();
        string ownCommand = Read(hive, ClientKey + @"\shell\open\command", "");
        if (ownCommand == null || PointsInto(ownCommand, root))
        {
            DeleteTree(hive, ClientKey);
            DeleteValue(hive, RegisteredApplicationsKey, Name);
        }
        foreach (string progId in new[] { HtmlProgId, UrlProgId, PdfProgId })
        {
            string key = ClassesKey + @"\" + progId;
            string command = Read(hive, key + @"\shell\open\command", "");
            if (command == null || PointsInto(command, root)) { DeleteTree(hive, key); removedProgIds.Add(progId); }
        }
        foreach (string key in ForeignKeys(hive))
        {
            string command = Read(hive, key + @"\shell\open\command", "");
            if (command == null || !PointsInto(command, root)) continue;
            DeleteTree(hive, key);
            removedProgIds.Add(key.Substring(key.LastIndexOf('\\') + 1));
        }
        // Chromium's RegisteredApplications values whose StartMenuInternet key is now gone.
        using (var apps = hive.OpenSubKey(RegisteredApplicationsKey, true))
        {
            if (apps != null)
                foreach (string name in apps.GetValueNames())
                {
                    string target = apps.GetValue(name) as string;
                    if (!name.StartsWith("Chromium", StringComparison.OrdinalIgnoreCase) || target == null) continue;
                    using (var t = hive.OpenSubKey(target)) if (t == null) apps.DeleteValue(name, false);
                }
        }
        foreach (string ext in ChromiumFiles)
        {
            using (var open = hive.OpenSubKey(ClassesKey + @"\" + ext + @"\OpenWithProgids", true))
                if (open != null)
                    foreach (string value in open.GetValueNames())
                        if (removedProgIds.Contains(value, StringComparer.OrdinalIgnoreCase)) open.DeleteValue(value, false);
        }
    }

    static void DeleteTree(RegistryKey hive, string key) { try { hive.DeleteSubKeyTree(key, false); } catch { } }

    static void DeleteValue(RegistryKey hive, string key, string name)
    {
        using (var k = hive.OpenSubKey(key, true)) if (k != null) k.DeleteValue(name, false);
    }

    [DllImport("shell32.dll")]
    static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    /// Tells Explorer and Settings that associations changed, so lists and icons refresh.
    public static void NotifyShell()
    {
        try { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); } catch { } // SHCNE_ASSOCCHANGED, SHCNF_IDLIST
    }

    /// The Settings page where the user makes Enki Browser the default: on Windows 11 Enki
    /// Browser's own page in Default apps; on Windows 10 Default apps, where "Web browser" is.
    public static string SettingsUri(int windowsBuild)
    {
        return windowsBuild >= 22000 ? "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(Name) : "ms-settings:defaultapps";
    }

    /// Windows' build number (22000 and up is Windows 11). Read from the registry because
    /// Environment.OSVersion reports Windows 8 to programs without a compatibility manifest.
    public static int WindowsBuild()
    {
        try
        {
            using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
            {
                int build;
                return key != null && int.TryParse(key.GetValue("CurrentBuildNumber") as string, out build) ? build : 0;
            }
        }
        catch { return 0; }
    }

    /// Opens that Settings page. Nothing is changed by this call; the user chooses there.
    public static bool OpenSettings()
    {
        int build = WindowsBuild();
        foreach (string uri in new[] { SettingsUri(build), SettingsUri(0) }.Distinct())
        {
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); return true; }
            catch { }
        }
        return false;
    }
}
