export type ProviderKind = "anthropic" | "openai-compatible";

export type PresetId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "openrouter"
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

export type ThemeId = "dark" | "light" | "system" | "midnight" | "nord" | "cyberpunk";

export type ThemeOption = {
  id: ThemeId;
  label: string;
  description: string;
};

export const THEMES: ThemeOption[] = [
  { id: "dark", label: "Enki Dark (default)", description: "Trust Buddy sky accents on navy chrome." },
  { id: "light", label: "Light", description: "Clean white background with dark text and contrasts." },
  { id: "system", label: "System (auto)", description: "Follows your operating system's light or dark setting." },
  { id: "midnight", label: "Midnight (OLED)", description: "True black with indigo accents and high contrast for OLED screens." },
  { id: "nord", label: "Nord Frost", description: "Soft nordic palette in arctic blues." },
  { id: "cyberpunk", label: "Cyberpunk", description: "Obsidian background with amber and neon gold accents." },
];

export type Settings = {
  preset: PresetId;
  apiKey: string;
  baseUrl: string;
  model: string;
  theme: ThemeId;
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
  preset: "anthropic",
  apiKey: "",
  baseUrl: presetOf("anthropic").baseUrl,
  model: presetOf("anthropic").defaultModel,
  theme: "dark",
  autoApprove: false,
  vision: true,
  attachScreenshot: true,
  maxSteps: 30,
  requestTimeoutSec: 180,
  devMode: false,
  customInstructions: "",
  contextBudgetTokens: 24000,
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

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
