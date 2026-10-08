// Types for ask.js.
export const ASK_QUESTION: string;
export function bundleForAssistant(input: { agentName: string; title: string; summary?: string; hosts: string[] }): { question: string; data: string };
