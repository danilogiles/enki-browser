/**
 * Turns what a model writes — tables, ```chart JSON, ```mindmap lists — into data the chat can draw.
 * No React here, so the unit tests can load it directly.
 */
export type DataSet = { title?: string; labels: string[]; series: Array<{ name: string; data: number[] }> };
export type Kind = "bar" | "line" | "pie" | "table";
export type MapNode = { label: string; children: MapNode[] };

// ---------- numbers as people write them

/**
 * "1.234.567", "1,234,567.5", "45,6%", "R$ 2.300", "-3.2" → numbers; anything else → null.
 * A single separator followed by exactly three digits is read as thousands ("1.234" in a
 * Brazilian table is one thousand two hundred and thirty-four).
 */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\s ]/g, "").replace(/^[^\d+-]*(?=[\d+-])/, "").replace(/[%‰]$|[a-zA-Z$€£¥]+$/g, "");
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // The separator that comes last is the decimal one.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (commas) {
    s = commas === 1 && !/,\d{3}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dots > 1 || /^[+-]?\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A table's data, if at least one column besides the first is numbers all the way down. */
export function dataFromTable(headers: string[], rows: string[][]): DataSet | null {
  if (rows.length < 2 || headers.length < 2) return null;
  const series: DataSet["series"] = [];
  for (let c = 1; c < headers.length; c++) {
    const values = rows.map((r) => parseNumber(r[c] ?? ""));
    if (values.every((v): v is number => v !== null)) series.push({ name: headers[c] || `Series ${c}`, data: values });
  }
  if (!series.length) return null;
  return { labels: rows.map((r) => r[0] ?? ""), series };
}

/** A ```chart block, or null while it is still streaming or malformed. */
export function dataFromSpec(source: string): (DataSet & { type?: Kind }) | null {
  try {
    const spec = JSON.parse(source);
    const labels: string[] = (spec.labels ?? []).map(String);
    const series = (spec.series ?? []).map((s: { name?: string; data?: unknown[] }, i: number) => ({
      name: String(s.name ?? `Series ${i + 1}`),
      data: (s.data ?? []).map((v) => (typeof v === "number" ? v : parseNumber(String(v)) ?? 0)),
    }));
    if (!labels.length || !series.length) return null;
    return { title: spec.title, labels, series, type: ["bar", "line", "pie"].includes(spec.type) ? spec.type : undefined };
  } catch {
    return null;
  }
}

/** "Topic\n- branch\n  - leaf" (bullets optional, two spaces or a tab per level) → a tree. */
export function parseMindmap(source: string): MapNode | null {
  const lines = source.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;
  const clean = (l: string) => l.trim().replace(/^([-*+]|\d+[.)]|#+)\s*/, "").replace(/\*\*/g, "");
  const root: MapNode = { label: clean(lines[0]), children: [] };
  const rest = lines.slice(1).map((l) => ({ indent: l.replace(/\t/g, "  ").match(/^ */)![0].length, label: clean(l) }));
  const base = Math.min(...rest.map((l) => l.indent), Infinity);
  const stack: Array<{ depth: number; node: MapNode }> = [{ depth: -1, node: root }];
  for (const l of rest) {
    const depth = Math.round((l.indent - base) / 2);
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const node = { label: l.label, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  return root;
}

// ---------- taking a chart elsewhere (local only: a clipboard image and a downloaded file)

/** The data as CSV (RFC 4180): a label column, then one column per series, numbers unformatted. */
export function toCsv(data: DataSet): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // A leading = + - @ would run as a formula in a spreadsheet; numbers are written plainly.
    const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [["", ...data.series.map((s) => s.name)], ...data.labels.map((l, i) => [l, ...data.series.map((s) => s.data[i] ?? "")])];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A file name from the chart's title: "Results 2024" → "results-2024.csv". */
export const exportName = (data: DataSet, ext: string) =>
  `${(data.title ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "enki-chart"}.${ext}`;

const EXPORT_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c", "#60a5fa", "#94a3b8"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (n: number) => n.toLocaleString("en", { notation: "compact", maximumFractionDigits: 1 });

/**
 * A self-contained SVG of the chart (bars, line or pie) with literal colors on a dark card, for
 * drawing to a PNG. No fonts, images or links from outside, so drawing it makes no request.
 */
export function chartSvg(data: DataSet, kind: Kind, width = 640): string {
  const pad = 16, top = data.title ? 40 : pad, legend = data.series.length > 1 ? 22 : 0;
  const text = (x: number, y: number, s: string, extra = "") => `<text x="${x}" y="${y}" font-family="sans-serif"${extra.includes("font-size") ? "" : ' font-size="12"'} fill="#d4d4d8" ${extra}>${esc(s)}</text>`;
  let body = "", height: number;
  if (kind === "pie") {
    const values = data.series[0].data, total = values.reduce((a, b) => a + b, 0) || 1;
    const r = 90, c = { x: pad + r, y: top + r };
    let a = -Math.PI / 2;
    values.forEach((v, i) => {
      const a1 = a + (v / total) * Math.PI * 2, end = v === total ? a1 - 0.0001 : a1;
      const p = (t: number) => `${c.x + r * Math.cos(t)},${c.y + r * Math.sin(t)}`;
      body += `<path d="M${c.x},${c.y} L${p(a)} A${r},${r} 0 ${a1 - a > Math.PI ? 1 : 0} 1 ${p(end)} Z" fill="${EXPORT_COLORS[i % 8]}"/>`;
      body += `<rect x="${pad * 2 + r * 2}" y="${top + i * 20}" width="10" height="10" fill="${EXPORT_COLORS[i % 8]}"/>` + text(pad * 2 + r * 2 + 16, top + i * 20 + 10, `${data.labels[i]}: ${((v / total) * 100).toFixed(1)}%`);
      a = a1;
    });
    height = top + Math.max(r * 2, values.length * 20) + pad;
  } else if (kind === "line") {
    const all = data.series.flatMap((s) => s.data), lo = Math.min(0, ...all), hi = Math.max(...all, lo + 1);
    const h = 220, left = pad + 48, n = data.labels.length;
    const x = (i: number) => left + (n === 1 ? (width - left - pad) / 2 : (i * (width - left - pad)) / (n - 1));
    const y = (v: number) => top + ((hi - v) * h) / (hi - lo);
    body += `<line x1="${left}" x2="${width - pad}" y1="${y(lo)}" y2="${y(lo)}" stroke="#3f3f46"/>` + text(left - 6, y(hi) + 4, short(hi), 'text-anchor="end"') + text(left - 6, y(lo) + 4, short(lo), 'text-anchor="end"');
    data.labels.forEach((l, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) body += text(x(i), top + h + 16, l.slice(0, 12), 'text-anchor="middle" font-size="10"'); });
    data.series.forEach((s, j) => { body += `<polyline fill="none" stroke="${EXPORT_COLORS[j % 8]}" stroke-width="2" points="${s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`; });
    height = top + h + 24 + legend + pad;
  } else {
    const all = data.series.flatMap((s) => s.data), max = Math.max(0, ...all), min = Math.min(0, ...all);
    const labelW = Math.min(200, width * 0.3), track = width - pad * 2 - labelW - 70, scale = track / (max - min || 1), zero = pad + labelW + -min * scale;
    const bar = 14, group = data.series.length * (bar + 2) + 8;
    data.labels.forEach((l, i) => {
      const gy = top + i * group;
      body += text(pad, gy + group / 2, l.length > 28 ? `${l.slice(0, 27)}…` : l);
      data.series.forEach((s, j) => {
        const v = s.data[i] ?? 0, w = Math.abs(v) * scale, x0 = v < 0 ? zero - w : zero, by = gy + j * (bar + 2);
        body += `<rect x="${x0}" y="${by}" width="${w}" height="${bar}" rx="2" fill="${EXPORT_COLORS[j % 8]}"/>` + text(x0 + w + 4, by + bar - 3, v.toLocaleString("en"), 'font-size="11"');
      });
    });
    height = top + data.labels.length * group + legend + pad;
  }
  let keys = "";
  if (legend && kind !== "pie") data.series.forEach((s, j) => { keys += `<rect x="${pad + j * 130}" y="${height - pad - 12}" width="10" height="10" fill="${EXPORT_COLORS[j % 8]}"/>` + text(pad + j * 130 + 14, height - pad - 3, s.name.slice(0, 16)); });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="12" fill="#18181b"/>${data.title ? text(pad, 26, data.title, 'font-size="14" font-weight="600"') : ""}${body}${keys}</svg>`;
}
