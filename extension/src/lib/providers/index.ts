import type { ChatProvider } from "../types";
import { presetOf, usesTextTools, type Settings } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openai-compat";
import { TextToolsProvider } from "./text-tools";

export function createProvider(settings: Settings): ChatProvider {
  const preset = presetOf(settings.preset);
  const baseUrl = settings.baseUrl || preset.baseUrl;
  if (preset.kind === "anthropic") {
    return new AnthropicProvider({ apiKey: settings.apiKey, baseUrl });
  }
  const provider = new OpenAICompatProvider({
    apiKey: settings.apiKey,
    baseUrl,
    idleTimeoutMs: Math.max(5, settings.requestTimeoutSec || 180) * 1000,
  });
  return usesTextTools(settings) ? new TextToolsProvider(provider) : provider;
}
