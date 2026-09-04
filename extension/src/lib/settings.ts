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
};

export const PRESETS: Preset[] = [
  {
    id: "omniroute",
    label: "OmniRoute (free models, local gateway)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    defaultModel: "auto",
    keyOptional: true,
    free: true,
    editableBaseUrl: true,
    noVision: true,
    setupUrl: "https://github.com/diegosouzapw/OmniRoute",
    hint:
      "Open-source gateway that runs on your machine and routes to 150+ free providers automatically. Install and start it first, then come back here. Model \"auto\" picks the best free model; \"auto/cheap\", \"auto/fast\" and \"auto/best-free\" are alternatives. No key needed unless you created one in its dashboard (http://localhost:20128). The free pool has no reliable vision models, so image support is turned off for this preset; Enki works from the page DOM instead. Re-enable it below if you added your own vision-capable keys to OmniRoute.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen3-vl",
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
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "Gemini has a generous free tier via AI Studio.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4.6",
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
  { id: "dark", label: "Enki Dark (default)", description: "The original slate and teal dark theme." },
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
  /** Attach a screenshot of the current tab with every user message (requires vision). */
  attachScreenshot: boolean;
  /** Max tool-call rounds per user request. */
  maxSteps: number;
  /** Extra instructions appended to the system prompt. */
  customInstructions: string;
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
  customInstructions: "",
};

const KEY = "enki:settings";

export function presetOf(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
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
