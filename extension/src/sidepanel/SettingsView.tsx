import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Palette,
  Plug,
  RefreshCw,
  Sliders,
  AlertTriangle,
  Ban,
  Info,
  KeyRound,
  Laptop,
  LockOpen,
} from "lucide-react";
import { maskKey, PRESETS, presetOf, THEMES, usesTextTools, type PresetId, type Settings } from "../lib/settings";
import { createProvider } from "../lib/providers";
import { addException, evaluateEndpoint, removeException, type EndpointVerdict } from "../lib/providers/endpoint-policy";
import { ENDPOINT_STRINGS as E, revokeLabel } from "../lib/providers/endpoint-strings";
import { log } from "../lib/debug";
import { diagnoseProvider, type Diagnostic } from "../lib/providers/diagnose";
import { applyTheme, contrast, DEFAULT_CUSTOM_THEME, type CustomTheme } from "../lib/theme";
import { ConnectionsTab } from "./ConnectionsTab";
import { legalLinks } from "../lib/legal";
import { SEARCH_SETTINGS_URL } from "../lib/legacy-search";
import { chooseDdgEngine, chooseEnkiEngine, chooseOtherEngine, enkiOptionText, providerShortName, storedHasModel, SEARCH_OPTION_TEXT, getSearchEngine, onSearchEngineChange, reconcileSearchSetup, SETUP_PENDING_KEY, storageSetupIO, SEARCH_ENGINES_PAGE, SHIELD_EXTENSIONS_PAGE, UBLOCK_EXTENSIONS_PAGE, SHIELD_SEARCH_URL, queryShieldStatus, type ShieldStatus, type SearchEngine } from "../lib/search";

type Props = {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
  /** Revoke deletes the saved HTTP exception for that origin right away (not on Save). */
  onRevokeLocalHttp?: (origin: string) => Promise<void>;
};

type TabId = "model" | "appearance" | "behavior" | "connections";

export function SettingsView({ settings, onSave, onClose, onRevokeLocalHttp }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("model");
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState<Diagnostic[]>([]);
  const [probing, setProbing] = useState(false);
  const probeRef = useRef<AbortController | null>(null);
  useEffect(() => () => probeRef.current?.abort(), []);
  const diagnose = async () => {
    const controller = new AbortController();
    probeRef.current = controller;
    setProbing(true); setChecks([]);
    const timer = setTimeout(() => controller.abort(), Math.min(draft.requestTimeoutSec, 60) * 1000);
    try { setChecks(await diagnoseProvider(draft, controller.signal)); }
    finally { clearTimeout(timer); setProbing(false); }
  };

  const preset = presetOf(draft.preset);
  // The key saved for this provider (shown masked) versus one being typed.
  const [replacingKey, setReplacingKey] = useState(false);
  const savedKey = !replacingKey && draft.apiKey && draft.apiKey === (settings.apiKeys ?? {})[draft.preset] ? draft.apiKey : "";
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const choosePreset = (id: PresetId) => {
    const p = presetOf(id);
    // Each provider keeps its own key: park this one's, bring the other's back.
    setDraft((d) => {
      const apiKeys = { ...(d.apiKeys ?? {}), [d.preset]: d.apiKey };
      return { ...d, apiKeys, apiKey: apiKeys[id] ?? "", preset: id, baseUrl: p.baseUrl, model: p.defaultModel, vision: !p.noVision, textTools: undefined, favoriteModels: [], askModel: "", actModel: "" };
    });
    setReplacingKey(false);
    setModels([]);
    setStatus(null);
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setStatus(null);
    try {
      log.info("settings", `Testing ${draft.baseUrl}`, { preset: draft.preset, hasKey: !!draft.apiKey });
      const list = await createProvider(draft).listModels();
      setModels(list);
      log.info("settings", `Connected, ${list.length} models`, { sample: list.slice(0, 15) });
      setStatus({ kind: "ok", text: `Model list reachable: ${list.length} models. Run diagnostics to verify chat and Act support.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("settings", "Model listing failed", { error: msg });
      // Some gateways (OmniRoute in Docker, for one) require a key to list models but serve
      // chat without one. A failed listing is not proof the endpoint is unusable, so ask the
      // model directly before declaring it broken.
      if (/\b(401|403)\b/.test(msg) && draft.model.trim()) {
        if (await chatWorks(draft)) {
          log.info("settings", "Model listing is gated but chat works");
          setStatus({
            kind: "ok",
            text: "Chat works. This endpoint needs a key only to list models — type the model id by hand.",
          });
          return;
        }
      }
      const offline = /Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg) && preset.setupUrl;
      setStatus({
        kind: "error",
        text: offline
          ? `Could not reach ${draft.baseUrl}. Make sure ${preset.label.replace(/\s*\(.*\)\s*$/, "")} is installed and running — see the install instructions above.`
          : msg,
      });
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim(),
        apiKeys: { ...(draft.apiKeys ?? {}), [draft.preset]: draft.apiKey.trim() },
        favoriteModels: [...new Set(draft.favoriteModels.map((m) => m.trim()).filter(Boolean))], askModel: draft.askModel.trim(), actModel: draft.actModel.trim() });
    } finally {
      setSaving(false);
    }
  };

  // The same policy the request layer enforces (providers/endpoint-policy.ts).
  const endpoint = evaluateEndpoint(draft.baseUrl, { hasKey: !!draft.apiKey.trim(), exceptions: draft.localHttpOrigins });
  const canSave = !!draft.model.trim() && (!!draft.apiKey.trim() || !!preset.keyOptional) && !!draft.baseUrl.trim() && endpoint.allowed;
  const setLocalHttp = (on: boolean) => setDraft((d) => ({ ...d,
    localHttpOrigins: on ? addException(d.localHttpOrigins, d.baseUrl) : removeException(d.localHttpOrigins, d.baseUrl) }));
  const revoke = async (origin: string) => {
    setDraft((d) => ({ ...d, localHttpOrigins: removeException(d.localHttpOrigins, origin) }));
    await onRevokeLocalHttp?.(origin);
  };

  /** Themes preview live, so leaving without saving must put the saved theme back. */
  const close = () => {
    applyTheme(document.documentElement, settings.theme || "system", settings.customTheme);
    onClose();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <button type="button" onClick={close} className="rounded-md p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-100" title="Back">
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold">Settings</span>
      </header>

      <SearchEngineControl settings={settings} />

      {/* Navigation Tabs */}
      <div className="flex border-b border-ink-700 bg-ink-900/60 px-3 pt-1">
        <TabButton
          active={activeTab === "model"}
          onClick={() => setActiveTab("model")}
          icon={<Bot size={14} />}
          label="Model"
        />
        <TabButton
          active={activeTab === "appearance"}
          onClick={() => setActiveTab("appearance")}
          icon={<Palette size={14} />}
          label="Appearance"
        />
        <TabButton
          active={activeTab === "behavior"}
          onClick={() => setActiveTab("behavior")}
          icon={<Sliders size={14} />}
          label="Behavior"
        />
        <TabButton
          active={activeTab === "connections"}
          onClick={() => setActiveTab("connections")}
          icon={<Plug size={14} />}
          label="Connections"
        />
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {activeTab === "connections" && <ConnectionsTab />}
        {/* TAB 1: MODEL & PROVIDER SETUP */}
        {activeTab === "model" && (
          <Section title="Model Provider Setup">
            <label className="block text-xs text-zinc-400">Provider</label>
            <select
              aria-label="Provider"
              disabled={probing}
              value={draft.preset}
              onChange={(e) => choosePreset(e.target.value as PresetId)}
              className={inputCls}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.free ? " · free" : ""}
                </option>
              ))}
            </select>
            {preset.hint && <p className="text-xs text-zinc-500">{preset.hint}</p>}
            {draft.preset !== settings.preset && (
              <p className="text-xs text-amber-200">
                Model IDs are provider-specific, so changing provider clears your favorites and any preferred Ask/Act
                models. Close Settings without saving to keep them.
              </p>
            )}
            {preset.setupUrl && (
              <a
                href={preset.setupUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-enki-400 hover:underline"
              >
                Install instructions <ExternalLink size={11} />
              </a>
            )}

            <label className="mt-3 block text-xs text-zinc-400">
              API key {preset.keyOptional && <span className="text-zinc-600">(optional)</span>}
            </label>
            {savedKey && !replacingKey ? (
              // A saved key is never shown again, only recognised: replace it or remove it.
              <div className="flex items-center gap-1">
                <span aria-label="Saved API key" className={`${inputCls} font-mono text-zinc-300`}>{maskKey(savedKey)}</span>
                <button type="button" onClick={() => { setReplacingKey(true); set("apiKey", ""); }} className={`${iconBtn} py-1.5 text-xs`}>Replace</button>
                <button type="button" onClick={() => { set("apiKey", ""); setDraft((d) => ({ ...d, apiKey: "", apiKeys: { ...(d.apiKeys ?? {}), [d.preset]: "" } })); setReplacingKey(true); }} className={`${iconBtn} py-1.5 text-xs`}>Remove</button>
              </div>
            ) : (
              <div className="flex gap-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                  placeholder={preset.keyOptional ? "Leave empty if not needed" : preset.keyPlaceholder ?? "sk-…"}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="API key"
                  className={inputCls}
                />
                <button type="button" onClick={() => setShowKey(!showKey)} className={iconBtn} title={showKey ? "Hide what you are typing" : "Show what you are typing"}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            )}
            {preset.keyUrl && (
              <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-enki-400 hover:underline">
                Get a key <ExternalLink size={11} />
              </a>
            )}
            <p className="text-xs text-zinc-500">
              Keys are stored locally in this browser and sent only to the provider above.
            </p>

            {preset.editableBaseUrl && (
              <>
                <label className="mt-3 block text-xs text-zinc-400">Base URL</label>
                <input
                  type="text"
                  value={draft.baseUrl}
                  onChange={(e) => set("baseUrl", e.target.value)}
                  placeholder="https://host/v1"
                  spellCheck={false}
                  aria-label="Base URL"
                  className={inputCls}
                />
              </>
            )}
            <EndpointPolicy verdict={endpoint} onToggle={setLocalHttp} onRevoke={(o) => { void revoke(o); }} />

            <label className="mt-3 block text-xs text-zinc-400">Model</label>
            {!!preset.recommended?.length && (
              <select
                aria-label="Recommended models"
                value={preset.recommended.some((r) => r.id === draft.model) ? draft.model : ""}
                onChange={(e) => e.target.value && set("model", e.target.value)}
                className={inputCls}
              >
                <option value="">Other model — type or pick it below</option>
                <optgroup label="Recommended">
                  {preset.recommended.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} — {r.note}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
            <div className="flex gap-1">
              <input
                type="text"
                list="enki-models"
                value={draft.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder={preset.defaultModel || "model id"}
                spellCheck={false}
                className={inputCls}
              />
              <datalist id="enki-models">
                {/* Recommended first, so they show before the refresh and on top after it. */}
                {preset.recommended?.map((r) => (
                  <option key={`rec:${r.id}`} value={r.id} label={`★ ${r.note}`} />
                ))}
                {models.filter((m) => !preset.recommended?.some((r) => r.id === m)).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button type="button" onClick={loadModels} disabled={loadingModels || !endpoint.allowed} className={iconBtn} title="Test connection and list models">
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
            {status && (
              <p className={`text-xs ${status.kind === "ok" ? "text-enki-400" : "text-red-300"}`}>{status.text}</p>
            )}
            <p className="text-xs text-zinc-500">
              {preset.recommended?.length ? "Start with a recommended model. For anything else, pick" : "Pick"} a model that
              supports tool calling{draft.vision ? " and images" : ""}. Press the refresh button to list what your key can access.
            </p>
            <div className="border-t border-ink-700 pt-3">
              <button type="button" disabled={probing || !canSave} onClick={diagnose} className="rounded border border-ink-700 px-3 py-2 text-enki-400 disabled:opacity-50">{probing ? "Testing gateway and model…" : "Run connection diagnostics"}</button>
              {probing && <button type="button" className="ml-2 underline" onClick={() => probeRef.current?.abort()}>Cancel test</button>}
              <p className="mt-2 text-xs text-zinc-400">Sends one small synthetic request to the selected model. No page data or browser actions.</p>
              <ul aria-live="polite" className="mt-2 space-y-2 text-xs">{checks.map((c) => <li key={c.label}><strong className={c.state === "pass" ? "text-enki-400" : c.state === "fail" ? "text-red-300" : "text-amber-200"}>{c.label}: {c.state === "unknown" ? "unverified" : c.state}</strong><div className="text-zinc-400">{c.detail}</div></li>)}</ul>
            </div>
            <label className="mt-3 block text-xs text-zinc-400" htmlFor="favorite-models">Favorite models (one per line)</label>
            <textarea id="favorite-models" rows={3} value={draft.favoriteModels.join("\n")} onChange={(e) => set("favoriteModels", e.target.value.split("\n"))} className={inputCls} />
            <label htmlFor="ask-model" className="block text-xs text-zinc-400">Preferred Ask model (optional)</label>
            <input id="ask-model" list="enki-models" value={draft.askModel} onChange={(e) => set("askModel", e.target.value)} className={inputCls} />
            <label htmlFor="act-model" className="block text-xs text-zinc-400">Preferred Act model (optional)</label>
            <input id="act-model" list="enki-models" value={draft.actModel} onChange={(e) => set("actModel", e.target.value)} className={inputCls} />
            <p className="text-xs text-zinc-400">Switching Ask/Act selects its preferred model on this provider. Blank keeps the current model.</p>
          </Section>
        )}

        {/* TAB 2: APPEARANCE & THEMES */}
        {activeTab === "appearance" && (
          <Section title="Themes">
            <p className="text-xs text-zinc-400 mb-2">
              Pick the panel's theme. The preview is immediate; press Save to keep it.
            </p>
            <div className="grid grid-cols-1 gap-2.5">
              {THEMES.map((t) => {
                const selected = (draft.theme || "system") === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      set("theme", t.id);
                      applyTheme(document.documentElement, t.id, draft.customTheme);
                    }}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-enki-500 bg-enki-500/10 ring-1 ring-enki-500/30"
                        : "border-ink-700 bg-ink-900/60 hover:border-ink-700/80 hover:bg-ink-800/50"
                    }`}
                  >
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-ink-700">
                      {selected && <div className="h-2 w-2 rounded-full bg-enki-400" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-zinc-100">{t.label}</span>
                        {selected && <Check size={14} className="text-enki-400" />}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">{t.description}</p>
                    </div>
                  </button>
                );
              })}
              <CustomColors
                selected={draft.theme === "custom"}
                value={draft.customTheme ?? DEFAULT_CUSTOM_THEME}
                onChange={(c) => {
                  setDraft((d) => ({ ...d, theme: "custom", customTheme: c }));
                  applyTheme(document.documentElement, "custom", c);
                }}
              />
            </div>
          </Section>
        )}

        {/* TAB 3: BEHAVIOR & INSTRUCTIONS */}
        {activeTab === "behavior" && (
          <>
            <Section title="Chat">
              <Toggle label="Show task steps" hint="What Enki did to answer (reading, clicking, typing), folded behind an arrow under each reply. Off hides them entirely; a sensitive action still asks for approval." checked={draft.showSteps !== false} onChange={(v) => set("showSteps", v)} />
              <Toggle label="Show reply details" hint="The outcome after each reply (done, steps that failed, notices), folded behind an arrow. Off hides it; errors are always shown." checked={draft.showRunDetails !== false} onChange={(v) => set("showRunDetails", v)} />
            </Section>
            <Section title="Browsing Behavior">
              <Toggle label="Save conversations on this device" hint="Keeps your chats on this device, listed under ⋯ in the panel. Screenshots and reasoning are not saved. Turning off removes every saved chat." checked={draft.saveConversations} onChange={(v) => set("saveConversations", v)} />
              <label htmlFor="context-budget" className="block text-xs text-zinc-400">Input context budget (estimated tokens)</label>
              <input id="context-budget" type="number" min={6000} max={200000} step={1000} value={draft.contextBudgetTokens} onChange={(e) => set("contextBudgetTokens", Math.max(6000, Math.min(200000, Number(e.target.value) || 64000)))} className={inputCls} />
              <p className="text-xs text-zinc-400">Older exchanges are summarized locally. Tool calls stay paired with results. Leave room for the model's response within its context limit.</p>
              <label htmlFor="max-output" className="block text-xs text-zinc-400">Max output tokens per step</label>
              <input id="max-output" type="number" min={512} max={32000} step={512} value={draft.maxOutputTokens} onChange={(e) => set("maxOutputTokens", Math.max(512, Math.min(32000, Number(e.target.value) || 4096)))} className={inputCls} />
              <p className="text-xs text-zinc-400">Caps a single reply. A truncated answer cannot be resumed, so Enki says when it hits this limit. Raise it for long summaries; lower it to keep free-tier costs down.</p>
              <button type="button" className="text-enki-400 underline" onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>Customize keyboard shortcuts</button>
              <p className="text-xs text-zinc-400">Assign Open panel, Focus composer, Stop task, and New chat in Chrome. Escape stops a task while the panel has focus.</p>
              <Toggle
                label="Model supports images"
                hint="Turn off for text-only models. Enki then works from the page DOM and hides the screenshot tool."
                checked={draft.vision}
                onChange={(v) => set("vision", v)}
              />
              <Toggle
                label="Compatibility mode (tools as plain text)"
                hint="For gateways that drop tool definitions and the system prompt, such as OmniRoute's keyless routes. Enki sends its instructions and tools inside the chat and reads the model's JSON replies as tool calls. Leave off for providers with native tool calling."
                checked={usesTextTools(draft)}
                disabled={preset.kind !== "openai-compatible"}
                onChange={(v) => set("textTools", v)}
              />
              <Toggle
                label="Attach a screenshot to every message"
                hint="Off by default. Lets Enki see what you see: a picture of the tab goes to your AI provider with each message, and costs a few hundred tokens."
                checked={draft.vision && draft.attachScreenshot}
                disabled={!draft.vision}
                onChange={(v) => set("attachScreenshot", v)}
              />
              <Toggle
                label="Auto-approve sensitive actions"
                hint="Skip the card for send / buy / delete style clicks only. Never skips page-requested actions, new sites, downloads, uploads, account changes, sensitive typing, or anything in Incognito."
                checked={draft.autoApprove}
                onChange={(v) => set("autoApprove", v)}
              />
              <label className="mt-2 block text-xs text-zinc-400">Max steps per request</label>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.maxSteps}
                onChange={(e) => set("maxSteps", Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className={`${inputCls} w-24`}
              />
              <label className="mt-3 block text-xs text-zinc-400">Response timeout (seconds)</label>
              <input
                type="number"
                min={5}
                max={900}
                value={draft.requestTimeoutSec}
                onChange={(e) => set("requestTimeoutSec", Math.max(5, Math.min(900, Number(e.target.value) || 180)))}
                className={`${inputCls} w-24`}
              />
              <p className="text-xs text-zinc-500">
                Give up if the model sends nothing for this long. Raise it for large local models on slower hardware.
              </p>
            </Section>

            <Section title="Developer">
              <Toggle
                label="Developer mode"
                hint="Adds a Logs button to the header and mirrors every request, tool call and error to the browser console."
                checked={draft.devMode}
                onChange={(v) => set("devMode", v)}
              />
              {draft.devMode && (
                <Toggle
                  label="Unfiltered"
                  hint="Turns off Enki's own tone rules: blunt, no disclaimers or moralizing, profanity allowed, no dodging crude or adult topics. Your model's own policy is then the only filter. The safety rules for acting in the browser stay on."
                  checked={!!draft.unfiltered}
                  onChange={(v) => set("unfiltered", v)}
                />
              )}
            </Section>

            <Section title="Custom instructions">
              <textarea
                value={draft.customInstructions}
                onChange={(e) => set("customInstructions", e.target.value)}
                rows={4}
                placeholder="e.g. Always answer in Portuguese. I'm a developer; be technical."
                className={`${inputCls} resize-y`}
              />
            </Section>

            <Section title="About">
              <p className="text-xs text-zinc-400">
                Enki {chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version} ·{" "}
                <a className="underline" href={legalLinks().terms} target="_blank" rel="noreferrer">Terms of Use</a> ·{" "}
                <a className="underline" href={legalLinks().privacy} target="_blank" rel="noreferrer">Privacy Policy</a> ·{" "}
                <a className="underline" href="https://github.com/danilogiles/enki-browser" target="_blank" rel="noreferrer">Source code</a>
              </p>
              <div className="mt-2 flex gap-4">
                {/* Enki Shield owns the updater (only its origin may talk to the launcher), so this
                    opens its settings at #check-updates, which starts the check at once. */}
                <button
                  type="button"
                  className="text-xs font-medium text-enki-400 underline"
                  onClick={() => chrome.tabs.create({ url: "chrome-extension://aacambieennepbgemjkpailjdkldbjjf/options.html#check-updates" })}
                >
                  Check for updates
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-enki-400 underline"
                  onClick={() => chrome.tabs.create({ url: "chrome-extension://aacambieennepbgemjkpailjdkldbjjf/welcome.html" })}
                >
                  {/* In the guide's language (shield/welcome.js): "Ver o guia de novo" in Portuguese. */}
                  {navigator.language.startsWith("pt") ? "Ver o guia de novo" : navigator.language.startsWith("es") ? "Ver la guía otra vez" : "Show the guide again"}
                </button>
              </div>
            </Section>
          </>
        )}
      </div>

      <div className="border-t border-ink-700 px-4 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="w-full rounded-lg bg-enki-500 py-2 text-sm font-medium text-ink-950 transition hover:bg-enki-400 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/**
 * The model address's HTTP state (Ink's 05a–05e). Only shown for plain HTTP; HTTPS shows nothing.
 * Amber is a state the user chose (HTTP allowed); the soft error tone is a refusal Enki makes.
 */
export function EndpointPolicy({ verdict, onToggle, onRevoke }: {
  verdict: EndpointVerdict;
  onToggle: (on: boolean) => void;
  onRevoke: (origin: string) => void;
}) {
  const scope = <p className="flex items-start gap-1.5 text-xs text-zinc-500"><Info size={13} className="mt-0.5 shrink-0" />{E.scope}</p>;
  const err = (icon: ReactNode, title: string, body: string, extra?: ReactNode) => (
    <div role="alert" data-endpoint={verdict.state} className="flex items-start gap-2 rounded-md border border-[#e8928d]/70 px-2.5 py-2 text-xs text-[#f2b8b5]">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span><b className="block text-[13px]">{title}</b>{body}{extra}</span>
    </div>
  );
  switch (verdict.state) {
    case "loopback":
      return (
        <div data-endpoint="loopback" className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-enki-500/40 bg-enki-500/10 px-2 py-0.5 text-xs text-enki-400"><Laptop size={13} />{E.loopChip}</span>
          <p className="flex items-start gap-1.5 text-xs text-zinc-400"><Check size={13} className="mt-0.5 shrink-0 text-enki-400" />{E.loopNoteDesktop}</p>
          {scope}
        </div>
      );
    case "private-off":
    case "private-on": {
      const on = verdict.state === "private-on";
      return (
        <div data-endpoint={verdict.state} className="space-y-2">
          <div className={`rounded-md border px-2.5 py-2 ${on ? "border-amber-400/45 bg-[#2e2a1c]" : "border-ink-700 bg-ink-900"}`}>
            <div className="flex items-start justify-between gap-3">
              <span>
                <span id="local-http-label" className="block text-xs text-zinc-100">{E.toggle}</span>
                <span className="block font-mono text-[11px] text-zinc-400">{verdict.origin}</span>
              </span>
              <button type="button" role="switch" aria-checked={on} aria-labelledby="local-http-label" onClick={() => onToggle(!on)}
                className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-amber-400" : "bg-ink-700"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? "left-4.5" : "left-0.5"}`} />
              </button>
            </div>
            {on
              ? <p role="note" className="mt-2 flex items-start gap-1.5 text-xs text-[#cfae43]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{E.warn}</p>
              : <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-400"><Ban size={13} className="mt-0.5 shrink-0" />{E.offNote}</p>}
          </div>
          {on && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-[#2e2a1c] px-2 py-0.5 text-xs text-amber-200"><LockOpen size={13} />{E.httpChip}</span>
              <span className="font-mono text-[11px] text-zinc-400">{verdict.hostPort}</span>
              <button type="button" aria-label={revokeLabel(verdict.hostPort)} onClick={() => onRevoke(verdict.origin)} className="ml-auto rounded px-2 py-0.5 text-xs text-amber-200 underline hover:bg-ink-800">{E.revoke}</button>
            </div>
          )}
          {scope}
        </div>
      );
    }
    case "hostname":
      return (<div className="space-y-2">{err(<Ban size={15} />, E.refusedTitle, E.refusedBody,
        <><span className="mt-1.5 block">{E.refusedHint}</span><code className="mt-1.5 block font-mono">{E.refusedExample}</code></>)}{scope}</div>);
    case "public":
      return (<div className="space-y-2">{err(<Ban size={15} />, E.publicTitle, E.publicBody)}{scope}</div>);
    case "key-over-http":
      return err(<KeyRound size={15} />, E.keyTitle, E.keyBody, <span className="mt-1.5 block">{E.keyHint}</span>);
    default:
      return null;
  }
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
        active
          ? "border-enki-500 text-enki-400"
          : "border-transparent text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Sends the smallest possible request to see whether the endpoint answers at all. */
async function chatWorks(draft: Settings): Promise<boolean> {
  try {
    for await (const ev of createProvider(draft).stream({
      model: draft.model.trim(),
      system: "Reply with the single word: ok",
      messages: [{ role: "user", parts: [{ type: "text", text: "ok" }] }],
      tools: [],
      maxTokens: 16,
    })) {
      if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "tool_call") return true;
      if (ev.type === "done") return false;
    }
    return false;
  } catch (e) {
    log.error("settings", "Chat probe failed", { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

const inputCls =
  "w-full rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-enki-500/60";
const iconBtn =
  "shrink-0 rounded-md border border-ink-700 bg-ink-900 px-2 text-zinc-400 transition hover:text-zinc-100 disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 py-1 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-enki-500" : "bg-ink-700"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-4.5" : "left-0.5"}`} />
      </button>
      <span className="flex-1">
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * "Your colors": four colours, from which lib/theme.ts derives every other token. The preview
 * is the panel itself (it repaints as you pick), and a warning appears when the text would be hard
 * to read on the background — WCAG's 4.5:1 for body text.
 */
function CustomColors({ selected, value, onChange }: { selected: boolean; value: CustomTheme; onChange: (c: CustomTheme) => void }) {
  const fields: Array<[keyof CustomTheme, string]> = [
    ["background", "Background"],
    ["surface", "Cards and inputs"],
    ["text", "Text"],
    ["accent", "Accent"],
  ];
  const readable = contrast(value.text, value.background) >= 4.5;
  return (
    <div className={`rounded-xl border p-3 transition ${selected ? "border-enki-500 bg-enki-500/10 ring-1 ring-enki-500/30" : "border-ink-700 bg-ink-900/60"}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-zinc-100">Your colors</span>
        {selected && <Check size={14} className="text-enki-400" />}
      </div>
      <p className="mt-0.5 text-xs text-zinc-400">Pick four colours; Enki works out the rest. Changes preview right away — press Save to keep them.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {fields.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/40 px-2 py-1.5 text-xs text-zinc-300">
            <input
              type="color"
              aria-label={label}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="min-w-0 truncate">{label}</span>
          </label>
        ))}
      </div>
      {!readable && <p className="mt-2 text-xs text-amber-300">Text and background are too close to read comfortably. Pick a lighter or darker text colour.</p>}
      <button type="button" onClick={() => onChange(DEFAULT_CUSTOM_THEME)} className="mt-2 text-xs text-zinc-400 underline hover:text-zinc-200">
        {selected ? "Reset to the sober dark start" : "Use your own colors"}
      </button>
    </div>
  );
}

/**
 * "Search engine: Enki AI | DuckDuckGo" (0.8.9, Ink's v2 mocks 09-settings-states and 05's
 * checklist). Same setting as Shields' switch (lib/search.ts), applied at once. Enki AI is saved
 * only when Shield confirms incognito access; the default-search step is guidance and never blocks.
 */
function SearchEngineControl({ settings }: { settings: Settings }) {
  const hasModel = storedHasModel(settings);
  const provider = providerShortName(settings);
  const [engine, setEngine] = useState<SearchEngine | undefined>();
  const [changed, setChanged] = useState(false);
  /** undefined: not asked yet; null: Shield off or not answering. */
  const [status, setStatus] = useState<ShieldStatus | null | undefined>(undefined);
  /** Enki AI was requested and waits for both setup steps (enki:searchSetupPending). */
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const send = (id: string, msg: unknown) => chrome.runtime.sendMessage(id, msg);
  useEffect(() => {
    void getSearchEngine().then(setEngine);
    void storageSetupIO.getPending().then((p) => { setPending(p); setOpen(p); });
    const offEngine = onSearchEngineChange(setEngine);
    const onPending = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && SETUP_PENDING_KEY in changes) setPending(changes[SETUP_PENDING_KEY].newValue === true);
    };
    chrome.storage.onChanged.addListener(onPending);
    return () => { offEngine(); chrome.storage.onChanged.removeListener(onPending); };
  }, []);
  // Ask Shield again when Settings opens and whenever the panel comes back into focus, then
  // finish a pending request (both steps done) or pause Enki AI (incognito access removed).
  useEffect(() => {
    const refresh = async () => {
      const st = await queryShieldStatus(send);
      setStatus(st);
      const r = await reconcileSearchSetup(st, await getSearchEngine(), storageSetupIO, storedHasModel(settings));
      if (r === "enabled") { setEngine("enki"); setPending(false); setOpen(false); setChanged(true); }
      if (r === "paused") { setEngine("ddg"); setPending(true); setOpen(true); setChanged(false); }
    };
    const onFocus = () => void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  useEffect(() => {
    if (!changed) return;
    const t = setTimeout(() => setChanged(false), 2000);
    return () => clearTimeout(t);
  }, [changed]);
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(SHIELD_SEARCH_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused: the URL is in the field to copy by hand */ }
  };
  const current = engine ?? "ddg";
  const shieldOff = status === null;
  const choose = async (v: SearchEngine) => {
    // Selecting never touches the network beyond asking Shield (a local extension message).
    if (v === "enki") {
      if (shieldOff || current === "enki") return;
      const r = await chooseEnkiEngine({ ...storageSetupIO, send, hasModel });
      setStatus(r.status);
      if (r.result === "enabled") { setEngine("enki"); setPending(false); setOpen(false); setChanged(true); }
      else if (r.result === "pending") { setEngine("ddg"); setPending(true); setOpen(true); setChanged(false); }
      return;
    }
    if (current === v && !pending) return;
    if (v === "other") await chooseOtherEngine(storageSetupIO);
    else await chooseDdgEngine(storageSetupIO);
    setEngine(v);
    setPending(false);
    setOpen(false);
    setChanged(true);
  };
  const doneCount = status ? Number(status.allowed) + Number(status.searchSetupDone) : 0;
  const showSetup = !!status && pending && current !== "enki";
  /** The card shows the person's choice: Enki AI picked but setup unfinished is shown selected with
   *  its checklist, while the address bar keeps using DuckDuckGo until both steps are done. */
  const shown: SearchEngine = pending && current !== "enki" && hasModel && !shieldOff ? "enki" : current;
  const option = (v: SearchEngine, label: ReactNode, text: string, extra?: ReactNode) => (
    <div key={v} className={`rounded-xl border p-3 ${shown === v ? "border-[#38bdf8] bg-[#38bdf8]/10" : "border-ink-700"}`}>
      <button type="button" role="radio" aria-checked={shown === v} data-engine={v} disabled={v === "enki" && (shieldOff || !hasModel)} onClick={() => void choose(v)}
        className="flex w-full items-start gap-2 text-left disabled:opacity-45">
        <span className={`mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${shown === v ? "border-[#38bdf8] bg-[#38bdf8]" : "border-[#5f6468]"}`} />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-zinc-100">{label}</span>
          <span className={`block text-xs ${v === "enki" && !hasModel ? "text-zinc-500" : "text-zinc-400"}`}>{text}</span>
        </span>
      </button>
      {extra}
    </div>
  );
  return (
    <div className="border-b border-ink-700 px-4 py-3 text-sm">
      <div className="font-semibold text-zinc-200">Search engine</div>
      <p className="mb-2 text-xs text-zinc-400">Choose where your address-bar searches go.</p>
      <div role="radiogroup" aria-label="Search engine" className="space-y-2">
        {option("ddg", <>DuckDuckGo <span className="ml-1 rounded border border-[#38bdf8]/60 px-1 text-[10px] font-semibold text-[#38bdf8]">Default</span></>, SEARCH_OPTION_TEXT.ddg)}
        {option("enki", "Enki AI", enkiOptionText(provider, hasModel), <>
          {!hasModel && (
          <p className="mt-2 ml-5 text-xs text-zinc-200">
            Set up a model first{" "}
            <button type="button" disabled={shieldOff} onClick={() => void choose("enki")} className="ml-1 text-[#38bdf8] hover:underline disabled:opacity-45">Open Settings</button>
          </p>
          )}
          {showSetup && (
            <div className="mt-2 ml-5 border-t border-ink-700 pt-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="block text-xs text-[#38bdf8] hover:underline">
          Finish setup ({doneCount} of 2 done) {open ? "⌄" : "›"}
        </button>
        <p className="mt-1 text-xs text-zinc-400">Until then, searches go to DuckDuckGo.</p>
      {open && status && (
        <ol className="mt-2 space-y-3 rounded-xl border border-ink-700 bg-ink-800/60 p-3 text-xs">
          <SetupItem done={status.allowed} title="Allow Enki Shield in Incognito">
            <p className="text-zinc-400">So private windows always search with DuckDuckGo.</p>
            <button type="button" onClick={() => void chrome.tabs.create({ url: SHIELD_EXTENSIONS_PAGE })}
              className="mt-1.5 h-7 rounded-lg border border-ink-700 px-3 text-zinc-200 hover:bg-ink-800">Open Shield details</button>
          </SetupItem>
          <SetupItem done={status.searchSetupDone} title="Make Enki your default search">
            <ol className="ml-4 list-decimal space-y-1 leading-relaxed text-zinc-200">
              <li>
                Open{" "}
                <button type="button" onClick={() => void chrome.tabs.create({ url: SEARCH_ENGINES_PAGE })} title="Open search engine settings"
                  className="rounded bg-[#2a2c2c] px-1 font-mono text-[11px] text-[#38bdf8] hover:underline">{SEARCH_ENGINES_PAGE}</button>
              </li>
              <li>Next to Site search, click Add</li>
              <li>
                Name: Enki · Shortcut: enki · URL:
                <span className="mt-1 flex items-center gap-2">
                  <input readOnly aria-label="Search URL" value={SHIELD_SEARCH_URL} onFocus={(e) => e.currentTarget.select()}
                    className="h-7 min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-2 font-mono text-[11px] text-zinc-200" />
                  <button type="button" onClick={() => void copyUrl()} className="h-7 shrink-0 rounded-lg border border-ink-700 px-3 text-zinc-200 hover:bg-ink-800">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </span>
              </li>
              <li>Click Add, then ⋮ next to Enki › Make default</li>
            </ol>
            <p className="mt-1.5 text-zinc-400">Checks itself after your first search.</p>
          </SetupItem>
        </ol>
      )}
      {open && status && (
        /* Not a step: no checkbox and not in the n-of-2 count. Opens only on click. */
        <p data-testid="ublock-incognito" className="mt-2 text-xs text-zinc-500">
          For ad blocking in private windows, also allow uBlock Origin Lite in Incognito.{" "}
          <button type="button" onClick={() => void chrome.tabs.create({ url: UBLOCK_EXTENSIONS_PAGE })}
            className="ml-1 text-[#38bdf8] hover:underline">Open uBlock settings</button>
        </p>
      )}
            </div>
          )}
        </>)}
        {option("other", "Other search engine", SEARCH_OPTION_TEXT.other, shown === "other" && (
          <div className="mt-2 ml-5 border-t border-ink-700 pt-2 text-xs">
            <p className="text-zinc-300">{SEARCH_OPTION_TEXT.otherHowTo}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {/* Opens only on this click: the page fetches other engines' icons as it loads. */}
              <button type="button" onClick={() => void chrome.tabs.create({ url: SEARCH_SETTINGS_URL })}
                className="h-7 rounded-lg border border-ink-700 px-3 font-semibold text-zinc-200 hover:bg-ink-800">Open search engine settings</button>
              <span className="text-zinc-500">{SEARCH_OPTION_TEXT.otherIcons}</span>
            </div>
          </div>
        ))}
      </div>
      {shieldOff && <p role="alert" className="mt-2 text-xs text-zinc-400">Turn on Enki Shield to use AI search</p>}
      {!shieldOff && changed && <p role="status" className="mt-2 text-xs text-zinc-400">Search engine changed</p>}
      {!shieldOff && current === "enki" && <p className="mt-2 text-xs text-zinc-200">Tip: start with @enki or @ddg to choose for one search</p>}
    </div>
  );
}

function SetupItem({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-label={done ? "Done" : "Not done"}
        className={`mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${done ? "border-[#22c55e] bg-[#22c55e] text-[#06131c]" : "border-[#5f6468]"}`}>
        {done ? "✓" : ""}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-zinc-200">
          {title}
          {done && <span className="ml-2 text-xs font-semibold text-[#22c55e]">Done</span>}
        </div>
        {children}
      </div>
    </li>
  );
}
