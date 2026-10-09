// Unit tests for the launcher's 0.8.6 pieces: argument passthrough (Args.cs), the browser
// registration (DefaultBrowser.cs) against a throwaway registry key, and the import dialog
// defaults (Migration.cs). Compiled and run by test/launcher-unit.mjs: with the .NET Framework
// csc on Windows, with Mono's mcs elsewhere (Mono keeps a file-backed registry, so the registry
// tests run there too). C# 5, like the launcher.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

/// Stands in for Updater.cs, which Migration logs through.
static class Updater
{
    public static readonly List<string> Logged = new List<string>();
    public static void Log(string root, string message) { Logged.Add(message); }
}

static class LauncherTests
{
    static int passed, failed;

    static void Check(string name, bool ok, string detail = "")
    {
        if (ok) passed++; else failed++;
        Console.WriteLine((ok ? "PASS " : "FAIL ") + name + (detail.Length > 0 ? " — " + detail : ""));
    }

    static int Main()
    {
        ArgsTests();
        RegistryTests();
        MigrationTests();
        Console.WriteLine();
        Console.WriteLine(passed + "/" + (passed + failed) + " checks passed");
        return failed == 0 ? 0 : 1;
    }

    // ------------------------------------------------------------------ the command line

    /// CommandLineToArgvW's rules (the program name: up to the closing quote or the first space;
    /// then 2n backslashes + quote = n backslashes and a quote toggle, 2n+1 = a literal quote).
    static List<string> Argv(string line)
    {
        var argv = new List<string>();
        int i = 0;
        while (i < line.Length && char.IsWhiteSpace(line[i])) i++;
        var sb = new StringBuilder();
        if (i < line.Length && line[i] == '"')
        {
            int close = line.IndexOf('"', i + 1);
            if (close < 0) close = line.Length;
            argv.Add(line.Substring(i + 1, close - i - 1));
            i = close + 1;
        }
        else
        {
            while (i < line.Length && !char.IsWhiteSpace(line[i])) sb.Append(line[i++]);
            argv.Add(sb.ToString());
        }
        while (true)
        {
            while (i < line.Length && char.IsWhiteSpace(line[i])) i++;
            if (i >= line.Length) break;
            sb.Clear();
            bool quoted = false;
            while (i < line.Length && (quoted || !char.IsWhiteSpace(line[i])))
            {
                int n = 0;
                while (i < line.Length && line[i] == '\\') { n++; i++; }
                if (i < line.Length && line[i] == '"')
                {
                    sb.Append('\\', n / 2);
                    if (n % 2 == 1) { sb.Append('"'); i++; }
                    else if (quoted && i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i += 2; }
                    else { quoted = !quoted; i++; }
                }
                else
                {
                    sb.Append('\\', n);
                    if (i < line.Length && (quoted || !char.IsWhiteSpace(line[i]))) sb.Append(line[i++]);
                }
            }
            argv.Add(sb.ToString());
        }
        return argv;
    }

    sealed class ChromeView
    {
        public List<string> Switches = new List<string>(), Arguments = new List<string>();
        public string Single;
    }

    /// What Chromium makes of a command line (base/command_line.cc, Windows): switches in order
    /// until "--single-argument", whose text (from one character past the first occurrence of the
    /// switch after the program) is the one and only argument.
    static ChromeView Chromium(string line)
    {
        var view = new ChromeView();
        var argv = Argv(line);
        bool parseSwitches = true;
        foreach (string a in argv.Skip(1).Select(x => x.Trim()))
        {
            parseSwitches &= a != "--";
            bool isSwitch = parseSwitches && (a.StartsWith("--") || a.StartsWith("-") || a.StartsWith("/")) && a.Length > 1;
            if (isSwitch && a.TrimStart('-', '/').Split('=')[0].ToLowerInvariant() == "single-argument")
            {
                int programStart = line.TakeWhile(c => c == ' ').Count();
                int afterProgram = programStart + argv[0].Length + (line[programStart] == '"' ? 2 : 0);
                int at = line.IndexOf("--single-argument", afterProgram, StringComparison.Ordinal);
                int arg = at + "--single-argument".Length + 1;
                view.Arguments.Clear();
                if (arg < line.Length) view.Single = line.Substring(arg);
                return view;
            }
            if (isSwitch) view.Switches.Add(a); else view.Arguments.Add(a);
        }
        return view;
    }

    /// Windows opening a link: the registered command with %1 replaced by the text as it is.
    static string Opened(string stub, string url) { return "\"" + stub + "\" --single-argument " + url; }

    /// Stub → launcher → chrome.exe, as the three programs build each other's command lines.
    static string ChromeLineFor(string windowsLine, out string[] stubHead, out string[] launcherHead)
    {
        var s = Args.Parse(windowsLine, Argv(windowsLine).Skip(1).ToArray());
        stubHead = s.Head;
        string launcherLine = "\"C:\\Program Files\\Enki Browser\\app\\0.8.6\\EnkiBrowserLauncher.exe\" " + Args.Compose(s.Head, s.Raw);
        var l = Args.Parse(launcherLine, Argv(launcherLine).Skip(1).ToArray());
        launcherHead = l.Head;
        var flags = new List<string>
        {
            "--user-data-dir=C:\\Users\\Ana Maria\\AppData\\Local\\Enki Browser\\User Data",
            "--load-extension=C:\\Program Files\\Enki Browser\\app\\0.8.6\\extensions\\enki,C:\\x\\shield",
            "--no-default-browser-check",
            "--restore-last-session",
        };
        flags.AddRange(l.Head.Where(a => !a.StartsWith("--enki-")));
        return "\"C:\\Program Files\\Enki Browser\\app\\0.8.6\\chromium\\chrome.exe\" " + Args.Compose(flags, l.Raw);
    }

    static void ArgsTests()
    {
        const string stub = @"C:\Users\Ana Maria\AppData\Local\Programs\Enki Browser\EnkiBrowser.exe";
        var hostile = new[]
        {
            "--gpu-launcher=calc",
            "--utility-cmd-prefix=calc",
            "--gpu-launcher=\"calc.exe\" --no-sandbox",
            "\"C:\\Users\\Ana Maria\\My Files\\report one.html\"",
            "\"https://example.test/a b\" --utility-cmd-prefix=calc --renderer-cmd-prefix=\"cmd /c calc\"",
            "https://example.test/?q=a\"b c\\\" --gpu-launcher=calc",
            "x --uninstall /S",
            "--uninstall-from=C:\\Windows /S",
            "-- --gpu-launcher=calc",
            "https://example.test/path with spaces/--single-argument --gpu-launcher=calc",
        };
        foreach (string url in hostile)
        {
            string[] stubHead, launcherHead;
            string chromeLine = ChromeLineFor(Opened(stub, url), out stubHead, out launcherHead);
            var chrome = Chromium(chromeLine);
            bool literal = chrome.Single == url;
            bool noInjected = chrome.Switches.All(sw => !sw.StartsWith("--gpu-launcher") && !sw.StartsWith("--utility-cmd-prefix")
                && !sw.StartsWith("--renderer-cmd-prefix") && !sw.StartsWith("--no-sandbox") && !sw.StartsWith("--uninstall"));
            bool last = chromeLine.EndsWith(" --single-argument " + url, StringComparison.Ordinal);
            Check("link " + url + ": reaches chrome.exe as one literal argument, last, never as switches",
                literal && noInjected && last && chrome.Arguments.Count == 0 && stubHead.Length == 0 && launcherHead.Length == 0,
                "chrome.exe " + chromeLine.Substring(chromeLine.IndexOf("--no-default")) + " | switches: " + string.Join(" ", chrome.Switches));
        }

        {
            var p = Args.Parse(Opened(stub, "x --uninstall /S"), Argv(Opened(stub, "x --uninstall /S")).Skip(1).ToArray());
            Check("the stub never reads --uninstall out of a link", !p.Head.Contains("--uninstall") && p.Raw == "x --uninstall /S");
        }
        {
            string line = "\"C:\\Tools\\--single-argument x\\EnkiBrowser.exe\" --single-argument https://example.test/";
            var p = Args.Parse(line, Argv(line).Skip(1).ToArray());
            Check("a folder named like the switch is not the switch", p.Raw == "https://example.test/", p.Raw ?? "null");
        }
        {
            string line = "\"" + stub + "\" --single-argument %1";
            var p = Args.Parse(line, Argv(line).Skip(1).ToArray());
            Check("the Start menu entry's command run with %1 unreplaced: no argument", p.Raw == null && p.Head.Length == 0 && Args.Compose(p.Head, p.Raw) == "");
        }
        {
            string line = "\"" + stub + "\" --single-argument";
            var p = Args.Parse(line, Argv(line).Skip(1).ToArray());
            Check("--single-argument with nothing after it: no argument", p.Raw == null);
        }
        {
            string line = "\"" + stub + "\" --incognito https://example.test/";
            var p = Args.Parse(line, Argv(line).Skip(1).ToArray());
            Check("without --single-argument the arguments are read as before", p.Raw == null && p.Head.SequenceEqual(new[] { "--incognito", "https://example.test/" }));
        }
        {
            string composed = Args.Compose(new[] { "--user-data-dir=C:\\p\\--single-argument" }, "--gpu-launcher=calc");
            Check("an argument containing the switch text: the link is dropped, never cut in the wrong place", !composed.Contains("calc"), composed);
        }
        {
            var restart = Args.RestartSwitches(new[] { "--incognito", "--single-argument", "--restore-last-session" });
            Check("restart to update drops --single-argument and restores the session once", restart.SequenceEqual(new[] { "--incognito", "--restore-last-session" }), string.Join(" ", restart));
        }
        {
            string line = "\"C:\\Program Files\\Enki Browser\\app\\0.8.6\\chromium\\chrome.exe\" " + Args.Compose(new[] { "--user-data-dir=C:\\a b\\User Data", "--x=\"q\"", "C:\\dir\\" }, null);
            var back = Argv(line).Skip(1).ToList();
            Check("switches with spaces, quotes and trailing backslashes survive quoting", back.SequenceEqual(new[] { "--user-data-dir=C:\\a b\\User Data", "--x=\"q\"", "C:\\dir\\" }), string.Join(" | ", back));
        }
    }

    // ------------------------------------------------------------------ the registry

    static List<string> Walk(RegistryKey key, string path)
    {
        var all = new List<string> { path };
        foreach (string name in key.GetSubKeyNames())
            using (var sub = key.OpenSubKey(name)) all.AddRange(Walk(sub, path.Length == 0 ? name : path + "\\" + name));
        return all;
    }

    static string Value(RegistryKey hive, string key, string name)
    {
        using (var k = hive.OpenSubKey(key)) return k == null ? null : k.GetValue(name) as string;
    }

    static bool Exists(RegistryKey hive, string key)
    {
        using (var k = hive.OpenSubKey(key)) return k != null;
    }

    static void Put(RegistryKey hive, string key, string name, string value)
    {
        using (var k = hive.CreateSubKey(key)) k.SetValue(name, value);
    }

    static void RegistryTests()
    {
        string testKey = @"Software\EnkiTest-" + Guid.NewGuid().ToString("N");
        const string root = @"C:\Users\Ana Maria\AppData\Local\Programs\Enki Browser";
        const string command = "\"" + root + "\\EnkiBrowser.exe\" --single-argument %1";
        const string icon = "\"" + root + "\\EnkiBrowser.exe\",0";
        using (var hive = Registry.CurrentUser.CreateSubKey(testKey))
        {
            try
            {
                Check("the registered command is exactly \"<stub>\" --single-argument %1", DefaultBrowser.Command(root) == command, DefaultBrowser.Command(root));
                bool first = DefaultBrowser.Register(hive, root), second = DefaultBrowser.Register(hive, root);
                Check("registering writes once, then only reads", first && !second);

                var keys = Walk(hive, "").Where(k => k.Length > 0).ToList();
                // Key names compare case-insensitively, as in the registry (Mono's lowercases them).
                Func<string, string, bool> starts = (k, p) => k.StartsWith(p, StringComparison.OrdinalIgnoreCase);
                Func<string, string, bool> same = (k, p) => string.Equals(k, p, StringComparison.OrdinalIgnoreCase);
                var outside = keys.Where(k => !(same(k, "Software") || same(k, @"Software\Classes") || same(k, @"Software\Clients") || same(k, @"Software\Clients\StartMenuInternet")
                    || same(k, @"Software\RegisteredApplications") || starts(k, @"Software\Classes\") || starts(k, @"Software\Clients\StartMenuInternet\EnkiBrowser"))).ToList();
                Check("everything written is under Software\\Classes, StartMenuInternet\\EnkiBrowser and RegisteredApplications", outside.Count == 0, string.Join(", ", outside));

                var commands = keys.Where(k => k.EndsWith(@"\shell\open\command", StringComparison.OrdinalIgnoreCase)).ToList();
                Check("every command (the client, EnkiHTML, EnkiURL, EnkiPDF) is exactly the stub with --single-argument %1",
                    commands.Count == 4 && commands.All(k => Value(hive, k, "") == command), string.Join(", ", commands));
                var icons = keys.Where(k => k.EndsWith(@"\DefaultIcon", StringComparison.OrdinalIgnoreCase)).ToList();
                Check("every DefaultIcon is the stub's icon (\"<stub>\",0)", icons.Count == 4 && icons.All(k => Value(hive, k, "") == icon), string.Join(", ", icons.Select(k => k + "=" + Value(hive, k, ""))));
                Check("Capabilities and each ProgID's ApplicationIcon are the stub's icon",
                    Value(hive, DefaultBrowser.CapabilitiesKey, "ApplicationIcon") == icon
                    && new[] { "EnkiHTML", "EnkiURL", "EnkiPDF" }.All(p => Value(hive, @"Software\Classes\" + p + @"\Application", "ApplicationIcon") == icon));

                string caps = DefaultBrowser.CapabilitiesKey;
                bool urls = Value(hive, caps + @"\URLAssociations", "http") == "EnkiURL" && Value(hive, caps + @"\URLAssociations", "https") == "EnkiURL";
                bool files = new[] { ".htm", ".html", ".shtml", ".xhtml", ".svg", ".webp" }.All(e => Value(hive, caps + @"\FileAssociations", e) == "EnkiHTML")
                    && Value(hive, caps + @"\FileAssociations", ".pdf") == "EnkiPDF";
                using (var fa = hive.OpenSubKey(caps + @"\FileAssociations"))
                    files &= fa.GetValueNames().Length == 7;
                Check("capabilities: http and https, and .htm .html .shtml .xhtml .pdf .svg .webp", urls && files);
                Check("RegisteredApplications names the capabilities", Value(hive, DefaultBrowser.RegisteredApplicationsKey, "EnkiBrowser") == @"Software\Clients\StartMenuInternet\EnkiBrowser\Capabilities");
                Check("StartMenuInternet\\EnkiBrowser is named Enki Browser", Value(hive, DefaultBrowser.ClientKey, "") == "Enki Browser" && Value(hive, caps, "ApplicationName") == "Enki Browser");
                Check("EnkiURL is a URL protocol class", Value(hive, @"Software\Classes\EnkiURL", "URL Protocol") == "");
                Check("\"Open with\" lists Enki Browser for web pages and PDFs",
                    Value(hive, @"Software\Classes\.html\OpenWithProgids", "EnkiHTML") == "" && Value(hive, @"Software\Classes\.pdf\OpenWithProgids", "EnkiPDF") == "");
                Check("registered for this install, not another", DefaultBrowser.IsRegistered(hive, root) && !DefaultBrowser.IsRegistered(hive, @"D:\Portable\Enki"));

                const string assoc = @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\";
                bool before = DefaultBrowser.IsDefault(hive);
                Put(hive, assoc + "UserChoice", "ProgId", "ChromeHTML");
                bool chrome = DefaultBrowser.IsDefault(hive);
                Put(hive, assoc + "UserChoice", "ProgId", "EnkiURL");
                bool enki = DefaultBrowser.IsDefault(hive);
                Put(hive, assoc + @"UserChoiceLatest\ProgId", "ProgId", "MSEdgeHTM");
                bool latest = DefaultBrowser.IsDefault(hive);
                Check("the default check reads UserChoice and Windows 11's UserChoiceLatest", !before && !chrome && enki && !latest);
                hive.DeleteSubKeyTree(@"Software\Microsoft", false);

                // Chromium's own "Make default" registration for an old version of this install, Windows'
                // "Open with" entries, another portable copy's and Google Chrome's.
                string oldChrome = root + @"\app\0.8.1\chromium\chrome.exe";
                Put(hive, @"Software\Classes\ChromiumHTM.ABC\DefaultIcon", "", oldChrome + ",0");
                Put(hive, @"Software\Classes\ChromiumHTM.ABC\shell\open\command", "", "\"" + oldChrome + "\" --single-argument %1");
                Put(hive, @"Software\Classes\ChromiumHTM.ABC\Application", "ApplicationIcon", oldChrome + ",0");
                Put(hive, @"Software\Classes\ChromiumPDF.ABC\DefaultIcon", "", oldChrome + ",5");
                Put(hive, @"Software\Classes\ChromiumPDF.ABC\shell\open\command", "", "\"" + oldChrome + "\" --single-argument %1");
                Put(hive, @"Software\Classes\chromium\shell\open\command", "", "\"" + oldChrome + "\" --single-argument %1");
                Put(hive, @"Software\Clients\StartMenuInternet\Chromium.ABC\DefaultIcon", "", oldChrome + ",0");
                Put(hive, @"Software\Clients\StartMenuInternet\Chromium.ABC\shell\open\command", "", "\"" + oldChrome + "\"");
                Put(hive, @"Software\Clients\StartMenuInternet\Chromium.ABC\Capabilities", "ApplicationIcon", oldChrome + ",0");
                Put(hive, @"Software\RegisteredApplications", "Chromium.ABC", @"Software\Clients\StartMenuInternet\Chromium.ABC\Capabilities");
                Put(hive, @"Software\Classes\Applications\chrome.exe\shell\open\command", "", "\"" + oldChrome + "\" \"%1\"");
                Put(hive, @"Software\Classes\Applications\EnkiBrowser.exe\shell\open\command", "", "\"" + root + "\\EnkiBrowser.exe\" \"%1\"");
                Put(hive, @"Software\Classes\.html\OpenWithProgids", "ChromiumHTM.ABC", "");
                Put(hive, @"Software\Classes\.html\OpenWithProgids", "ChromeHTML", "");
                const string other = @"D:\Portable\Enki\app\0.8.1\chromium\chrome.exe";
                Put(hive, @"Software\Classes\ChromiumHTM.OTHER\DefaultIcon", "", other + ",0");
                Put(hive, @"Software\Classes\ChromiumHTM.OTHER\shell\open\command", "", "\"" + other + "\" --single-argument %1");
                Put(hive, @"Software\Clients\StartMenuInternet\Chromium.OTHER\shell\open\command", "", "\"" + other + "\"");
                Put(hive, @"Software\Clients\StartMenuInternet\Chromium.OTHER\Capabilities", "ApplicationName", "Chromium");
                Put(hive, @"Software\RegisteredApplications", "Chromium.OTHER", @"Software\Clients\StartMenuInternet\Chromium.OTHER\Capabilities");
                Put(hive, @"Software\Classes\ChromeHTML\shell\open\command", "", "\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1");

                bool repaired = DefaultBrowser.Repair(hive, root), again = DefaultBrowser.Repair(hive, root);
                var ours = new[] { @"Software\Classes\ChromiumHTM.ABC", @"Software\Classes\ChromiumPDF.ABC", @"Software\Classes\chromium",
                    @"Software\Clients\StartMenuInternet\Chromium.ABC", @"Software\Classes\Applications\chrome.exe", @"Software\Classes\Applications\EnkiBrowser.exe" };
                Check("repair: Chromium's and Windows' entries for this install open the stub with --single-argument %1",
                    repaired && !again && ours.All(k => Value(hive, k + @"\shell\open\command", "") == command),
                    string.Join(", ", ours.Select(k => Value(hive, k + @"\shell\open\command", ""))));
                Check("repair: their icons are the stub's (no more chrome.exe from a deleted version)",
                    Value(hive, @"Software\Classes\ChromiumHTM.ABC\DefaultIcon", "") == icon && Value(hive, @"Software\Classes\ChromiumPDF.ABC\DefaultIcon", "") == icon
                    && Value(hive, @"Software\Classes\ChromiumHTM.ABC\Application", "ApplicationIcon") == icon
                    && Value(hive, @"Software\Clients\StartMenuInternet\Chromium.ABC\DefaultIcon", "") == icon
                    && Value(hive, @"Software\Clients\StartMenuInternet\Chromium.ABC\Capabilities", "ApplicationIcon") == icon
                    && Value(hive, @"Software\Classes\Applications\EnkiBrowser.exe\DefaultIcon", "") == icon
                    && Value(hive, @"Software\Classes\Applications\EnkiBrowser.exe", "FriendlyAppName") == "Enki Browser");
                Check("repair: another copy's and Google Chrome's entries are untouched",
                    Value(hive, @"Software\Classes\ChromiumHTM.OTHER\DefaultIcon", "") == other + ",0"
                    && Value(hive, @"Software\Classes\ChromiumHTM.OTHER\shell\open\command", "") == "\"" + other + "\" --single-argument %1"
                    && Value(hive, @"Software\Classes\ChromeHTML\shell\open\command", "").Contains(@"Google\Chrome"));

                DefaultBrowser.Unregister(hive, @"D:\Elsewhere");
                Check("uninstalling another copy leaves this one registered", DefaultBrowser.IsRegistered(hive, root) && Exists(hive, @"Software\Classes\ChromiumHTM.ABC"));

                DefaultBrowser.Unregister(hive, root);
                var gone = new[] { DefaultBrowser.ClientKey, @"Software\Classes\EnkiHTML", @"Software\Classes\EnkiURL", @"Software\Classes\EnkiPDF" }.Concat(ours).ToList();
                Check("uninstall removes the registration and every entry that opened this install", gone.All(k => !Exists(hive, k)), string.Join(", ", gone.Where(k => Exists(hive, k))));
                Check("uninstall removes the RegisteredApplications values and \"Open with\" entries",
                    Value(hive, DefaultBrowser.RegisteredApplicationsKey, "EnkiBrowser") == null && Value(hive, DefaultBrowser.RegisteredApplicationsKey, "Chromium.ABC") == null
                    && Value(hive, @"Software\Classes\.html\OpenWithProgids", "EnkiHTML") == null && Value(hive, @"Software\Classes\.html\OpenWithProgids", "ChromiumHTM.ABC") == null
                    && Value(hive, @"Software\Classes\.pdf\OpenWithProgids", "EnkiPDF") == null,
                    string.Join(", ", new[] { Value(hive, DefaultBrowser.RegisteredApplicationsKey, "EnkiBrowser"), Value(hive, DefaultBrowser.RegisteredApplicationsKey, "Chromium.ABC"),
                        Value(hive, @"Software\Classes\.html\OpenWithProgids", "EnkiHTML"), Value(hive, @"Software\Classes\.html\OpenWithProgids", "ChromiumHTM.ABC"),
                        Value(hive, @"Software\Classes\.pdf\OpenWithProgids", "EnkiPDF") }.Select(v => v ?? "-")));
                Check("uninstall keeps another copy's and Google Chrome's entries",
                    Exists(hive, @"Software\Classes\ChromiumHTM.OTHER") && Exists(hive, @"Software\Clients\StartMenuInternet\Chromium.OTHER")
                    && Value(hive, DefaultBrowser.RegisteredApplicationsKey, "Chromium.OTHER") != null && Exists(hive, @"Software\Classes\ChromeHTML")
                    && Value(hive, @"Software\Classes\.html\OpenWithProgids", "ChromeHTML") == "");
            }
            finally
            {
                Registry.CurrentUser.DeleteSubKeyTree(testKey, false);
            }
        }
        Check("Settings: Enki Browser's own page on Windows 11, Default apps on Windows 10",
            DefaultBrowser.SettingsUri(22631) == "ms-settings:defaultapps?registeredAppUser=EnkiBrowser" && DefaultBrowser.SettingsUri(19045) == "ms-settings:defaultapps",
            DefaultBrowser.SettingsUri(22631));
    }

    // ------------------------------------------------------------------ the import dialog

    static void MigrationTests()
    {
        var json = new JavaScriptSerializer();
        var fresh = new Dictionary<string, object>();
        bool changed = Migration.ImportDefaults(fresh);
        Check("import dialog: saved passwords and autofill start unticked",
            changed && false.Equals(fresh["import_dialog_saved_passwords"]) && false.Equals(fresh["import_dialog_autofill_form_data"]));
        var chosen = new Dictionary<string, object> { { "import_dialog_saved_passwords", true } };
        Migration.ImportDefaults(chosen);
        Check("import dialog: a choice the profile already stored is kept", true.Equals(chosen["import_dialog_saved_passwords"]) && false.Equals(chosen["import_dialog_autofill_form_data"]));
        Check("import dialog: nothing to do the second time", !Migration.ImportDefaults(fresh));

        string userData = Path.Combine(Path.GetTempPath(), "enki-migration-" + Guid.NewGuid().ToString("N"));
        string root = Path.Combine(Path.GetTempPath(), "enki-root-" + Guid.NewGuid().ToString("N"));
        try
        {
            string def = Path.Combine(userData, "Default"), work = Path.Combine(userData, "Profile 1");
            Directory.CreateDirectory(def); Directory.CreateDirectory(work); Directory.CreateDirectory(root);
            foreach (string dir in new[] { def, work })
            {
                File.WriteAllText(Path.Combine(dir, "Preferences"), "{\"browser\":{\"has_seen_welcome_page\":true}}");
            }
            File.WriteAllText(Path.Combine(work, "Preferences.enki-backup"), "older");
            // Migration.Run calls this for every profile Local State lists (Run itself first looks for a
            // running browser, which Mono takes half a minute to answer).
            foreach (string dir in new[] { def, work }) Migration.ApplyImportDefaults(json, dir, root);
            var prefs = json.DeserializeObject(File.ReadAllText(Path.Combine(def, "Preferences"))) as Dictionary<string, object>;
            Check("existing profiles get the import defaults once, the rest of Preferences kept",
                false.Equals(prefs["import_dialog_saved_passwords"]) && false.Equals(prefs["import_dialog_autofill_form_data"]) && prefs.ContainsKey("browser")
                && File.Exists(Path.Combine(def, ".enki-import-defaults")) && File.Exists(Path.Combine(work, ".enki-import-defaults")),
                string.Join("; ", Updater.Logged));
            Check("an older backup is not overwritten", File.ReadAllText(Path.Combine(work, "Preferences.enki-backup")) == "older");
            File.WriteAllText(Path.Combine(def, "Preferences"), "{\"import_dialog_saved_passwords\":true}");
            Migration.ApplyImportDefaults(json, def, root);
            Check("after the first time, the user's own choice stays", File.ReadAllText(Path.Combine(def, "Preferences")) == "{\"import_dialog_saved_passwords\":true}");
        }
        finally
        {
            try { Directory.Delete(userData, true); } catch { }
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
