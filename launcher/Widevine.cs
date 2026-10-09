// Protected video (Widevine): what Crunchyroll, Spotify and other services need to play.
//
// ungoogled-chromium is built with Widevine support but never downloads the module itself, Google's
// closed-source Content Decryption Module: Chrome gets it through Google's component updater, which
// ungoogled-chromium removes. Chromium still loads a CDM it finds in <User Data>\WidevineCdm\<version>\
// at start. So when the user turns protected video on (Enki Shield's settings, through NativeHost.cs),
// the launcher downloads it from Google the way Chrome would, puts it there, and keeps it current.
//
// The module is never part of Enki Browser: not in the repository, not in a release. It comes from
// Google's servers to this computer, on request, under Google's terms. What makes a download one we
// trust:
//  - the address and the SHA-256 of the package come from Google's update service, over HTTPS;
//  - the package must match that SHA-256;
//  - widevinecdm.dll must carry a valid Authenticode signature by Google LLC.
// Anything else is discarded. Enki talks to Google only after the user turned it on: at that moment,
// and then about once a day to keep it current (Watcher.cs). Turning it off removes the module.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Web.Script.Serialization;

static class Widevine
{
    /// Google's component id for the Widevine CDM (the same Chrome asks for).
    const string AppId = "oimompecagnajdejgnnjijobebaeigek";
    const string DefaultService = "https://update.googleapis.com/service/update2/json";
    /// Marks a module this launcher installed and keeps up to date; a copy someone put there by hand has none.
    const string Managed = ".enki-managed";
    static readonly TimeSpan UpdateEvery = TimeSpan.FromDays(1);

    public static string Dir(string userData) { return Path.Combine(userData, "WidevineCdm"); }

    /// The versions installed, newest first (folders holding a manifest and the Windows module).
    public static List<Version> Installed(string userData)
    {
        var found = new List<Version>();
        try
        {
            foreach (string d in Directory.GetDirectories(Dir(userData)))
            {
                Version v;
                if (Version.TryParse(Path.GetFileName(d), out v) && File.Exists(Path.Combine(d, "manifest.json"))
                    && File.Exists(Path.Combine(d, "_platform_specific", "win_x64", "widevinecdm.dll")))
                    found.Add(v);
            }
        }
        catch { }
        return found.OrderByDescending(v => v).ToList();
    }

    public static bool IsManaged(string userData) { return File.Exists(Path.Combine(Dir(userData), Managed)); }

    public static Dictionary<string, object> Status(string userData)
    {
        var installed = Installed(userData);
        return new Dictionary<string, object>
        {
            { "installed", installed.Count > 0 ? installed[0].ToString() : null },
            { "managed", IsManaged(userData) },
        };
    }

    /// Turns protected video on: downloads the current module from Google and installs it.
    /// Returns the version installed; throws with the reason when nothing trustworthy arrived.
    public static Version Install(string root, string appDir, string userData)
    {
        Directory.CreateDirectory(Dir(userData));
        File.WriteAllText(Path.Combine(Dir(userData), Managed), DateTime.UtcNow.ToString("o"));
        return Fetch(root, appDir, userData, true);
    }

    /// Keeps a module this launcher installed current; quiet about failures (the next day tries again).
    public static void UpdateIfDue(string root, string appDir, string userData)
    {
        if (!IsManaged(userData)) return;
        string stamp = Path.Combine(Dir(userData), ".enki-last-check");
        try
        {
            if (File.Exists(stamp) && DateTime.UtcNow - File.GetLastWriteTimeUtc(stamp) < UpdateEvery) return;
            File.WriteAllText(stamp, DateTime.UtcNow.ToString("o"));
            Fetch(root, appDir, userData, false);
        }
        catch (Exception e) { Updater.Log(root, "protected video: update check failed: " + e.Message); }
    }

    /// Turns protected video off. The module may be in use by a playing video; whatever cannot be
    /// deleted now is deleted by the launcher before the browser next starts (Tidy).
    public static void Remove(string root, string userData)
    {
        string dir = Dir(userData);
        if (!Directory.Exists(dir)) return;
        foreach (string d in Directory.GetDirectories(dir))
        {
            try { Directory.Delete(d, true); }
            catch { File.WriteAllText(Path.Combine(dir, ".enki-remove"), ""); }
        }
        try { File.Delete(Path.Combine(dir, Managed)); } catch { }
        Updater.Log(root, "protected video: turned off");
    }

    /// Before the browser starts, nothing holds the module: finish a removal, and drop versions an
    /// update replaced (the newest one stays).
    public static void Tidy(string userData)
    {
        string dir = Dir(userData);
        try
        {
            if (!Directory.Exists(dir)) return;
            string remove = Path.Combine(dir, ".enki-remove");
            if (File.Exists(remove))
            {
                foreach (string d in Directory.GetDirectories(dir)) try { Directory.Delete(d, true); } catch { }
                File.Delete(remove);
                return;
            }
            if (!IsManaged(userData)) return;
            var installed = Installed(userData);
            foreach (var old in installed.Skip(1)) try { Directory.Delete(Path.Combine(dir, old.ToString()), true); } catch { }
            foreach (string partial in Directory.GetDirectories(dir, "*.download")) try { Directory.Delete(partial, true); } catch { }
        }
        catch { }
    }

    static Version Fetch(string root, string appDir, string userData, bool fromClick)
    {
        Package p = Ask(appDir);
        var installed = Installed(userData);
        if (installed.Count > 0 && installed[0] >= p.Version)
        {
            if (fromClick) Updater.Log(root, "protected video: " + installed[0] + " is current");
            return installed[0];
        }

        string dir = Dir(userData);
        string work = Path.Combine(dir, p.Version + ".download");
        if (Directory.Exists(work)) Directory.Delete(work, true);
        Directory.CreateDirectory(work);
        string crx = Path.Combine(work, "package.crx3");
        Exception last = null;
        foreach (string url in p.Urls)
        {
            try { using (var web = Updater.Client()) web.DownloadFile(url, crx); last = null; break; }
            catch (Exception e) { last = e; }
        }
        if (last != null) throw new Exception("download failed: " + last.Message);
        string actual = Updater.Sha256(crx);
        if (!string.Equals(actual, p.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new Exception("package hash " + actual + " does not match Google's (" + p.Sha256 + "); discarded");

        string zip = Path.Combine(work, "package.zip");
        File.WriteAllBytes(zip, ZipOfCrx3(File.ReadAllBytes(crx)));
        File.Delete(crx);
        string unpacked = Path.Combine(work, "unpacked");
        Updater.SafeExtract(zip, unpacked);
        File.Delete(zip);

        string dll = Path.Combine(unpacked, "_platform_specific", "win_x64", "widevinecdm.dll");
        if (!File.Exists(dll) || !File.Exists(Path.Combine(unpacked, "manifest.json"))) throw new Exception("the package has no Windows x64 module");
        string signer;
        if (!SignedByGoogle(dll, out signer)) throw new Exception("widevinecdm.dll is not validly signed by Google LLC (" + signer + "); discarded");

        string target = Path.Combine(dir, p.Version.ToString());
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.Move(unpacked, target);
        Directory.Delete(work, true);
        Updater.Log(root, "protected video: installed Widevine " + p.Version + " from Google; it loads the next time Enki Browser starts");
        return p.Version;
    }

    sealed class Package
    {
        public Version Version;
        public string Sha256;
        public List<string> Urls = new List<string>();
    }

    /// One request to Google's update service, as Chrome's component updater makes it: which
    /// Widevine module is current for this platform and Chromium version, where to get it, its hash.
    /// No cookies, nothing about the user; the ids are random for every request.
    static Package Ask(string appDir)
    {
        string chromium = "120.0.0.0";
        try
        {
            var v = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(Path.Combine(appDir, "version.json"))) as Dictionary<string, object>;
            if (v != null && v.ContainsKey("chromium")) chromium = ((string)v["chromium"]).Split('-')[0];
        }
        catch { }
        var json = new JavaScriptSerializer();
        string body = json.Serialize(new Dictionary<string, object>
        {
            { "request", new Dictionary<string, object>
                {
                    { "@os", "win" }, { "@updater", "chromium" }, { "acceptformat", "crx3" }, { "arch", "x64" },
                    { "app", new object[] { new Dictionary<string, object> { { "appid", AppId }, { "updatecheck", new Dictionary<string, object>() }, { "version", "0.0.0.0" } } } },
                    { "os", new Dictionary<string, object> { { "arch", "x86_64" }, { "platform", "Windows" }, { "version", Environment.OSVersion.Version.ToString() } } },
                    { "prodversion", chromium }, { "updaterversion", chromium }, { "protocol", "3.1" },
                    { "requestid", "{" + Guid.NewGuid() + "}" }, { "sessionid", "{" + Guid.NewGuid() + "}" },
                }
            },
        });
        string service = Environment.GetEnvironmentVariable("ENKI_WIDEVINE_SERVICE") ?? DefaultService; // tests serve their own
        string text;
        using (var web = Updater.Client())
        {
            web.Headers["Content-Type"] = "application/json";
            text = web.UploadString(service, body);
        }
        // Google prefixes JSON answers with )]}' so that they cannot be run as a script.
        int start = text.IndexOf('{');
        var response = json.DeserializeObject(start >= 0 ? text.Substring(start) : text) as Dictionary<string, object>;
        Dictionary<string, object> check;
        try
        {
            var app = ((object[])((Dictionary<string, object>)response["response"])["app"])[0] as Dictionary<string, object>;
            check = (Dictionary<string, object>)app["updatecheck"];
        }
        catch { throw new Exception("unexpected answer from Google's update service"); }
        if ((check["status"] as string) != "ok") throw new Exception("Google's update service answered " + check["status"]);
        var p = new Package();
        try
        {
            var manifest = (Dictionary<string, object>)check["manifest"];
            var package = (Dictionary<string, object>)((object[])((Dictionary<string, object>)manifest["packages"])["package"])[0];
            p.Version = new Version((string)manifest["version"]);
            p.Sha256 = (string)package["hash_sha256"];
            foreach (Dictionary<string, object> u in (object[])((Dictionary<string, object>)check["urls"])["url"])
            {
                string codebase = (string)u["codebase"];
                // HTTPS only: the hash already proves the bytes, but nothing needs to travel in the clear.
                if (codebase.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || service != DefaultService) p.Urls.Add(codebase + (string)package["name"]);
            }
        }
        catch { throw new Exception("unexpected answer from Google's update service"); }
        if (p.Urls.Count == 0 || string.IsNullOrEmpty(p.Sha256)) throw new Exception("Google's update service gave no download address");
        return p;
    }

    /// A CRX3 file is "Cr24", format version 3, the length of a signed header, the header, then a
    /// zip. The zip is what holds the module; its integrity is the SHA-256 checked above and the
    /// module's own signature checked after.
    public static byte[] ZipOfCrx3(byte[] crx)
    {
        if (crx.Length < 12 || Encoding.ASCII.GetString(crx, 0, 4) != "Cr24" || BitConverter.ToUInt32(crx, 4) != 3)
            throw new Exception("not a CRX3 package");
        long start = 12L + BitConverter.ToUInt32(crx, 8);
        if (start >= crx.Length) throw new Exception("truncated CRX3 package");
        var zip = new byte[crx.Length - start];
        Array.Copy(crx, start, zip, 0, zip.Length);
        return zip;
    }

    /// A valid Authenticode signature (WinVerifyTrust, chain to a trusted root, not revoked as far as
    /// Windows can tell offline) whose signer is Google LLC.
    public static bool SignedByGoogle(string file, out string signer)
    {
        signer = "unsigned";
        try { signer = new X509Certificate(X509Certificate.CreateFromSignedFile(file)).Subject; }
        catch { return false; }
        if (!signer.Contains("O=Google LLC")) return false;
        return WinTrust.Verify(file);
    }

    static class WinTrust
    {
        static readonly Guid GenericVerifyV2 = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct FileInfo { public uint cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }

        [StructLayout(LayoutKind.Sequential)]
        struct Data
        {
            public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice;
            public uint fdwRevocationChecks; public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction;
            public IntPtr hWVTStateData; public IntPtr pwszURLReference; public uint dwProvFlags; public uint dwUIContext;
            public IntPtr pSignatureSettings;
        }

        [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
        static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, IntPtr data);

        public static bool Verify(string path)
        {
            var file = new FileInfo { cbStruct = (uint)Marshal.SizeOf(typeof(FileInfo)), pcwszFilePath = path };
            IntPtr pFile = Marshal.AllocHGlobal(Marshal.SizeOf(file));
            IntPtr pData = IntPtr.Zero;
            try
            {
                Marshal.StructureToPtr(file, pFile, false);
                var data = new Data
                {
                    cbStruct = (uint)Marshal.SizeOf(typeof(Data)),
                    dwUIChoice = 2,          // WTD_UI_NONE
                    fdwRevocationChecks = 0, // WTD_REVOKE_NONE: no network beyond what Windows caches
                    dwUnionChoice = 1,       // WTD_CHOICE_FILE
                    pFile = pFile,
                    dwStateAction = 0,
                    dwProvFlags = 0x00000010 // WTD_CACHE_ONLY_URL_RETRIEVAL
                };
                pData = Marshal.AllocHGlobal(Marshal.SizeOf(data));
                Marshal.StructureToPtr(data, pData, false);
                return WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, pData) == 0;
            }
            finally
            {
                Marshal.FreeHGlobal(pFile);
                if (pData != IntPtr.Zero) Marshal.FreeHGlobal(pData);
            }
        }
    }
}
