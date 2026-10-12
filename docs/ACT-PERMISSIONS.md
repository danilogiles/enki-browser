# Extension permissions inventory (issue #52)

Every entry in `extension/manifest.config.ts` and the code that uses it (main @ 0.8.7, extension 0.3.x).
A unit test (`extension/test/unit.cjs`) fails if the manifest gains a permission that is not listed here.

## `permissions`

| Permission | Used by | Why |
|---|---|---|
| `sidePanel` | manifest `side_panel`, `background/service-worker.ts` | The assistant panel. |
| `activeTab` | toolbar click / `open-panel` command | Temporary access to the invoked tab (Ask about this page). |
| `tabs` | `lib/tools/executor.ts` `currentTab` (L98–104), `read_url` fallback (L130–146), `sendToTab` (L157, L190), list tabs (L408), navigate (L451–455, L482), switch tab (L576–578), open tab (L598–601); `sidepanel/App.tsx` tab picker (L236–263); `background/service-worker.ts` (L25, L83–86) | URLs/titles of tabs Enki was not invoked on; follow tab changes. |
| `scripting` | `executor.ts` re-inject content script (L180), DuckDuckGo fallback reader (L422) | Inject into a tab after install/update or into a background tab. |
| `storage` | `lib/settings.ts`, `history.ts`, `secrets.ts`, … | Local settings, chats, keys. |
| `debugger` | `executor.ts` attach/sendCommand/detach (L207, L216, L257) | Trusted clicks and key input for Act. |
| `webNavigation` | `lib/connectors/oauth.ts` (L111, L121) | Catch the OAuth redirect for MCP connectors. |

## `host_permissions: ["<all_urls>"]` and `content_scripts.matches: ["<all_urls>"]`

| Path | Code | What breaks without it |
|---|---|---|
| Content script on every page (snapshot, click, type, read) | manifest `content_scripts`; `executor.ts` `tabs.sendMessage` L168 | Act/Ask on any page not yet granted. |
| Screenshot | `executor.ts` `captureVisibleTab` L329 | Works only for the `activeTab`-invoked tab. |
| Navigate to a model-chosen URL then keep working | `executor.ts` L453 then content script | Stops at every new origin. |
| `read_url` | `executor.ts` cross-origin `fetch` L121, background-tab fallback L139–146 | "Open this link and summarise it". |
| `web_search` | `tools/web.ts` L17 (html.duckduckgo.com), L35 (search.brave.com) | Web search in Ask and Act. |
| LLM providers incl. custom OpenAI-compatible endpoints and **Ollama on localhost** | `providers/openai-compat.ts` L37, L79 | BYOM: any endpoint without CORS headers. |
| MCP servers | `connectors/mcp.ts` L51 | Connectors. |
| OAuth metadata / registration / token | `connectors/oauth.ts` L38, L82, L137 | Connecting MCP apps. |

Receive tabs' own set (`alarms`, `tabGroups`, relay host) is unchanged by #52.

Decision: see the #52 decision note — the current set stays, with the threat it accepts documented there.
