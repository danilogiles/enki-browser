/**
 * Theme application shared by the panel and Enki Home.
 *
 * Named themes are CSS (index.css, data-theme). A custom theme is four colours the user picks —
 * background, surface, text, accent — from which every token the UI uses is derived here, so a
 * person choosing colours never has to think about borders, hover states or muted text.
 */
export type CustomTheme = { background: string; surface: string; text: string; accent: string };

/** A sober near-black start for the colour picker, close to the System dark palette. */
export const DEFAULT_CUSTOM_THEME: CustomTheme = { background: "#191a1a", surface: "#222424", text: "#e8e8e6", accent: "#38bdf8" };

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as Rgb;
}

function hex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** `amount` of b mixed into a. */
function mix(a: string, b: string, amount: number): string {
  const [x, y] = [parse(a), parse(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * amount) as Rgb);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const [r, g, b] = parse(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Every token the panel reads, derived from four colours. */
export function customTokens(t: CustomTheme): Record<string, string> {
  const dark = luminance(t.background) < 0.4;
  return {
    "color-scheme": dark ? "dark" : "light",
    "--ink-950": t.background,
    "--ink-900": t.surface,
    "--ink-800": mix(t.surface, t.text, 0.07),
    "--ink-700": mix(t.surface, t.text, 0.16),
    "--zinc-100": t.text,
    "--zinc-200": mix(t.text, t.background, 0.12),
    "--zinc-300": mix(t.text, t.background, 0.25),
    "--zinc-400": mix(t.text, t.background, 0.4),
    "--zinc-500": mix(t.text, t.background, 0.55),
    "--zinc-600": mix(t.text, t.background, 0.68),
    "--enki-400": t.accent,
    "--enki-500": mix(t.accent, t.background, 0.12),
    "--enki-600": mix(t.accent, t.background, 0.25),
    "--app-bg": t.background,
    "--app-text": t.text,
  };
}

/** Applies a theme to a document's root element: a named theme by attribute, a custom one inline. */
export function applyTheme(root: HTMLElement, theme: string, custom?: CustomTheme) {
  root.setAttribute("data-theme", theme || "system");
  for (const name of Object.keys(customTokens(DEFAULT_CUSTOM_THEME))) root.style.removeProperty(name);
  if (theme === "custom" && custom) {
    for (const [name, value] of Object.entries(customTokens(custom))) root.style.setProperty(name, value);
  }
}
