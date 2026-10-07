import type { CustomTheme } from "./theme";
import { decrypt, encrypt, isEncrypted } from "./secrets";

export type ProviderKind = "anthropic" | "openai-compatible";

export type PresetId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "openrouter"
  | "nvidia"
  | "omniroute"
  | "ollama"
  | "custom";

export type Preset = {
  id: PresetId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  keyUrl?: string;
  keyOptional?: boolean;
  /** What this provider's keys look like, shown in the empty key field. */
  keyPlaceholder?: string;
  hint?: string;
  /**
   * Official install/run instructions for a preset that needs a local server.
   * A link rather than a copyable command: upstream install steps change, and a stale
   * command baked into the panel is worse than none.
   */
  setupUrl?: string;
  /** Show the base URL field (local or self-hosted servers). */
  editableBaseUrl?: boolean;
  /** Free-tier or local option; highlighted in the picker. */
  free?: boolean;
  /** Selecting this preset turns image support off (models behind it usually reject images). */
  noVision?: boolean;
  /** Compatibility mode starts on for this preset (see providers/text-tools.ts). */
  textTools?: boolean;
  /**
   * Models offered in the Settings dropdown, best first. Model ids are the part people get
   * wrong, and a gateway's own list (480 ids from OmniRoute) does not say which ones work.
   */
  recommended?: ModelSuggestion[];
};

export type ModelSuggestion = { id: string; note: string };

export const PRESETS: Preset[] = [
  {
    // First and the default: the free option that needs nothing installed — just a free key.
    id: "nvidia",
    label: "NVIDIA (Nemotron)",
    kind: "openai-compatible",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
    // The model page has the "Get API Key" button; the key page itself sits behind a sign-in.
    keyUrl: "https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b",
    keyPlaceholder: "nvapi-…",
    free: true,
    noVision: true,
    recommended: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b", note: "most capable · tools · 1M context" },
      { id: "nvidia/nemotron-3-super-120b-a12b", note: "faster · tools" },
      { id: "nvidia/nemotron-3.5-lightning-30b-a3b", note: "fastest" },
    ],
    hint:
      "Free with an NVIDIA Developer account — no credit card. Open the link below, sign in, and press \"Get API Key\". The free tier allows about 40 requests a minute, plenty for browsing; long Act tasks can hit it. Nemotron reads text, not images, so Enki works from the page DOM.",
  },
  {
    id: "omniroute",
    label: "OmniRoute (free models, local gateway)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    // "auto" rotates a keyless pool whose upstreams are mostly blocked, so it failed out of the
    // box. The default is the model that completed live Act tasks through it.
    defaultModel: "cfp/moonshotai/kimi-k2.6",
    recommended: [
      // Each completed a navigate → read → answer task on a live site through OmniRoute 3.8.50.
      { id: "cfp/moonshotai/kimi-k2.6", note: "no key · most thorough for Act tasks" },
      { id: "cfp/moonshotai/kimi-k2.7-code", note: "no key · as thorough, newer" },
      { id: "cfp/zai-org/glm-5.2", note: "no key · good alternative" },
      { id: "cfp/deepseek-ai/deepseek-v4-pro-0813", note: "no key · good alternative" },
      { id: "cfp/deepseek-ai/deepseek-v4-flash-0731", note: "no key · fastest" },
      { id: "auto", note: "rotates providers · works once you connect your own keys" },
    ],
    keyOptional: true,
    free: true,
    editableBaseUrl: true,
    noVision: true,
    textTools: true,
    setupUrl: "https://github.com/diegosouzapw/OmniRoute",
    hint:
      "Open-source gateway that runs on your machine and routes to free providers. Install and start it first, then come back here. Pick a model from Recommended below — the cfp/ models need no key. \"auto\" rotates through a keyless pool that upstream providers block often; it becomes useful once you connect a free key (Gemini, Groq, OpenRouter) in the dashboard at http://localhost:20128. Keyless routes drop tool definitions, so Compatibility mode (Behavior tab) starts on for this preset. The free pool has no reliable vision models, so image support is turned off; Enki works from the page DOM instead.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen3-vl",
    recommended: [
      { id: "qwen3-vl", note: "vision + tools" },
      { id: "qwen3", note: "text only · turn images off in Behavior" },
    ],
    keyOptional: true,
    free: true,
    editableBaseUrl: true,
    setupUrl: "https://github.com/ollama/ollama",
    hint:
      "Runs on your machine, free. Pick a vision-capable model with tool support. Ollama must be started with OLLAMA_ORIGINS=chrome-extension://* so it accepts calls from the extension.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-5",
    recommended: [
      { id: "claude-opus-5", note: "best at multi-step browsing" },
      { id: "claude-sonnet-5", note: "faster, cheaper" },
      { id: "claude-haiku-4-5", note: "fastest, cheapest" },
    ],
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    recommended: [
      { id: "gpt-5", note: "strongest" },
      { id: "gpt-5-mini", note: "faster, cheaper" },
    ],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    recommended: [
      { id: "gemini-2.5-flash", note: "free tier · vision + tools" },
      { id: "gemini-2.5-pro", note: "stronger · lower free limits" },
    ],
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "Gemini has a generous free tier via AI Studio.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
    recommended: [{ id: "meta-llama/llama-4-maverick-17b-128e-instruct", note: "vision + tools · very fast" }],
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4.6",
    recommended: [
      { id: "anthropic/claude-sonnet-4.6", note: "reliable tool use" },
      { id: "openrouter/auto", note: "OpenRouter picks per request" },
      { id: "openrouter/free", note: "free-only router · tools/vision" },
    ],
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai-compatible",
    baseUrl: "",
    defaultModel: "",
    keyOptional: true,
    editableBaseUrl: true,
  },
];

export type ThemeId = "system" | "dark" | "light" | "navy" | "midnight" | "nord" | "cyberpunk" | "custom";

export type ThemeOption = {
  id: ThemeId;
  label: string;
  description: string;
};

export const THEMES: ThemeOption[] = [
  { id: "system", label: "System (default)", description: "Light or dark, following your operating system, like the browser around it." },
  { id: "dark", label: "Dark", description: "Sober near-black with Enki's sky accent." },
  { id: "light", label: "Light", description: "Off-white and soft greys with Enki's sky accent." },
  { id: "navy", label: "Enki Navy", description: "The original look: sky accents on navy." },
  { id: "midnight", label: "Midnight (OLED)", description: "True black with indigo accents and high contrast for OLED screens." },
  { id: "nord", label: "Nord Frost", description: "Soft nordic palette in arctic blues." },
  { id: "cyberpunk", label: "Cyberpunk", description: "Obsidian background with amber and neon gold accents." },
];

export type Settings = {
  preset: PresetId;
  /** The active provider's key; mirrors apiKeys[preset]. */
  apiKey: string;
  /**
   * Each provider's own key. With one shared field, switching from NVIDIA to OpenRouter kept
   * sending the NVIDIA key, and switching back showed OpenRouter's.
   */
  apiKeys?: Partial<Record<PresetId, string>>;
  baseUrl: string;
  model: string;
  theme: ThemeId;
  /** Colours for the "custom" theme (see lib/theme.ts). */
  customTheme?: CustomTheme;
  /** Show the steps of a task (collapsed behind an arrow). Off hides them entirely. */
  showSteps: boolean;
  /** Show the outcome and counts after a reply (collapsed). Off hides them entirely. */
  showRunDetails: boolean;
  /** Skip the confirmation card for sensitive actions (send, buy, delete...). */
  autoApprove: boolean;
  /** The model accepts images. When false, no screenshots are sent and the screenshot tool is hidden. */
  vision: boolean;
  /**
   * Send instructions and tools as plain chat text instead of the system/tools fields, for
   * gateways that drop them. Unset means "the preset's default", so people who saved OmniRoute
   * settings before this existed get it without re-saving.
   */
  textTools?: boolean;
  /** Attach a screenshot of the current tab with every user message (requires vision). */
  attachScreenshot: boolean;
  /** Max tool-call rounds per user request. */
  maxSteps: number;
  /** Give up if the provider sends nothing for this long. Large local models need more. */
  requestTimeoutSec: number;
  /** Show the Logs view and mirror every diagnostic entry to the console. */
  devMode: boolean;
  /** Developer mode only: Enki's own tone rules off; the model's policy is the only filter. */
  unfiltered?: boolean;
  /** The terms version the user acknowledged in the first-use notice (lib/legal.ts). */
  acceptedTerms?: string;
  /** Extra instructions appended to the system prompt. */
  customInstructions: string;
  contextBudgetTokens: number;
  /** Cap on a single agent step's reply. Too low truncates answers mid-sentence. */
  maxOutputTokens: number;
  saveConversations: boolean;
  favoriteModels: string[];
  askModel: string;
  actModel: string;
};

export const DEFAULT_SETTINGS: Settings = {
  preset: "nvidia",
  apiKey: "",
  baseUrl: presetOf("nvidia").baseUrl,
  model: presetOf("nvidia").defaultModel,
  theme: "system",
  showSteps: true,
  showRunDetails: true,
  autoApprove: false,
  // Follows the default preset: Nemotron reads text only.
  vision: !presetOf("nvidia").noVision,
  attachScreenshot: true,
  maxSteps: 30,
  requestTimeoutSec: 180,
  devMode: false,
  customInstructions: "",
  // Today's models take far more than this; 24k stopped ordinary multi-page tasks.
  contextBudgetTokens: 64000,
  maxOutputTokens: 4096,
  saveConversations: true,
  favoriteModels: [],
  askModel: "",
  actModel: "",
};

const KEY = "enki:settings";

export function presetOf(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

/** Compatibility mode applies to OpenAI-compatible endpoints only; Anthropic's API keeps tools. */
export function usesTextTools(settings: Settings): boolean {
  const preset = presetOf(settings.preset);
  if (preset.kind !== "openai-compatible") return false;
  return settings.textTools ?? !!preset.textTools;
}

/** Stored settings → what the app uses: defaults filled in, keys per provider, keys decrypted. */
async function fromStored(raw: Partial<Settings> | undefined): Promise<{ settings: Settings; hadPlainKeys: boolean }> {
  const s: Settings = { ...DEFAULT_SETTINGS, ...raw };
  // 24000 was the old default, kept by everyone who never touched it: give them the new one.
  if (s.contextBudgetTokens === 24000) s.contextBudgetTokens = DEFAULT_SETTINGS.contextBudgetTokens;
  // Before per-provider keys, the one key belonged to whichever provider was selected.
  const stored = raw?.apiKeys ?? (s.apiKey ? { [s.preset]: s.apiKey } : {});
  const keys: Partial<Record<PresetId, string>> = {};
  let hadPlainKeys = false;
  for (const [preset, value] of Object.entries(stored) as Array<[PresetId, string | undefined]>) {
    if (!value) continue;
    if (!isEncrypted(value)) hadPlainKeys = true;
    keys[preset] = await decrypt(value);
  }
  s.apiKeys = keys;
  s.apiKey = keys[s.preset] ?? "";
  return { settings: s, hadPlainKeys };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const { settings, hadPlainKeys } = await fromStored(stored[KEY] as Partial<Settings> | undefined);
  // Keys saved before encryption existed are encrypted the first time they are read.
  if (hadPlainKeys) await saveSettings(settings);
  return settings;
}

/** "nvapi-••••••a1b2": enough to recognise a saved key, never enough to read it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  const prefix = /^([a-z0-9]{2,8}-){1,3}/i.exec(k)?.[0] ?? "";
  return `${prefix}••••••${k.length > prefix.length + 8 ? k.slice(-4) : ""}`;
}

/** Keys go to storage encrypted (lib/secrets.ts), and only in apiKeys: apiKey is derived on load. */
export async function saveSettings(settings: Settings): Promise<void> {
  const keys = { ...(settings.apiKeys ?? {}), [settings.preset]: settings.apiKey };
  const apiKeys: Partial<Record<PresetId, string>> = {};
  for (const [preset, value] of Object.entries(keys) as Array<[PresetId, string | undefined]>) {
    if (value) apiKeys[preset] = await encrypt(value);
  }
  await chrome.storage.local.set({ [KEY]: { ...settings, apiKey: "", apiKeys } });
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) {
      void fromStored(changes[KEY].newValue as Partial<Settings>).then(({ settings }) => cb(settings));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
