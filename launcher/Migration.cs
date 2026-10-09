// Enki Browser's defaults for every profile, applied by the launcher before Chromium starts (never
// while it runs: Chromium rewrites Preferences on exit).
//
// initial_preferences only reaches the first profile. A profile created later (the profile menu,
// "Add") started bare: Enki and Shields not pinned, Chromium's blue palette. So each profile listed
// in Local State gets, once (a marker file in it), what a new install gets:
//  - Enki and Enki Shield pinned to the toolbar, without unpinning anything the user pinned;
//  - Chromium's grey palette, unless the user ever chose a colour;
//  - and, for profiles from 0.3–0.5, the old navy theme reference removed (it kept the window navy
//    after 0.6 stopped shipping the theme).
// Since 0.8.6, also once per profile (marker .enki-import-defaults): saved passwords and autofill
// unticked in Chromium's import dialog (ImportDefaults).
// These preferences are not among the ones Chromium protects with a MAC (the default search engine
// is, and writing it here got it reset), so Chromium keeps them. A backup of Preferences is kept.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

static class Migration
{
    const string OldThemeId = "nmeggokninfaeogdeipaiibopacblkdp";
    const string Marker = ".enki-profile-v2";

    public static void Run(string userData, string root, string appDir)
    {
        try
        {
            if (Win.BrowserProcesses(root).Count > 0) return; // try again on a later start
            var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var pinned = PinnedIds(json, appDir);
            foreach (string profile in Profiles(json, userData))
            {
                Apply(json, Path.Combine(userData, profile), pinned, root);
                ApplyImportDefaults(json, Path.Combine(userData, profile), root);
            }
        }
        catch (Exception e)
        {
            Updater.Log(root, "profile defaults skipped: " + e.Message);
        }
    }

    /// Enki's and Enki Shield's ids, from the version.json the build writes next to the launcher.
    static List<string> PinnedIds(JavaScriptSerializer json, string appDir)
    {
        var ids = new List<string>();
        try
        {
            var v = json.DeserializeObject(File.ReadAllText(Path.Combine(appDir, "version.json"))) as Dictionary<string, object>;
            foreach (string k in new[] { "enkiExtensionId", "shieldExtensionId" })
                if (v != null && v.ContainsKey(k) && v[k] is string) ids.Add((string)v[k]);
        }
        catch { }
        return ids;
    }

    /// The profile folders Local State knows about, plus Default.
    static IEnumerable<string> Profiles(JavaScriptSerializer json, string userData)
    {
        var found = new List<string> { "Default" };
        try
        {
            var state = json.DeserializeObject(File.ReadAllText(Path.Combine(userData, "Local State"))) as Dictionary<string, object>;
            var profile = state != null && state.ContainsKey("profile") ? state["profile"] as Dictionary<string, object> : null;
            var cache = profile != null && profile.ContainsKey("info_cache") ? profile["info_cache"] as Dictionary<string, object> : null;
            if (cache != null) found.AddRange(cache.Keys);
        }
        catch { }
        // Only plain folder names: never follow a path out of the profile folder.
        return found.Distinct().Where(p => p.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && p != "." && p != "..");
    }

    /// Chromium's "Import bookmarks and settings" dialog starts with every kind of data ticked,
    /// saved passwords and autofill included. In Enki Browser those two start unticked: copying
    /// passwords out of another browser is something to choose, not to slip through. New profiles
    /// get it from initial_preferences; each existing profile once (its own marker, since the 0.8.6
    /// change came after the v2 defaults). A choice the profile already stored is kept.
    public static bool ImportDefaults(Dictionary<string, object> top)
    {
        bool changed = false;
        foreach (string pref in ImportPrefs)
        {
            if (top.ContainsKey(pref)) continue;
            top[pref] = false;
            changed = true;
        }
        return changed;
    }

    public static readonly string[] ImportPrefs = { "import_dialog_saved_passwords", "import_dialog_autofill_form_data" };
    const string ImportMarker = ".enki-import-defaults";

    internal static void ApplyImportDefaults(JavaScriptSerializer json, string dir, string root)
    {
        string prefs = Path.Combine(dir, "Preferences");
        try
        {
            if (!File.Exists(prefs) || File.Exists(Path.Combine(dir, ImportMarker))) return;
            var top = json.DeserializeObject(File.ReadAllText(prefs)) as Dictionary<string, object>;
            if (top == null) return;
            if (ImportDefaults(top))
            {
                // A backup from the v2 defaults (often made on this same start) is older, so it stays.
                if (!File.Exists(prefs + ".enki-backup")) File.Copy(prefs, prefs + ".enki-backup");
                File.WriteAllText(prefs, json.Serialize(top));
                Updater.Log(root, "import dialog: passwords and autofill unticked in profile " + Path.GetFileName(dir));
            }
            File.WriteAllText(Path.Combine(dir, ImportMarker), DateTime.UtcNow.ToString("o"));
        }
        catch (Exception e) { Updater.Log(root, "profile " + Path.GetFileName(dir) + " import defaults skipped: " + e.Message); }
    }

    static Dictionary<string, object> Child(Dictionary<string, object> parent, string key)
    {
        var child = parent.ContainsKey(key) ? parent[key] as Dictionary<string, object> : null;
        if (child == null) { child = new Dictionary<string, object>(); parent[key] = child; }
        return child;
    }

    static void Apply(JavaScriptSerializer json, string dir, List<string> pinnedIds, string root)
    {
        string prefs = Path.Combine(dir, "Preferences");
        try
        {
            if (!File.Exists(prefs) || File.Exists(Path.Combine(dir, Marker))) return;
            var top = json.DeserializeObject(File.ReadAllText(prefs)) as Dictionary<string, object>;
            if (top == null) return;
            bool changed = false;

            var extensions = Child(top, "extensions");
            var theme = extensions.ContainsKey("theme") ? extensions["theme"] as Dictionary<string, object> : null;
            if (theme != null && theme.ContainsKey("id") && (theme["id"] as string) == OldThemeId)
            {
                extensions.Remove("theme");
                changed = true;
            }

            var pinned = extensions.ContainsKey("pinned_extensions") && extensions["pinned_extensions"] is object[]
                ? ((object[])extensions["pinned_extensions"]).OfType<string>().ToList()
                : new List<string>();
            var missing = pinnedIds.Where(id => !pinned.Contains(id)).ToList();
            if (missing.Count > 0)
            {
                extensions["pinned_extensions"] = missing.Concat(pinned).ToArray();
                changed = true;
            }

            var colors = Child(Child(top, "browser"), "theme");
            if (!colors.ContainsKey("is_grayscale2") && !colors.ContainsKey("user_color2"))
            {
                colors["is_grayscale2"] = true;
                changed = true;
            }

            if (changed)
            {
                File.Copy(prefs, prefs + ".enki-backup", true);
                File.WriteAllText(prefs, json.Serialize(top));
                Updater.Log(root, "applied Enki Browser's defaults to profile " + Path.GetFileName(dir));
            }
            File.WriteAllText(Path.Combine(dir, Marker), DateTime.UtcNow.ToString("o"));
        }
        catch (Exception e)
        {
            // A profile the launcher cannot read is left exactly as it was.
            Updater.Log(root, "profile " + Path.GetFileName(dir) + " skipped: " + e.Message);
        }
    }
}
