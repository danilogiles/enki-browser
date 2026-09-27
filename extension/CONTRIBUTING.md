# Contributing to Enki

Thanks for helping. Enki is an open-source AI assistant for Chromium browsers, built in the open
so anyone can check what it sends, where, and why.

*Português e español são bem-vindos em issues e discussões — escreva na língua em que você se
expressa melhor.*

## Where you can help

Everything in this repository runs as a browser extension, so **you do not need to build
Chromium to contribute**. Node.js and any Chromium browser (Chrome, Brave, Edge, Chromium) are
enough.

| Area | Where it lives | Good for |
|---|---|---|
| Model providers and gateways | `src/lib/providers/` | Adding a provider, handling a gateway's quirks |
| Agent loop and prompts | `src/lib/agent/` | Reliability with weak or free models |
| Browser tools | `src/lib/tools/`, `src/content/` | New tools, better page snapshots |
| Side panel UI | `src/sidepanel/` | UX, accessibility, themes |
| Safety | `executor.ts`, `loop.ts`, `docs/SECURITY.md` | Prompt-injection defenses and tests |
| Translations and docs | `README.md`, `docs/` | Portuguese, Spanish and more |

Issues labelled **good first issue** are small and well described. If you want to take one,
comment on it so two people don't do the same work.

## Getting started

```bash
git clone https://github.com/danilogiles/enkibrowser.git
cd enkibrowser
npm install
npm run build
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked),
then open the panel with `Ctrl+Shift+E`. For hot reload while editing, use `npm run dev`.

No API key? Pick **OmniRoute** in Settings for free models through a local gateway (see
[docker/README.md](docker/README.md)), or **Ollama** for a fully local model.

## Tests

```bash
npm run typecheck        # must be clean
npm run test:unit        # fast, no browser

npm run mock             # in a second terminal: a scripted model the suites below talk to
npm run test:e2e         # the extension in Chromium: Ask, Act, approval card, password gate
npm run test:resilience  # badly-behaved models: stalls, reasoning-only replies, ignored tools
npm run test:quality     # restore, Continue, tab locking, keyboard commands, narrow panel
```

The browser suites need Playwright's Chromium once: `npx playwright install chromium`. CI runs
all of them on every pull request.

## What a pull request needs

- **Typecheck and every suite pass.** CI will tell you; running them locally is faster.
- **You ran it.** Say what you did in the browser and what happened. "Should work" is not a
  result. Add a screenshot for anything visible.
- **One concern per PR.** A fix and an unrelated refactor are two PRs.
- **A commit message that says why.** What changed and why it matters, in prose. Comments in
  code explain *why*, especially when the obvious approach was tried and rejected.
- **A sign-off on every commit** (`git commit -s`). It states that you wrote the change or have
  the right to submit it under the project's license — the
  [Developer Certificate of Origin](https://developercertificate.org). No CLA to sign.

## Rules that are not negotiable

These protect people who trust Enki with their browser. A PR that weakens them will not be
merged, however useful the rest is.

1. **Never type into password fields.** Keep the `isPassword` checks in `executor.ts` and
   `content-script.ts`.
2. **Only `http:` and `https:` navigation.** Keep `isValidWebNavigationUrl`.
3. **Sensitive actions ask first.** Keep the `SENSITIVE_ACTION` confirmation in `executor.ts`
   and `loop.ts`.
4. **Page text is data, not instructions.** Nothing a web page says may change what the agent
   is allowed to do.
5. **No telemetry.** Data goes only to the provider the user chose. Never log API keys or
   `Authorization` headers.
6. **Keep dependencies minimal.** The OpenAI-compatible adapter is plain `fetch` + SSE on
   purpose. Ask in an issue before adding a runtime dependency.

[AGENTS.md](AGENTS.md) has the architecture in more depth, and is also what AI coding assistants
should read before touching the code.

## Security issues

**Do not open a public issue for a vulnerability.** Use GitHub's
[private vulnerability reporting](https://github.com/danilogiles/enkibrowser/security/advisories/new)
so it can be fixed before it is public. Prompt-injection pages that make Enki do something the
user did not ask for count as vulnerabilities.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Enki is [MIT licensed](LICENSE). By contributing you agree your contribution is released under
the same license.
