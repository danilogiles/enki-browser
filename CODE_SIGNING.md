# Code signing policy

This page is the project's code signing policy. **GitHub Releases are
currently unsigned** (Windows SmartScreen will still warn; check each download
against its `.sha256` file).

Our [SignPath Foundation](https://signpath.org/terms.html) application was not
approved yet (October 2026): the Foundation looks for more public visibility
than the project has today. We'll reapply once the project has more public
visibility, or pick another signer. This policy applies to whichever signer is
in place.

## Project

| | |
|---|---|
| **Name** | Enki Browser |
| **Repository** | https://github.com/danilogiles/enki-browser |
| **Releases** | https://github.com/danilogiles/enki-browser/releases |
| **License** | [MIT](LICENSE) (OSI-approved; no commercial dual-licensing) |
| **Privacy** | [PRIVACY.md](PRIVACY.md) |

Enki Browser packages [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
with the Enki assistant, Enki Shield, and uBlock Origin Lite. The project's own
code (build scripts, launcher, stub, installer, Shield, defaults) is MIT; bundled
third parties are listed in [THIRD_PARTY.md](THIRD_PARTY.md) under their own
licenses. Builds that may be signed come only from this public repository via
GitHub Actions (`.github/workflows/`).

## Team roles

| Role | Members | Responsibility |
|---|---|---|
| **Authors / Committers** | Danilo Giles de Souza ([@danilogiles](https://github.com/danilogiles)) | Trusted to modify source in this repository |
| **Reviewers** | [@danilogiles](https://github.com/danilogiles), plus reviewers on each pull request | Review changes proposed by others (pull requests) before merge |
| **Approvers** (signing requests) | [@danilogiles](https://github.com/danilogiles) (repository owner) | Approve signing for each release (if SignPath is used, manually approve each signing request) |

Accounts that use the signing service and this repository use multi-factor
authentication (SignPath Foundation requires this too).

## What we sign

Once a signer is in place, Authenticode signatures cover **only** PE files
this project builds from its own source:

- `EnkiBrowser.exe` — install-root stub (shortcuts point here)
- `EnkiBrowserLauncher.exe` — per-version launcher / updater
- `EnkiBrowserSetup*.exe` — Windows installer (and the unversioned
  `EnkiBrowserSetup.exe` release alias)

**Not signed** with the project's certificate:

- Upstream `chrome.exe` / other ungoogled-chromium binaries and libraries.
  They are included **unsigned** in the zip and installer package. If SignPath
  Foundation is used, its terms allow that for upstream OSS binaries, and the
  Foundation certificate must not be used on upstream Chrome/Chromium binaries.

Linux packages (`.deb`, tarball) are not Authenticode-signed.

Update manifests (`update.json` / `update.json.sig`) use a separate
RSA-3072 release key held only as a CI secret; that is not Authenticode and is
unchanged by whichever Authenticode signer is chosen.

## How signing will work (once a signer is in place)

1. A release tag (or the release path of GitHub Actions) builds Windows
   artifacts from this repository on `windows-latest`.
2. The unsigned Enki PE files and/or the installer are signed in CI:
   - if SignPath is used, they are uploaded as a workflow artifact and
     submitted with
     [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request)
     (see `.github/workflows/signpath-signing.yml.example`), and an
     **Approver** manually approves each request (no fully automatic signing);
   - other HSM/cloud signers (for example Azure Trusted Signing) use the
     `ENKI_SIGN_COMMAND` hook documented in the README.
3. Signed files are published on
   [Releases](https://github.com/danilogiles/enki-browser/releases).

Whatever the signer, upstream `chrome.exe` is never submitted for signing, and
`ENKI_SIGN_COMMAND` must **not** be pointed at a SignPath Foundation
certificate for `chrome.exe`.

Until a signer is in place and wired into the release workflow, releases remain
unsigned.

## Privacy

See [PRIVACY.md](PRIVACY.md). The Enki Browser program does not transfer
information to other networked systems except as listed there, or when
specifically requested by the user (or the person installing or operating it).

## Status

| Milestone | State |
|---|---|
| Privacy policy published | Yes — [PRIVACY.md](PRIVACY.md) |
| This code signing policy published | Yes — this file |
| SignPath Foundation application | Not approved yet (Oct 2026); will reapply or pick another signer |
| Signed Windows releases | Not yet — the first signed release will be a version bump after a signer is in place |
| Unsigned releases meanwhile | Yes — honest: SmartScreen / AV warnings still apply |

## Reporting

Concerns about signing or security: open an issue at
https://github.com/danilogiles/enki-browser/issues or follow [SECURITY.md](SECURITY.md).
