# Code signing policy

This page is the project's code signing policy. Since **0.8.3** (October 8, 2026), Enki's own
three Windows programs (`EnkiBrowser.exe`, `EnkiBrowserLauncher.exe` and
`EnkiBrowserSetup-<version>.exe`) carry an **Authenticode signature** whose publisher is
**Danilo De Souza**. The bundled ungoogled-chromium files, `chrome.exe` included, stay unsigned on
purpose: we never sign code that isn't ours. The three programs are signed in GitHub Actions with
[Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/), and only after a
maintainer approves the signing step. Releases up to 0.8.2 are unsigned.

A signature tells you who published a file and that it has not changed since. It does not stop
Windows SmartScreen from warning for the first days of a new certificate, until the signature
builds reputation; whatever you see, you can check each download against its `.sha256` file.

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
licenses. Signed builds come only from this public repository, built by GitHub
Actions ([`.github/workflows/build.yml`](.github/workflows/build.yml)).

## Team roles

| Role | Members | Responsibility |
|---|---|---|
| **Authors / Committers** | Danilo Giles de Souza ([@danilogiles](https://github.com/danilogiles)) | Trusted to modify source in this repository |
| **Reviewers** | [@danilogiles](https://github.com/danilogiles), plus reviewers on each pull request | Review changes proposed by others (pull requests) before merge |
| **Approvers** (signing) | [@danilogiles](https://github.com/danilogiles) (repository owner) | Approve each signing run in the `code-signing` environment, and each publication in the `release` environment |

Accounts with access to the signing service and to this repository use
multi-factor authentication.

## The certificate

| | |
|---|---|
| **Service** | Azure Artifact Signing (Basic), account `enkisigning`, certificate profile `enki-public` (Public Trust) |
| **Publisher (subject)** | `CN=Danilo De Souza, O=Danilo De Souza, L=Mississauga, S=ON, C=CA`, an individual identity validated by Microsoft |
| **Digest** | SHA-256 |
| **Timestamp** | RFC 3161, SHA-256, from `http://timestamp.acs.microsoft.com` |

The certificates are short-lived and Microsoft rotates them automatically, so the
certificate on one release can differ from the next while the publisher stays the
same. Every signature is timestamped, which keeps it valid after its certificate
expires.

## What we sign

**Only Enki's own three programs are signed**, the PE files this project builds
from its own source:

- `EnkiBrowser.exe`, the install-root stub that shortcuts point to (description "Enki Browser")
- `EnkiBrowserLauncher.exe`, the per-version launcher and updater
- `EnkiBrowserSetup-<version>.exe`, the Windows installer (description "Enki Browser Setup"),
  and its unversioned `EnkiBrowserSetup.exe` copy on each release

The portable `EnkiBrowser-<version>-windows-x64.zip` (also what Scoop and the
self-updater install) contains the same signed stub and launcher.

**Unsigned on purpose:** every bundled ungoogled-chromium file, **`chrome.exe`
included**, and its other binaries and libraries. They ship as upstream publishes
them. We never sign code that isn't ours: our certificate vouches only for code
this project wrote and built.

The workflow enforces both rules: its verification step fails the build if any
ungoogled-chromium file carries our certificate, or if any of the Enki programs
above lacks a valid, timestamped signature.

Not Authenticode, and unchanged by it:

- Linux packages (`.deb`, tarball) are not Authenticode-signed.
- macOS builds are signed ad hoc and not notarized (README, "macOS").
- Update manifests (`update.json` / `update.json.sig`) are signed with a
  separate RSA-3072 release key, `UPDATE_SIGNING_KEY`, held only as a GitHub
  Actions secret. That is what installed browsers trust for updates.

## How signing works

The `windows-signed` job in [`.github/workflows/build.yml`](.github/workflows/build.yml):

1. Runs only for a `v*` tag, or a manual run on `main` with *sign* ticked; never
   for pull requests, forks or other branches. Builds from those stay unsigned.
   `v*` tags can be created only by repository admins (the `release-tags` ruleset).
2. Runs in the protected `code-signing` environment: a required reviewer must
   approve each run, with no admin bypass.
3. Signs in to Azure with GitHub OIDC through a federated credential on the
   Entra app `enki-browser-code-signing`. There is no client secret. The
   credential trusts one subject only, the `code-signing` environment of this
   repository, in GitHub's immutable format (the repository was created after
   July 15, 2026):
   `repo:danilogiles@53487221/enki-browser@1389999821:environment:code-signing`.
   The app holds the signer role on the `enki-public` certificate profile and
   nothing else.
4. Builds the stub and the launcher, signs those two by path, packs the zip and
   the installer around them, signs the installer, and writes the `.sha256` files
   over the signed bytes. The signing action is
   [`azure/artifact-signing-action`](https://github.com/azure/artifact-signing-action)
   (v2.0.0) after [`azure/login`](https://github.com/azure/login) (v3.1.0), both
   pinned by commit SHA.
5. Verifies every signature and timestamp (and that no Chromium file is signed),
   then runs the same end-to-end tests as the unsigned build.

The `release` job then publishes only the signed Windows build, after a second
approval in the `release` environment. With signing configured, there is no
silent fallback to an unsigned release.

`ENKI_SIGN_COMMAND` (README, "Code signing policy") remains the build's generic
hook for other signers; the `windows-signed` job leaves it empty, so Azure is the
only signer, and it must never be pointed at upstream files.

### SignPath Foundation

An earlier version of this policy was written for a
[SignPath Foundation](https://signpath.org) application, which was not approved
(October 2026: the Foundation looks for more public visibility than the project
had). With Azure Artifact Signing in place it is no longer needed and is paused.
[`signpath-signing.yml.example`](.github/workflows/signpath-signing.yml.example)
is kept only as a reference.

## Check a signature

In Windows, right-click the downloaded `EnkiBrowserSetup-<version>.exe` (or
`EnkiBrowser.exe` in your install folder) → **Properties** → **Digital
Signatures**: the signer is **Danilo De Souza**, with a timestamp. *Details* →
*View Certificate* shows the full subject above.

Or in PowerShell:

```powershell
Get-AuthenticodeSignature .\EnkiBrowserSetup-0.8.3.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```

`Status` must be `Valid`, the signer's subject must start with
`CN=Danilo De Souza`, and `TimeStamperCertificate` must be present. A Windows
program from a release with any other signer, or none (from 0.8.3 on), did not
come from this project's release workflow: do not run it, and please
[report it](SECURITY.md).

## Privacy

See [PRIVACY.md](PRIVACY.md). The Enki Browser program does not transfer
information to other networked systems except as listed there, or when
specifically requested by the user (or the person installing or operating it).

## Status

| Milestone | State |
|---|---|
| Privacy policy published | Yes — [PRIVACY.md](PRIVACY.md) |
| This code signing policy published | Yes — this file |
| Signed Windows releases | Yes, since [0.8.3](https://github.com/danilogiles/enki-browser/releases/tag/v0.8.3) (Azure Artifact Signing, publisher Danilo De Souza) |
| SmartScreen reputation | Building: a warning may still appear for the first days after the first signed release |
| SignPath Foundation application | Not approved (October 2026); no longer needed, paused |
| macOS notarization | Not yet: ad hoc signature only (needs an Apple Developer account) |

## Reporting

Concerns about signing or security: open an issue at
https://github.com/danilogiles/enki-browser/issues or follow [SECURITY.md](SECURITY.md).
