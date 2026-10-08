/**
 * Receive tabs (0.9): "Perguntar ao Enki" on a summary card. The only way a packet's text reaches
 * the assistant, and only on that click: never automatically, never in Act mode (the panel runs
 * this turn in Ask), and always wrapped as untrusted data (lib/agent/untrusted.js).
 *
 * What goes: the agent's name, the title, the domains and the summary, all inside the fence. Not
 * the full link URLs, so nothing invites the assistant to load the sites before the user clicks
 * Abrir. The user's visible question is Enki's fixed text and carries nothing from the packet.
 */
import { wrapUntrusted } from "../agent/untrusted.js";

export const ASK_QUESTION = "O que tem neste pacote de abas que eu recebi? (resumo anexado como dado não confiável)";

export function bundleForAssistant({ agentName, title, summary, hosts }) {
  const text = [
    `Agent: ${agentName}`,
    `Title: ${title}`,
    `Domains: ${hosts.join(", ")}`,
    `Summary: ${summary ? `\n${summary}` : "(none)"}`,
  ].join("\n");
  return {
    question: ASK_QUESTION,
    data: wrapUntrusted({
      source: "enki-receive-tabs",
      origin: "a tab bundle a paired agent sent to this browser (Receive tabs). The agent wrote the name, title and summary; the tabs wait unopened",
      text,
    }),
  };
}
