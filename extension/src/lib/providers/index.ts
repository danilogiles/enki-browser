import type { ChatProvider } from "../types";
import { presetOf, type Settings } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openai-compat";

export function createProvider(settings: Settings): ChatProvider {
  const preset = presetOf(settings.preset);
  const baseUrl = settings.baseUrl || preset.baseUrl;
  if (preset.kind === "anthropic") {
    return new AnthropicProvider({ apiKey: settings.apiKey, baseUrl });
  }
  return new OpenAICompatProvider({ apiKey: settings.apiKey, baseUrl });
}
