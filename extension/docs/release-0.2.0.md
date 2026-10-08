# Enki 0.2.0

Act mode now exposes request progress, cancels pending approvals correctly, and stops after repeated tool failures. Local gateway requests time out before headers as well as during idle streams.

This release adds local conversation restore, bounded context with extractive summaries, a configurable output cap that reports its own truncation, safe continuation, a controlled-tab selector, model favorites and Ask/Act defaults, connection diagnostics, safe diagnostic exports, editable browser shortcuts, and tool-result completion summaries.

Saved conversations never restart browser actions automatically. Continue refreshes the page before asking the model to resume. Password checks, URL restrictions and sensitive-action approvals remain enforced. Read-only mode now also rejects unexpected modifying calls at execution time. A task locks to one tab for its duration, but only the agent's own switch/new-tab tools pin a tab beyond it — otherwise the next task follows your active tab again. Saved conversations and the unredacted in-panel log buffer are described in `docs/SECURITY.md`.

Install: extract `enki-v0.2.0.zip` into a folder and load it unpacked in `chrome://extensions`. Existing users can reload the rebuilt `dist` folder. This is an unpacked release, not a Chrome Web Store update.

Validation: TypeScript and production build, core regression checks, and Chromium browser suites covering normal actions, provider failures and the new recovery/settings flows. No production OmniRoute requests or real purchases are used in these tests.
