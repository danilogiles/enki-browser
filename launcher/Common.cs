// Helpers shared by the entry stub, the launcher and the installer.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Win
{
    /// Quotes one argument the way CommandLineToArgvW parses it back.
    public static string Quote(string arg)
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

    public static string JoinArgs(IEnumerable<string> args) { return string.Join(" ", args.Select(Quote)); }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint size);

    /// The long form of a path: C:\Users\RUNNER~1\... and C:\Users\runneradmin\... must compare equal.
    public static string LongPath(string path)
    {
        var sb = new StringBuilder(1024);
        uint n = GetLongPathName(path, sb, (uint)sb.Capacity);
        return (n > 0 && n < sb.Capacity ? sb.ToString() : Path.GetFullPath(path)).TrimEnd('\\');
    }

    /// Enki Browser processes (chrome.exe) running from inside `dir`, and no other browser's.
    public static List<Process> BrowserProcesses(string dir)
    {
        string prefix = LongPath(dir) + "\\";
        var found = new List<Process>();
        foreach (var p in Process.GetProcessesByName("chrome"))
        {
            try { if (LongPath(p.MainModule.FileName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) found.Add(p); }
            catch { /* another user's or an elevated process: not ours */ }
        }
        return found;
    }

    public static void CloseBrowser(string dir)
    {
        foreach (var p in BrowserProcesses(dir)) { try { p.CloseMainWindow(); } catch { } }
        for (int i = 0; i < 20 && BrowserProcesses(dir).Count > 0; i++) Thread.Sleep(250);
        foreach (var p in BrowserProcesses(dir)) { try { p.Kill(); } catch { } }
        for (int i = 0; i < 20 && BrowserProcesses(dir).Count > 0; i++) Thread.Sleep(250);
    }

    /// Deletes a folder, retrying while an antivirus scan or a closing process holds a file.
    public static void DeleteTree(string path)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, true); else if (File.Exists(path)) File.Delete(path); return; }
            catch (IOException) { if (attempt >= 10) throw; Thread.Sleep(300); }
            catch (UnauthorizedAccessException) { if (attempt >= 10) throw; Thread.Sleep(300); }
        }
    }

    static readonly string Lang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
    /// Portuguese, Spanish or English, following Windows' display language.
    public static string T(string pt, string es, string en) { return Lang == "pt" ? pt : Lang == "es" ? es : en; }
}
