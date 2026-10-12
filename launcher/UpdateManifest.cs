// The fields the Windows updater takes from a signed update.json. Linux's update-linux.json is
// signed with the same key, so a valid signature alone does not make a manifest ours: one whose
// "platform" is set to anything but win-x64 is refused. A manifest without the field (releases
// before it was added) is still accepted, for the transition.
using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

static class UpdateManifest
{
    public const string Platform = "win-x64";

    /// Reads version, url and sha256 from an already verified manifest body; throws if the
    /// manifest names another platform.
    public static void Parse(string json, out Version version, out string url, out string sha256)
    {
        var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
        object platform;
        if (d.TryGetValue("platform", out platform) && !(platform is string && (string)platform == Platform))
            throw new Exception("update manifest is for " + platform + ", not " + Platform);
        version = new Version((string)d["version"]);
        url = (string)d["url"];
        sha256 = (string)d["sha256"];
    }
}
