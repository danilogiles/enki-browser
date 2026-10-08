// What a taskbar pin or a shortcut to Enki Browser opens.
//
// ungoogled-chromium is not an installed, registered Chromium, and pinning one of its open windows
// pins the program behind it: app\<version>\chromium\chrome.exe. Opened from that pin, Chromium ran
// without the launcher — no Enki, no Shields, no updates, a different data folder (Chromium's own,
// %LOCALAPPDATA%\Chromium) — and the pin would break once that version folder was cleaned up. A
// real user hit all of it after pinning the window and adding a profile. The per-profile desktop
// shortcuts Chromium creates point at chrome.exe the same way.
//
// So the launcher repairs them: at every start and when the browser closes, shortcuts on the
// desktop, in the Start menu and pinned to the taskbar or Start that open a chrome.exe inside this
// install's app folder are pointed at EnkiBrowser.exe, keeping their arguments (a profile's
// --profile-directory). A window pinned during a session is fixed as soon as the browser closes.
//
// Giving Chromium's windows Enki Browser's own AppUserModelID, so pins would point at the stub from
// the start, was tried and does not work from outside the browser: Windows' window property store
// accepts the write from another process and keeps nothing. It would need code inside Chromium.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

static class ShellIdentity
{
    /// Folders holding shortcuts; ENKI_BROWSER_SHORTCUT_DIRS (";"-separated) replaces them in tests.
    static IEnumerable<string> Folders()
    {
        string over = Environment.GetEnvironmentVariable("ENKI_BROWSER_SHORTCUT_DIRS");
        if (!string.IsNullOrEmpty(over)) return over.Split(';').Where(d => d.Length > 0);
        string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Path.Combine(roaming, @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"),
            Path.Combine(roaming, @"Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu"),
        };
    }

    /// Points shortcuts that open app\…\chromium\chrome.exe directly back at EnkiBrowser.exe.
    public static void RepairShortcuts(string root)
    {
        string appPrefix = Win.LongPath(Path.Combine(root, "app")) + "\\";
        string stub = Path.Combine(root, "EnkiBrowser.exe");
        try
        {
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            foreach (string folder in Folders().Where(Directory.Exists))
            {
                foreach (string file in Directory.GetFiles(folder, "*.lnk", SearchOption.AllDirectories))
                {
                    try
                    {
                        dynamic link = shell.CreateShortcut(file);
                        string target = (string)link.TargetPath;
                        if (string.IsNullOrEmpty(target) || !target.EndsWith(@"\chromium\chrome.exe", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!Win.LongPath(target).StartsWith(appPrefix, StringComparison.OrdinalIgnoreCase)) continue;
                        link.TargetPath = stub;
                        link.WorkingDirectory = root;
                        link.IconLocation = stub + ",0";
                        link.Save();
                        Updater.Log(root, "repaired shortcut " + Path.GetFileName(file) + ": now opens EnkiBrowser.exe");
                    }
                    catch { }
                }
            }
        }
        catch (Exception e) { Updater.Log(root, "shortcut repair skipped: " + e.Message); }
    }
}
