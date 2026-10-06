# Code signing policy

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

This page is the project's [SignPath Foundation](https://signpath.org/terms.html)
code signing policy. Until SignPath Foundation approves the application and
signing is wired in CI, **GitHub Releases stay unsigned** (Windows SmartScreen
will still warn; check each download against its `.sha256` file).

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
| **Approvers** (signing requests) | [@danilogiles](https://github.com/danilogiles) (repository owner) | Manually approve each SignPath signing request for a release |

Accounts that use SignPath and this repository use multi-factor authentication,
as SignPath Foundation requires.

## What we sign

Once SignPath Foundation signing is live, Authenticode signatures from the
SignPath Foundation certificate cover **only** PE files this project builds from
its own source:

- `EnkiBrowser.exe` — install-root stub (shortcuts point here)
- `EnkiBrowserLauncher.exe` — per-version launcher / updater
- `EnkiBrowserSetup*.exe` — Windows installer (and the unversioned
  `EnkiBrowserSetup.exe` release alias)

**Not signed** with the SignPath Foundation certificate:

- Upstream `chrome.exe` / other ungoogled-chromium binaries and libraries.
  They are included **unsigned** in the zip and installer package, which
  SignPath Foundation terms allow for upstream OSS binaries. The Foundation
  certificate must not be used on upstream Chrome/Chromium binaries.

Linux packages (`.deb`, tarball) are not Authenticode-signed.

Update manifests (`update.json` / `update.json.sig`) use a separate
RSA-3072 release key held only as a CI secret; that is not Authenticode and is
unchanged by SignPath.

## How signing works (once live)

1. A release tag (or the release path of GitHub Actions) builds Windows
   artifacts from this repository on `windows-latest`.
2. Unsigned Enki PE files and/or the installer are uploaded as a workflow
   artifact and submitted with
   [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request).
3. An **Approver** manually clicks approve in SignPath for that request
   (no fully automatic signing).
4. Signed files are downloaded back into the workflow and published on
   [Releases](https://github.com/danilogiles/enki-browser/releases).

Prefer that GitHub Action over inventing a custom `ENKI_SIGN_COMMAND` for
SignPath. `ENKI_SIGN_COMMAND` remains documented in the README as the generic
hook for other HSM/cloud signers (for example Azure Trusted Signing). The
current build script's optional `ENKI_SIGN_COMMAND` path must **not** be pointed
at the Foundation certificate for `chrome.exe`.

Until SignPath is approved and the workflow above is enabled, releases remain
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
| SignPath Foundation application | Pending (not approved yet) |
| Signed Windows releases | Not yet — first signed release planned as **0.7.10** after approval |
| Unsigned releases meanwhile | Yes — honest: SmartScreen / AV warnings still apply |

## Reporting

Concerns about signing or security: open an issue at
https://github.com/danilogiles/enki-browser/issues or follow [SECURITY.md](SECURITY.md).
