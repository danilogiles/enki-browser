#!/usr/bin/env python3
"""Assembles a private, test-isolated Windows test copy of Enki Browser from a CI build.

    python3 scripts/windows-test-package.py <EnkiBrowser-<v>-windows-x64.zip> --label <id> [--out DIR]

Input: the portable zip the Windows build (build/build.mjs) produces, whose top folder is
EnkiBrowser\\ (EnkiBrowser.exe, current, app\\<version>\\EnkiBrowserLauncher.exe, chromium\\chrome.exe).
Output, in DIR (default: the current folder):
    Enki-LiveChat-<id>-Windows-x64\\
        EnkiBrowser\\               the CI build, unchanged, plus two marker files:
            test-isolated          "enki-test-isolated/1", label= and token= (random); the launcher
                                   honours it only if the same token is in the Shield file below.
                                   Then: own profile (EnkiBrowser\\User Data); no native host, Apps entry,
                                   browser registration, updates, or uninstall of the real install's
                                   shortcuts/registry/profile (launcher/Common.cs, Isolation)
            no-update              belt and braces: updates off for any launcher that reads it
            app\\<v>\\extensions\\shield\\test-copy.json
                                   {"testCopy":true,"label":…,"token":…}: Shield never calls the native
                                   host and shows "Test copy, updates off" (shield/testcopy.js)
        Create-Test-Shortcut.ps1   one desktop shortcut to EnkiBrowser\\EnkiBrowser.exe (Enki's
                                   name and icon, the same start path as a normal install)
        READ-ME-FIRST.txt
        FILE-SHA256SUMS            every file in the folder
    Enki-LiveChat-<id>-Windows-x64.zip and SHA256SUMS (the zip's hash)

The script refuses a build whose launcher and stub do not know the test-isolated marker: an older
launcher would ignore it and register itself, claim updates and use the real profile. It never
signs, uploads, tags or publishes anything.
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import zipfile

MARKER = "test-isolated"
# The label lands in test-copy.json, the marker file, the .ps1 (inside single quotes) and the notes:
# letters, digits, '.', '_' and '-' only, so none of them can be broken out of.
LABEL = re.compile(r"[A-Za-z0-9._-]{1,40}")
TOP = "EnkiBrowser/"


def fail(message):
    sys.exit("windows-test-package: " + message)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def knows_marker(data):
    # C# string literals are stored as UTF-16LE in the assembly's user-string heap.
    return MARKER.encode("utf-16-le") in data


SHORTCUT_PS1 = r"""# Creates the desktop shortcut for this private Enki Browser test copy. Run it normally in
# PowerShell (no admin, no execution-policy change). It refuses to run if this folder is not a
# test-isolated copy, if it is the normal install's folder, or if the shortcut already exists.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'EnkiBrowser'
$stub = Join-Path $root 'EnkiBrowser.exe'
if (-not (Test-Path -LiteralPath $stub)) { throw "EnkiBrowser.exe missing: $stub" }
if (-not (Test-Path -LiteralPath (Join-Path $root 'test-isolated') -PathType Leaf)) { throw 'test-isolated marker missing; refusing (this would behave as a normal install).' }
# The launcher honours the marker only when its token matches Shield's test-copy.json (Common.cs).
$token = (Get-Content -LiteralPath (Join-Path $root 'test-isolated') | Where-Object { $_ -like 'token=*' } | Select-Object -First 1)
$version = (Get-Content -LiteralPath (Join-Path $root 'current') -Raw).Trim()
$shieldCopy = Join-Path $root "app\$version\extensions\shield\test-copy.json"
if (-not $token -or -not (Test-Path -LiteralPath $shieldCopy) -or -not ((Get-Content -LiteralPath $shieldCopy -Raw) -like ('*"token":"' + $token.Substring(6) + '"*'))) { throw 'test-isolated marker does not match Shield''s test-copy.json; refusing (the launcher would start this as a normal install).' }
$normal = Join-Path $env:LOCALAPPDATA 'Programs\EnkiBrowser'
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -ieq [IO.Path]::GetFullPath($normal).TrimEnd('\')) { throw "This is the normal install's folder ($normal); extract the test copy elsewhere." }
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop '@@NAME@@.lnk'
if (Test-Path -LiteralPath $linkPath) { throw 'Test shortcut already exists; no changes made.' }
$wsh = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($linkPath)
$link.TargetPath = $stub
$link.Arguments = ''
$link.WorkingDirectory = $root
$link.IconLocation = $stub + ',0'
$link.Description = 'Private Enki Browser test @@LABEL@@: isolated profile, no updates or registration; not production'
$link.Save()
Write-Host "Created $linkPath -> $stub"
Write-Host ("Profile: " + (Join-Path $root 'User Data'))
"""

README = """PRIVATE WINDOWS x64 ENKI BROWSER TEST COPY ({label}) - NOT A RELEASE

Built from: {source}
Browser version: {version}

What is different from the f4cecee test copy: the shortcut now opens EnkiBrowser\\EnkiBrowser.exe,
the same way a normal install starts (EnkiBrowser.exe -> app\\{version}\\EnkiBrowserLauncher.exe ->
chromium\\chrome.exe), so the shortcut, taskbar and Task Manager show Enki Browser. The internal
file chromium\\chrome.exe keeps its name (renaming it is a separate change).

Isolation (file EnkiBrowser\\test-isolated; see launcher/Common.cs, class Isolation):
  - profile: EnkiBrowser\\User Data inside this folder, never %LOCALAPPDATA%\\EnkiBrowser
    (a NEW profile: voice settings saved in the f4cecee copy's profile are not carried over);
  - skipped: "Check for updates" native-host registration (HKCU\\Software\\Chromium\\
    NativeMessagingHosts), Settings > Apps entry, default-browser/"Open with" registration and
    repair, every update check/download/staging/restart, Widevine refresh;
  - EnkiBrowser.exe --uninstall here removes only this folder: never the real install's shortcuts,
    registry entries or profile.

Setup: extract this folder somewhere writable and separate from Enki (NOT
%LOCALAPPDATA%\\Programs\\EnkiBrowser). Verify SHA256SUMS. Run Create-Test-Shortcut.ps1 normally
in PowerShell (no admin, no policy change). Open the desktop shortcut "{name}".

Shield in this copy knows it is a test copy (extensions\\shield\\test-copy.json): it never talks to
the native host, hides "Check for updates", "Restart to update", default browser and protected
video, and shows "Test copy, updates off" instead. The first window's title says so too.
Do not edit or delete test-isolated or test-copy.json: without both (same token), the launcher
starts this folder as a normal install.

Unsigned by the release signing workflow; Windows may warn. If it blocks, stop and report the exact
text; do not disable protections. Not launched on Windows by its assembler unless stated otherwise.
Cleanup: close the test browser, delete its shortcut and this folder (its profile is inside; remove
saved voice configuration first, since the profile holds your locally encrypted key).
"""


def shield_json(label, token):
    """Shield's test-copy.json. Compact separators: the launcher looks for "token":"<token>" (Common.cs)."""
    return json.dumps({"testCopy": True, "label": label, "token": token}, separators=(",", ":")) + "\n"


def marker_text_for(label, token):
    """The test-isolated marker; refuses values that could add or split its lines."""
    if not LABEL.fullmatch(label) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ValueError("bad label or token")
    return "enki-test-isolated/1\nlabel=%s\ntoken=%s\n" % (label, token)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("zip", help="EnkiBrowser-<version>-windows-x64.zip from the Windows build")
    ap.add_argument("--label", required=True, help="short id, e.g. the commit (letters, digits, - and . only)")
    ap.add_argument("--source", default="", help="source commit / CI run, written to the notes")
    ap.add_argument("--out", default=".", help="output folder")
    a = ap.parse_args()
    if not LABEL.fullmatch(a.label):
        fail("--label may contain only letters, digits, '.', '_' and '-' (at most 40)")
    if any(c in (a.source or "") for c in "\r\n"):
        fail("--source must be one line")

    base = "Enki-LiveChat-%s-Windows-x64" % a.label
    name = "Enki Live Chat TEST %s" % a.label
    out = os.path.abspath(a.out)
    folder = os.path.join(out, base)
    if os.path.exists(folder) or os.path.exists(folder + ".zip"):
        fail("output already exists, refusing to overwrite: " + folder)

    with zipfile.ZipFile(a.zip) as z:
        names = z.namelist()
        for n in names:  # zip slip, and nothing outside EnkiBrowser/
            norm = n.replace("\\", "/")
            if not norm.startswith(TOP) or ".." in norm.split("/") or norm.startswith("/"):
                fail("unexpected entry in the build zip: " + n)
        try:
            version = z.read(TOP + "current").decode("utf-8").strip()
        except KeyError:
            fail("the zip has no EnkiBrowser/current: not a Windows build zip")
        if not re.fullmatch(r"\d+(\.\d+){1,3}", version):
            fail("EnkiBrowser/current is not a version: %r" % version)
        app = TOP + "app/" + version + "/"
        required = [TOP + "EnkiBrowser.exe", app + "EnkiBrowserLauncher.exe", app + "chromium/chrome.exe", app + "version.json"]
        missing = [r for r in required if r not in names]
        if missing:
            fail("the build is incomplete: " + ", ".join(missing))
        if app + "extensions/shield/manifest.json" not in names:
            fail("the build has no Shield at " + app + "extensions/shield/")
        if app + "extensions/shield/testcopy.js" not in names:
            fail("Shield in this build predates test copies (no testcopy.js): refusing, it would reach the real install's host")
        for exe in (TOP + "EnkiBrowser.exe", app + "EnkiBrowserLauncher.exe", app + "EnkiBrowser.exe"):
            if exe in names and not knows_marker(z.read(exe)):
                fail("%s does not know the %s marker (a build from before this change): refusing, it would "
                     "register itself and use the real profile" % (exe, MARKER))
        os.makedirs(folder)
        z.extractall(folder)

    root = os.path.join(folder, "EnkiBrowser")
    token = secrets.token_hex(16)
    shield_file = os.path.join(root, "app", version, "extensions", "shield", "test-copy.json")
    with open(shield_file, "w", newline="\n") as f:
        f.write(shield_json(a.label, token))
    marker_text = marker_text_for(a.label, token)
    for marker, text in ((MARKER, marker_text), ("no-update", "Updates off for this test copy.\n")):
        with open(os.path.join(root, marker), "w", newline="\r\n") as f:
            f.write(text)
    for stray in ("portable",):  # portable mode adds --disable-machine-id; not wanted here
        p = os.path.join(root, stray)
        if os.path.exists(p):
            os.remove(p)
    with open(os.path.join(folder, "Create-Test-Shortcut.ps1"), "w", newline="\r\n") as f:
        # Both go inside single-quoted PowerShell strings; doubling ' is PowerShell's escape (the
        # label check already rules it out).
        f.write(SHORTCUT_PS1.replace("@@NAME@@", name.replace("'", "''")).replace("@@LABEL@@", a.label.replace("'", "''")))
    with open(os.path.join(folder, "READ-ME-FIRST.txt"), "w", newline="\r\n") as f:
        f.write(README.format(label=a.label, source=a.source or "(not given)", version=version, name=name))

    sums = []
    for dirpath, _, files in os.walk(folder):
        for fn in files:
            p = os.path.join(dirpath, fn)
            sums.append("%s  %s" % (sha256(p), os.path.relpath(p, folder).replace(os.sep, "/")))
    sums.sort(key=lambda l: l.split("  ", 1)[1])
    with open(os.path.join(folder, "FILE-SHA256SUMS"), "w", newline="\n") as f:
        f.write("\n".join(sums) + "\n")

    zpath = folder + ".zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, files in os.walk(folder):
            for fn in sorted(files):
                p = os.path.join(dirpath, fn)
                z.write(p, os.path.join(base, os.path.relpath(p, folder)).replace(os.sep, "/"))
    with open(os.path.join(out, "SHA256SUMS"), "a", newline="\n") as f:
        f.write("%s  %s\n" % (sha256(zpath), os.path.basename(zpath)))
    print("assembled", folder)
    print("zip", zpath, sha256(zpath))


if __name__ == "__main__":
    main()
