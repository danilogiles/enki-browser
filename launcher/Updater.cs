// Enki Browser's updater: find, verify, stage and apply new releases.
//
// Trust chain. Each release carries update.json (version, zip URL, zip SHA-256) and
// update.json.sig, an RSA-SHA256 signature made in CI with a key that exists only as a
// repository secret. The launcher embeds the public half (UpdateKey, generated at build time).
// A manifest without a valid signature is ignored, a zip whose hash differs from the signed one
// is discarded, and a version not newer than the running one is never installed — so neither a
// compromised download nor a replayed old release can change what runs.
//
// Timing. Checking happens after the browser has started, at most once a day, in this windowless
// process. Applying happens on the next launch, and only while no Enki Browser window is open:
// Chromium holds its files open, and replacing them underneath a running browser corrupts it.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Updater
{
    const string DefaultFeed = "https://api.github.com/repos/danilogiles/enki-browser/releases?per_page=20";
    static readonly TimeSpan CheckInterval = TimeSpan.FromHours(20);

    // Entries that belong to this installation, not to a release: never moved during an update.
    static readonly string[] Keep = { "User Data", ".update", ".previous", "portable", "no-update" };

    static string UpdateDir(string root) { return Path.Combine(root, ".update"); }
    static string StagedDir(string root) { return Path.Combine(UpdateDir(root), "staged"); }
    static string ReadyFile(string root) { return Path.Combine(UpdateDir(root), "ready.json"); }

    public static bool Disabled(string root)
    {
        return File.Exists(Path.Combine(root, "no-update"))
            || Environment.GetEnvironmentVariable("ENKI_BROWSER_NO_UPDATE") == "1";
    }

    public static Version CurrentVersion(string root)
    {
        try
        {
            var json = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(Path.Combine(root, "version.json"))) as Dictionary<string, object>;
            return new Version((string)json["enkiBrowser"]);
        }
        catch { return new Version(0, 0, 0); }
    }

    // ------------------------------------------------------------------ apply

    /// Installs a staged update if one is ready and the browser is closed. Returns true when the
    /// program files changed, so the caller restarts the new launcher instead of continuing.
    public static bool ApplyStaged(string root)
    {
        if (!File.Exists(ReadyFile(root)) || !Directory.Exists(StagedDir(root))) return false;
        if (BrowserRunning(root)) { Log(root, "update ready; waiting for the browser to close"); return false; }

        string staged = StagedDir(root);
        string previous = Path.Combine(root, ".previous");
        var moved = new List<string>();
        try
        {
            if (Directory.Exists(previous)) Directory.Delete(previous, true);
            Directory.CreateDirectory(previous);
            foreach (string entry in Directory.GetFileSystemEntries(staged))
            {
                string name = Path.GetFileName(entry);
                if (Keep.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
                string target = Path.Combine(root, name);
                // Moving (not copying) the old entry aside works even for the running launcher:
                // Windows lets a running executable be renamed on the same volume, only not replaced.
                if (File.Exists(target) || Directory.Exists(target)) MovePath(target, Path.Combine(previous, name));
                moved.Add(name);
                MovePath(entry, target);
            }
        }
        catch (Exception e)
        {
            Log(root, "apply failed, rolling back: " + e.Message);
            foreach (string name in moved)
            {
                try
                {
                    string target = Path.Combine(root, name);
                    if (File.Exists(target)) File.Delete(target); else if (Directory.Exists(target)) Directory.Delete(target, true);
                    string saved = Path.Combine(previous, name);
                    if (File.Exists(saved) || Directory.Exists(saved)) MovePath(saved, target);
                }
                catch (Exception r) { Log(root, "rollback of " + name + " failed: " + r.Message); }
            }
            return false;
        }
        try { Directory.Delete(UpdateDir(root), true); } catch { /* the next check cleans up */ }
        Log(root, "applied update to " + CurrentVersion(root));
        return true;
    }

    static void MovePath(string from, string to)
    {
        if (Directory.Exists(from)) Directory.Move(from, to); else File.Move(from, to);
    }

    static bool BrowserRunning(string root)
    {
        string chrome = Path.Combine(root, "chromium", "chrome.exe");
        foreach (var p in Process.GetProcessesByName("chrome"))
        {
            try { if (string.Equals(p.MainModule.FileName, chrome, StringComparison.OrdinalIgnoreCase)) return true; }
            catch { /* another user's or an elevated process: not ours */ }
        }
        return false;
    }

    // ------------------------------------------------------------------ check

    /// Looks for a newer signed release and stages it. `force` skips the once-a-day limit.
    public static void CheckAndStage(string root, bool force)
    {
        bool created;
        using (var mutex = new Mutex(true, "EnkiBrowserUpdater", out created))
        {
            if (!created && !mutex.WaitOne(0)) return; // another launcher is already on it
            try { CheckAndStageLocked(root, force); }
            catch (Exception e) { Log(root, "check failed: " + e.Message); }
            finally { try { mutex.ReleaseMutex(); } catch { } }
        }
    }

    static void CheckAndStageLocked(string root, bool force)
    {
        Directory.CreateDirectory(UpdateDir(root));
        string stamp = Path.Combine(UpdateDir(root), "last-check");
        if (!force && File.Exists(stamp) && DateTime.UtcNow - File.GetLastWriteTimeUtc(stamp) < CheckInterval) return;
        File.WriteAllText(stamp, DateTime.UtcNow.ToString("o"));

        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; // TLS 1.2 + 1.3
        Version current = CurrentVersion(root);
        Manifest m = FindLatest();
        if (m == null) { Log(root, "no signed release found"); return; }
        if (m.Version <= current) { Log(root, "up to date (" + current + "; latest signed release " + m.Version + ")"); return; }
        if (File.Exists(ReadyFile(root)) && ReadVersion(ReadyFile(root)) >= m.Version) return; // already staged

        Log(root, "downloading " + m.Version + " from " + m.Url);
        string zip = Path.Combine(UpdateDir(root), "download.zip");
        using (var web = Client()) web.DownloadFile(m.Url, zip);
        string actual = Sha256(zip);
        if (!string.Equals(actual, m.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(zip);
            throw new Exception("zip hash " + actual + " does not match the signed manifest (" + m.Sha256 + "); discarded");
        }

        string work = Path.Combine(UpdateDir(root), "extract");
        if (Directory.Exists(work)) Directory.Delete(work, true);
        SafeExtract(zip, work);
        File.Delete(zip);
        string app = Path.Combine(work, "EnkiBrowser");
        // The zip must be the release the manifest describes, not merely a zip with the right hash.
        if (CurrentVersion(app) != m.Version) throw new Exception("zip contains " + CurrentVersion(app) + ", manifest says " + m.Version);

        if (Directory.Exists(StagedDir(root))) Directory.Delete(StagedDir(root), true);
        Directory.Move(app, StagedDir(root));
        Directory.Delete(work, true);
        File.WriteAllText(ReadyFile(root), "{\"version\":\"" + m.Version + "\"}");
        Log(root, "staged " + m.Version + "; it installs the next time Enki Browser starts");
    }

    static Version ReadVersion(string file)
    {
        try { return new Version((string)((Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)))["version"]); }
        catch { return new Version(0, 0, 0); }
    }

    class Manifest { public Version Version; public string Url; public string Sha256; }

    /// Finds the newest release whose update.json carries a valid signature. With
    /// ENKI_BROWSER_UPDATE_FEED set (tests, mirrors), that URL is the manifest itself.
    static Manifest FindLatest()
    {
        string feed = Environment.GetEnvironmentVariable("ENKI_BROWSER_UPDATE_FEED");
        if (!string.IsNullOrEmpty(feed)) return FetchManifest(feed, feed + ".sig");

        string json;
        using (var web = Client()) json = web.DownloadString(DefaultFeed);
        var releases = new JavaScriptSerializer() { MaxJsonLength = int.MaxValue }.DeserializeObject(json) as object[];
        Manifest best = null;
        foreach (Dictionary<string, object> release in releases ?? new object[0])
        {
            if (release.ContainsKey("draft") && (bool)release["draft"]) continue;
            string manifestUrl = null, sigUrl = null;
            foreach (Dictionary<string, object> asset in (object[])release["assets"])
            {
                if ((string)asset["name"] == "update.json") manifestUrl = (string)asset["browser_download_url"];
                if ((string)asset["name"] == "update.json.sig") sigUrl = (string)asset["browser_download_url"];
            }
            if (manifestUrl == null || sigUrl == null) continue;
            Manifest m = FetchManifest(manifestUrl, sigUrl);
            if (m != null && (best == null || m.Version > best.Version)) best = m;
            if (best != null) break; // releases come newest first; the first signed one is the answer
        }
        return best;
    }

    static Manifest FetchManifest(string manifestUrl, string sigUrl)
    {
        byte[] body, sig;
        using (var web = Client())
        {
            body = web.DownloadData(manifestUrl);
            sig = Convert.FromBase64String(Encoding.ASCII.GetString(web.DownloadData(sigUrl)).Trim());
        }
        using (var rsa = new RSACng())
        {
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = Convert.FromBase64String(UpdateKey.Modulus),
                Exponent = Convert.FromBase64String(UpdateKey.Exponent),
            });
            if (!rsa.VerifyData(body, sig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                throw new Exception("update manifest signature is invalid: " + manifestUrl);
        }
        var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(body));
        return new Manifest { Version = new Version((string)d["version"]), Url = (string)d["url"], Sha256 = (string)d["sha256"] };
    }

    static WebClient Client()
    {
        var web = new WebClient();
        web.Headers[HttpRequestHeader.UserAgent] = "EnkiBrowser-Updater";
        return web;
    }

    static string Sha256(string file)
    {
        using (var sha = SHA256.Create())
        using (var s = File.OpenRead(file))
            return BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
    }

    /// Extracts refusing any entry that would land outside `dest` ("zip slip").
    static void SafeExtract(string zip, string dest)
    {
        string full = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
        using (var archive = ZipFile.OpenRead(zip))
        {
            foreach (var entry in archive.Entries)
            {
                string target = Path.GetFullPath(Path.Combine(dest, entry.FullName));
                if (!target.StartsWith(full, StringComparison.OrdinalIgnoreCase)) throw new Exception("zip entry escapes its folder: " + entry.FullName);
                if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                entry.ExtractToFile(target, true);
            }
        }
    }

    public static void Log(string root, string message)
    {
        try
        {
            Directory.CreateDirectory(UpdateDir(root));
            string log = Path.Combine(UpdateDir(root), "update.log");
            if (File.Exists(log) && new FileInfo(log).Length > 256 * 1024) File.Delete(log);
            File.AppendAllText(log, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
        }
        catch { }
    }
}
