// Types for untrusted.js.
export const UNTRUSTED_TAG: "untrusted_data";
export function defang(text: string): string;
export function wrapUntrusted(input: { source: string; origin: string; text: string }): string;
