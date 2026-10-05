// Enki Browser's updater: find, verify and install new releases beside the running one.
//
// Trust chain. Each release carries update.json (version, zip URL, zip SHA-256) and
// update.json.sig, an RSA-SHA256 signature made in CI with a key that exists only as a
// repository secret. The launcher embeds the public half (UpdateKey, generated at build time).
// A manifest without a valid signature is ignored, a zip whose hash differs from the signed one
// is discarded, and a version not newer than the running one is never installed — so neither a
// compromised download nor a replayed old release can change what runs.
//
// Installing. The new release is extracted into app\<version>\ next to the running one, checked,
// and only then does `current` name it. Nothing that exists is renamed, moved or overwritten,
// and no running file is touched: the 0.2–0.4 updater swapped files in place, renaming the
// running launcher, and an antivirus's behaviour monitor took that for malware and quarantined
// the install. The running browser keeps its version; the next start opens the new one.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Updater
{
    const string DefaultFeed = "https://api.github.com/repos/danilogiles/enki-browser/releases?per_page=20";
    // Releases are found within a couple of hours; a check is one small request to GitHub.
    static readonly TimeSpan CheckInterval = TimeSpan.FromHours(2);

    static string UpdateDir(string root) { return Path.Combine(root, ".update"); }

    public static bool Disabled(string root)
    {
        return File.Exists(Path.Combine(root, "no-update"))
            || Environment.GetEnvironmentVariable("ENKI_BROWSER_NO_UPDATE") == "1";
    }

    public static Version ReadVersion(string dir)
    {
        try
        {
            var json = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(Path.Combine(dir, "version.json"))) as Dictionary<string, object>;
            return new Version((string)json["enkiBrowser"]);
        }
        catch { return new Version(0, 0, 0); }
    }

    /// Looks for a newer signed release and installs it beside this one. `force` skips the
    /// CheckInterval limit.
    public static void CheckAndStage(string root, string appDir, bool force)
    {
        bool created;
        using (var mutex = new Mutex(true, "EnkiBrowserUpdater", out created))
        {
            if (!created && !mutex.WaitOne(0)) return; // another launcher is already on it
            try { CheckAndStageLocked(root, appDir, force); }
            catch (Exception e) { Log(root, "check failed: " + e.Message); }
            finally { try { mutex.ReleaseMutex(); } catch { } }
        }
    }

    static void CheckAndStageLocked(string root, string appDir, bool force)
    {
        Directory.CreateDirectory(UpdateDir(root));
        string stamp = Path.Combine(UpdateDir(root), "last-check");
        if (!force && File.Exists(stamp) && DateTime.UtcNow - File.GetLastWriteTimeUtc(stamp) < CheckInterval) return;
        File.WriteAllText(stamp, DateTime.UtcNow.ToString("o"));

        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; // TLS 1.2 + 1.3
        Version current = ReadVersion(appDir);
        Manifest m = FindLatest();
        if (m == null) { Log(root, "no signed release found"); return; }
        if (m.Version <= current) { Log(root, "up to date (" + current + "; latest signed release " + m.Version + ")"); return; }

        string target = Path.Combine(root, "app", m.Version.ToString());
        if (File.Exists(Path.Combine(target, "EnkiBrowserLauncher.exe")) && ReadVersion(target) == m.Version)
        {
            SetCurrent(root, m.Version);
            return; // already installed by an earlier check
        }

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
        string release = Path.Combine(work, "EnkiBrowser", "app", m.Version.ToString());
        // The zip must be the release the manifest describes, not merely a zip with the right hash.
        if (ReadVersion(release) != m.Version) throw new Exception("zip does not contain version " + m.Version);

        if (Directory.Exists(target)) Directory.Delete(target, true); // an incomplete earlier attempt
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        Directory.Move(release, target); // a new folder, created here: nothing existing moves
        Directory.Delete(work, true);
        SetCurrent(root, m.Version);
        Log(root, "installed " + m.Version + "; it opens the next time Enki Browser starts");
    }

    /// Keeps the version `current` names, the newest other one (the way back) and the one this
    /// launcher runs from; deletes the rest. The stub did this once per start with no retry and
    /// failed silently whenever an antivirus was still scanning the files, so installs kept every
    /// version ever downloaded; and the stub itself is never updated, so the fix lives here,
    /// run when the browser closes, when nothing is in use.
    public static void RemoveOldVersions(string root, string appDir)
    {
        try
        {
            string app = Path.Combine(root, "app");
            string current = File.ReadAllText(Path.Combine(root, "current")).Trim();
            var complete = new List<KeyValuePair<Version, string>>();
            foreach (string dir in Directory.GetDirectories(app))
            {
                Version v;
                if (Version.TryParse(Path.GetFileName(dir), out v) && File.Exists(Path.Combine(dir, "EnkiBrowserLauncher.exe")))
                    complete.Add(new KeyValuePair<Version, string>(v, dir));
            }
            complete.Sort((a, b) => b.Key.CompareTo(a.Key));
            string previous = null;
            foreach (var kv in complete) if (Path.GetFileName(kv.Value) != current) { previous = Path.GetFileName(kv.Value); break; }
            string own = Win.LongPath(appDir);
            foreach (string dir in Directory.GetDirectories(app))
            {
                string name = Path.GetFileName(dir);
                if (name == current || name == previous || string.Equals(Win.LongPath(dir), own, StringComparison.OrdinalIgnoreCase)) continue;
                if (Win.BrowserProcesses(dir).Count > 0) continue;
                try { Win.DeleteTree(dir); Log(root, "removed old version " + name); }
                catch (Exception e) { Log(root, "could not remove old version " + name + ": " + e.Message); }
            }
        }
        catch (Exception e) { Log(root, "old version cleanup skipped: " + e.Message); }
    }

    /// Points `current` at a version, replacing the file in one step so a crash mid-write can
    /// never leave it half written (and the stub falls back to the newest folder if it were).
    static void SetCurrent(string root, Version v)
    {
        string file = Path.Combine(root, "current"), next = file + ".new";
        File.WriteAllText(next, v.ToString());
        if (File.Exists(file)) File.Replace(next, file, null); else File.Move(next, file);
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
            return FetchManifest(manifestUrl, sigUrl); // releases come newest first
        }
        return null;
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
