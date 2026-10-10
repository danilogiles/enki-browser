// The two decisions behind trusting a Widevine download that do not need Windows itself, kept apart
// from Widevine.cs so test/LauncherTests.cs can check them anywhere:
//  - who signed the module: the certificate subject's Organization (O) must be exactly "Google LLC",
//    parsed as a distinguished name, never matched as a substring (so "O=Google LLC Evil", an
//    OU or CN that merely contains the text, or a second O, are all refused);
//  - which update service to ask: always Google's, over HTTPS. Only a launcher compiled with
//    ENKI_TEST (test/widevine.mjs builds one; build/build.mjs never does) reads the
//    ENKI_WIDEVINE_SERVICE override, and even then only HTTPS or plain HTTP to this computer.
using System;
using System.Collections.Generic;
using System.Text;

static class WidevineTrust
{
    public const string DefaultService = "https://update.googleapis.com/service/update2/json";
    public const string Publisher = "Google LLC";

    /// Whether this launcher was compiled for tests (and so honors ENKI_WIDEVINE_SERVICE).
#if ENKI_TEST
    public const bool TestBuild = true;
#else
    public const bool TestBuild = false;
#endif

    /// The service to ask: Google's, unless a test build is pointed elsewhere (and allowed to be).
    public static string Service(string overrideUrl, bool testBuild)
    {
        if (!testBuild || string.IsNullOrEmpty(overrideUrl)) return DefaultService;
        if (!TestUrlAllowed(overrideUrl)) throw new Exception("ENKI_WIDEVINE_SERVICE must be https://, or http:// to this computer");
        return overrideUrl;
    }

    /// Whether a package address may be used: HTTPS always; plain HTTP to this computer only in a test build.
    public static bool DownloadAllowed(string url, bool testBuild)
    {
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return true;
        return testBuild && TestUrlAllowed(url);
    }

    /// HTTPS anywhere, or HTTP to the loopback address (the local stand-in the tests run).
    public static bool TestUrlAllowed(string url)
    {
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return true;
        return u.Scheme == Uri.UriSchemeHttp && u.IsLoopback;
    }

    /// True when the subject (as X509Certificate.Subject gives it, e.g.
    /// "CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US") has exactly one O
    /// attribute and its value is exactly "Google LLC".
    public static bool SignedByPublisher(string subject)
    {
        List<KeyValuePair<string, string>> attrs;
        if (!TryParseDn(subject, out attrs)) return false;
        int count = 0;
        bool match = false;
        foreach (var a in attrs)
        {
            if (!string.Equals(a.Key, "O", StringComparison.OrdinalIgnoreCase)) continue;
            count++;
            match = string.Equals(a.Value, Publisher, StringComparison.Ordinal);
        }
        return count == 1 && match;
    }

    /// Splits a distinguished name into (type, value) pairs, in the format Windows and .NET write it:
    /// RDNs separated by ',' or ';', multi-valued RDNs by '+', values optionally in double quotes (a
    /// quote inside written twice) or with backslash escapes. Whatever does not parse is refused.
    public static bool TryParseDn(string dn, out List<KeyValuePair<string, string>> attrs)
    {
        attrs = new List<KeyValuePair<string, string>>();
        if (dn == null) return false;
        int i = 0, n = dn.Length;
        while (true)
        {
            while (i < n && dn[i] == ' ') i++;
            if (i >= n) return attrs.Count > 0;
            int eq = dn.IndexOf('=', i);
            if (eq < 0) return false;
            string type = dn.Substring(i, eq - i).Trim();
            if (type.Length == 0) return false;
            foreach (char c in type) if (!(char.IsLetterOrDigit(c) || c == '.' || c == '-')) return false;
            i = eq + 1;
            while (i < n && dn[i] == ' ') i++;
            var value = new StringBuilder();
            if (i < n && dn[i] == '"')
            {
                i++;
                while (true)
                {
                    if (i >= n) return false; // unterminated quote
                    if (dn[i] == '"')
                    {
                        if (i + 1 < n && dn[i + 1] == '"') { value.Append('"'); i += 2; continue; }
                        i++;
                        break;
                    }
                    value.Append(dn[i++]);
                }
                while (i < n && dn[i] == ' ') i++;
                if (i < n && dn[i] != ',' && dn[i] != ';' && dn[i] != '+') return false;
            }
            else
            {
                while (i < n && dn[i] != ',' && dn[i] != ';' && dn[i] != '+')
                {
                    if (dn[i] == '"' || dn[i] == '=') return false;
                    if (dn[i] == '\\') { if (i + 1 >= n) return false; value.Append(dn[i + 1]); i += 2; continue; }
                    value.Append(dn[i++]);
                }
                string v = value.ToString().TrimEnd(' ');
                value.Length = 0; value.Append(v);
            }
            attrs.Add(new KeyValuePair<string, string>(type, value.ToString()));
            if (i >= n) return true;
            i++; // separator
            if (i >= n) return false; // trailing separator
        }
    }
}
