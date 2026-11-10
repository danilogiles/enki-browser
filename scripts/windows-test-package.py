#!/usr/bin/env python3
"""Assembles a private, test-isolated Windows test copy of Enki Browser from a CI build.

    python3 scripts/windows-test-package.py <EnkiBrowser-<v>-windows-x64.zip> --label <id> [--out DIR]

Input: the portable zip the Windows build (build/build.mjs) produces, whose top folder is
EnkiBrowser\\ (EnkiBrowser.exe, current, app\\<version>\\EnkiBrowserLauncher.exe, chromium\\chrome.exe).
Output, in DIR (default: the current folder):
    Enki-LiveChat-<id>-Windows-x64\\
        EnkiBrowser\\               the CI build, unchanged, plus two marker files:
            test-isolated          own profile (EnkiBrowser\\User Data); no native host, Apps entry,
                                   browser registration, updates, or uninstall of the real install's
                                   shortcuts/registry/profile (launcher/Common.cs, Isolation)
            no-update              belt and braces: updates off for any launcher that reads it
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
import os
import re
import shutil
import sys
import zipfile

MARKER = "test-isolated"
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

Do NOT use these in this copy's Enki Shield settings: "Check for updates", "Restart to update",
default browser, protected video (Widevine). The copy does not register its own native host, so
Chromium would reach the REAL install's host (same extension id) and act on the real install.

Unsigned by the release signing workflow; Windows may warn. If it blocks, stop and report the exact
text; do not disable protections. Not launched on Windows by its assembler unless stated otherwise.
Cleanup: close the test browser, delete its shortcut and this folder (its profile is inside; remove
saved voice configuration first, since the profile holds your locally encrypted key).
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("zip", help="EnkiBrowser-<version>-windows-x64.zip from the Windows build")
    ap.add_argument("--label", required=True, help="short id, e.g. the commit (letters, digits, - and . only)")
    ap.add_argument("--source", default="", help="source commit / CI run, written to the notes")
    ap.add_argument("--out", default=".", help="output folder")
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9.\-]{1,40}", a.label):
        fail("--label may contain only letters, digits, '-' and '.'")

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
        for exe in (TOP + "EnkiBrowser.exe", app + "EnkiBrowserLauncher.exe", app + "EnkiBrowser.exe"):
            if exe in names and not knows_marker(z.read(exe)):
                fail("%s does not know the %s marker (a build from before this change): refusing, it would "
                     "register itself and use the real profile" % (exe, MARKER))
        os.makedirs(folder)
        z.extractall(folder)

    root = os.path.join(folder, "EnkiBrowser")
    for marker, text in ((MARKER, "Private test copy: own profile, no native host, registration or updates (launcher/Common.cs).\n"),
                         ("no-update", "Updates off for this test copy.\n")):
        with open(os.path.join(root, marker), "w", newline="\r\n") as f:
            f.write(text)
    for stray in ("portable",):  # portable mode adds --disable-machine-id; not wanted here
        p = os.path.join(root, stray)
        if os.path.exists(p):
            os.remove(p)
    with open(os.path.join(folder, "Create-Test-Shortcut.ps1"), "w", newline="\r\n") as f:
        f.write(SHORTCUT_PS1.replace("@@NAME@@", name).replace("@@LABEL@@", a.label))
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
