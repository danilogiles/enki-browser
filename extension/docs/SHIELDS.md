# Enki Shields — Privacy Defaults

Product-approved defaults (Helm sign-off, 2026-09-21). Source of truth for Cloak + Blink until implemented in the Chromium shell.

**Status**
- **Extension (now):** host-browser shields apply; Enki does not implement network filtering. See interim notes below.
- **Full browser (phase 2 / privacy pack):** defaults below become ship targets with Blink.

Inspiration: Brave + DuckDuckGo privacy **posture**. Implementation: open-source lists and Chromium flags only — no proprietary code.

---

## Defaults (locked)

| Shield | Default | User can change | Notes |
|---|---|---|---|
| Tracker blocking | **On** — Standard | Standard / Aggressive / Off | Native **list-based** MVP (EasyList / EasyPrivacy-class or other open lists). In-process; MIT/Apache clean-room. |
| Ad blocking | **On** (with Standard) | Tied to tracker tiers; Off available | Cosmetic filtering can follow later. |
| HTTPS | **Always upgrade** | Per-site exception | Rare exceptions list; warn on plain HTTP. |
| Fingerprint resistance | **Standard** | Off / Standard / Strict | Document breakage: Strict may break banks/CAPTCHA/canvas apps — we refuse to “win” fingerprinting by breaking core shopping/auth by default. |
| Default search | **DuckDuckGo** | Yes | Product lock; escalate to Helm if contested. |
| Third-party cookies | **Blocked / partitioned** | Yes | Prefer browser-native partitioning where available. |
| WebRTC IP leak | Mitigate when proxy set | Yes | Document in shell release notes. |
| Product telemetry | **Off** | N/A | No spy telemetry. |
| Crash reports | **Off** | Opt-in only | Same-PR docs if ever added. |
| Companion Mode | **Off** | Opt-in after kill-criteria | See SECURITY.md §4. |
| Safe Browsing | Google SB + disclosure (interim) | — | Until Cloak substitute exists. |

---

## Extension-era interim

1. Enki MV3 does **not** intercept third-party trackers itself. Users on Brave/Firefox/etc. keep their browser shields.
2. Enki must **not** disable or bypass host privacy features.
3. Settings / privacy copy (target UX): *“Page context is sent to your chosen model provider only when you Ask or Act.”* (egress chip with Spark — P0 UX).
4. New-tab tool fallback currently opens `https://google.com` when no URL is given (`executor.ts`) — prefer a privacy-neutral default (e.g. DDG or NTP) in a follow-up with Spark; not a silent telemetry issue, but a product smell.

---

## Phase map

| Phase | Work | Owners |
|---|---|---|
| **P0 (now)** | Docs (this file + SECURITY companion kill-criteria); no-analytics / egress audit; pair Spark on Ask/Act egress chip | Cloak (+ Spark) |
| **P1 (shell alpha)** | HTTPS-Only default, DuckDuckGo default search, tracker list MVP, fingerprint Standard profile, extension permission review UX | Cloak + Blink |
| **P2** | Strict fingerprint mode, cosmetic filtering, WebRTC hardening, SB substitute evaluation | Cloak + Blink |

---

## Breakage policy (fingerprint)

- **Standard:** reduce common high-entropy vectors without aiming for identical fingerprints across all users; prefer site compatibility for login, checkout, and government sites.
- **Strict:** stronger resistance; expected breakage is disclosed in UI before enabling.
- We do **not** claim “unfingerprintable” in marketing.

---

## Licensing reminder

Open lists + clean-room patches (MIT/Apache or equivalent). Brave MPL or other copyleft browser code → legal review before import.
