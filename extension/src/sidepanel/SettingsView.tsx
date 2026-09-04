import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Palette,
  RefreshCw,
  Sliders,
} from "lucide-react";
import { PRESETS, presetOf, THEMES, type PresetId, type Settings } from "../lib/settings";
import { createProvider } from "../lib/providers";

type Props = {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
};

type TabId = "model" | "appearance" | "behavior";

export function SettingsView({ settings, onSave, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("model");
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = presetOf(draft.preset);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const choosePreset = (id: PresetId) => {
    const p = presetOf(id);
    setDraft((d) => ({ ...d, preset: id, baseUrl: p.baseUrl, model: p.defaultModel, vision: !p.noVision }));
    setModels([]);
    setStatus(null);
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setStatus(null);
    try {
      const list = await createProvider(draft).listModels();
      setModels(list);
      setStatus({ kind: "ok", text: `Connected. ${list.length} models available.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
      await onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim() });
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!draft.model.trim() && (!!draft.apiKey.trim() || !!preset.keyOptional) && !!draft.baseUrl.trim();

  /** Themes preview live, so leaving without saving must put the saved theme back. */
  const close = () => {
    document.documentElement.setAttribute("data-theme", settings.theme || "dark");
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
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {/* TAB 1: MODEL & PROVIDER SETUP */}
        {activeTab === "model" && (
          <Section title="Model Provider Setup">
            <label className="block text-xs text-zinc-400">Provider</label>
            <select
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
            <div className="flex gap-1">
              <input
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                placeholder={preset.keyOptional ? "Leave empty if not needed" : "sk-…"}
                autoComplete="off"
                spellCheck={false}
                className={inputCls}
              />
              <button type="button" onClick={() => setShowKey(!showKey)} className={iconBtn} title={showKey ? "Hide" : "Show"}>
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
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
                  className={inputCls}
                />
              </>
            )}

            <label className="mt-3 block text-xs text-zinc-400">Model</label>
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
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button type="button" onClick={loadModels} disabled={loadingModels} className={iconBtn} title="Test connection and list models">
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
            {status && (
              <p className={`text-xs ${status.kind === "ok" ? "text-enki-400" : "text-red-300"}`}>{status.text}</p>
            )}
            <p className="text-xs text-zinc-500">
              Pick a model that supports tool calling{draft.vision ? " and images" : ""}. Press the refresh button to
              list what your key can access.
            </p>
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
                const selected = (draft.theme || "dark") === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      set("theme", t.id);
                      document.documentElement.setAttribute("data-theme", t.id);
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
            </div>
          </Section>
        )}

        {/* TAB 3: BEHAVIOR & INSTRUCTIONS */}
        {activeTab === "behavior" && (
          <>
            <Section title="Browsing Behavior">
              <Toggle
                label="Model supports images"
                hint="Turn off for text-only models. Enki then works from the page DOM and hides the screenshot tool."
                checked={draft.vision}
                onChange={(v) => set("vision", v)}
              />
              <Toggle
                label="Attach a screenshot to every message"
                hint="Lets Enki see what you see. Costs a few hundred tokens per message."
                checked={draft.vision && draft.attachScreenshot}
                disabled={!draft.vision}
                onChange={(v) => set("attachScreenshot", v)}
              />
              <Toggle
                label="Auto-approve sensitive actions"
                hint="Skip the confirmation card for send / buy / delete style clicks. Not recommended."
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
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-enki-500" : "bg-ink-700"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-4.5" : "left-0.5"}`} />
      </span>
      <span className="flex-1">
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}
