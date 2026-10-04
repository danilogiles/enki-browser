// One-time fix-ups for profiles created by older Enki Browser versions, applied by the launcher
// before Chromium starts (never while it runs: Chromium rewrites Preferences on exit).
//
// 0.3–0.5 shipped a navy theme as an extension. 0.6 dropped it, but a profile that had it keeps
// applying it from Preferences, so those windows stayed navy. This removes exactly that theme
// (by its id) and, unless the user ever chose a colour in Chromium, turns on its grey palette —
// the sober look new profiles get from initial_preferences. A backup of Preferences is kept.
using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

static class Migration
{
    const string OldThemeId = "nmeggokninfaeogdeipaiibopacblkdp";
    const string Marker = ".enki-profile-v1";

    public static void Run(string userData, string root)
    {
        string dir = Path.Combine(userData, "Default");
        string prefs = Path.Combine(dir, "Preferences");
        try
        {
            if (!File.Exists(prefs) || File.Exists(Path.Combine(dir, Marker))) return;
            if (Win.BrowserProcesses(root).Count > 0) return; // try again on a later start

            var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var top = json.DeserializeObject(File.ReadAllText(prefs)) as Dictionary<string, object>;
            if (top == null) return;
            bool changed = false;

            var extensions = top.ContainsKey("extensions") ? top["extensions"] as Dictionary<string, object> : null;
            var theme = extensions != null && extensions.ContainsKey("theme") ? extensions["theme"] as Dictionary<string, object> : null;
            if (theme != null && theme.ContainsKey("id") && (theme["id"] as string) == OldThemeId)
            {
                extensions.Remove("theme");
                changed = true;
            }

            var browser = top.ContainsKey("browser") ? top["browser"] as Dictionary<string, object> : null;
            if (browser == null) { browser = new Dictionary<string, object>(); top["browser"] = browser; }
            var colors = browser.ContainsKey("theme") ? browser["theme"] as Dictionary<string, object> : null;
            if (colors == null) { colors = new Dictionary<string, object>(); browser["theme"] = colors; }
            if (!colors.ContainsKey("is_grayscale2") && !colors.ContainsKey("user_color2"))
            {
                colors["is_grayscale2"] = true;
                changed = true;
            }

            if (changed)
            {
                File.Copy(prefs, prefs + ".enki-backup", true);
                File.WriteAllText(prefs, json.Serialize(top));
            }
            File.WriteAllText(Path.Combine(dir, Marker), DateTime.UtcNow.ToString("o"));
        }
        catch (Exception e)
        {
            // A profile the launcher cannot read is left exactly as it was.
            Updater.Log(root, "profile migration skipped: " + e.Message);
        }
    }
}
