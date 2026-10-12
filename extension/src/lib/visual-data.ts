/**
 * Turns what a model writes — tables, ```chart JSON, ```mindmap lists — into data the chat can draw.
 * No React here, so the unit tests can load it directly.
 */
export type DataSet = { title?: string; labelName?: string; labels: string[]; series: Array<{ name: string; data: number[] }> };
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
  return { labelName: headers[0] || undefined, labels: rows.map((r) => r[0] ?? ""), series };
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

// ---------- taking a chart elsewhere: CSV and a standalone picture

/** Round axis steps (1, 2, 2.5, 5 × 10ⁿ) covering [min, max], with 0 included for all-positive data. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min > 0 && min / max < 0.5) min = 0;
  if (max === min) { max += Math.abs(max) || 1; min -= Math.abs(min) || 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** The data as CSV: the label column, then one column per series; numbers unformatted, so a spreadsheet reads them as numbers. */
export function toCsv(data: DataSet): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [[data.labelName ?? "", ...data.series.map((s) => s.name)], ...data.labels.map((l, i) => [l, ...data.series.map((s) => s.data[i])])];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 });
const tick = (n: number) => n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

/**
 * The chart as a self-contained SVG on white, for pasting into a document or a message: the
 * panel's own charts use the theme's CSS variables (and the bars are HTML), so they cannot be
 * copied as they are. `palette` holds plain colours. A table is pictured as bars.
 */
export function chartSvg(data: DataSet, kind: Kind, palette: string[]): string {
  const W = 640, font = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
  const color = (i: number) => palette[i % palette.length];
  const parts: string[] = [];
  let y = 16;
  if (data.title) { parts.push(`<text x="16" y="${y + 14}" font-size="16" font-weight="600" fill="#111">${esc(data.title)}</text>`); y += 30; }
  const legend = () => {
    if (data.series.length < 2) return;
    let x = 16;
    for (const [i, s] of data.series.entries()) {
      parts.push(`<rect x="${x}" y="${y + 2}" width="10" height="10" rx="2" fill="${color(i)}"/><text x="${x + 14}" y="${y + 11}" font-size="12" fill="#333">${esc(short(s.name, 30))}</text>`);
      x += 24 + Math.min(30, s.name.length) * 7;
    }
    y += 22;
  };
  if (kind === "pie") {
    const values = data.series[0].data, total = values.reduce((a, b) => a + b, 0) || 1;
    const r = 90, inner = 52, cx = 16 + r, cy = y + r;
    let a = -Math.PI / 2;
    const p = (ang: number, rr: number) => `${(cx + rr * Math.cos(ang)).toFixed(2)},${(cy + rr * Math.sin(ang)).toFixed(2)}`;
    values.forEach((v, i) => {
      const a0 = a, a1 = a + (v / total) * Math.PI * 2;
      a = a1;
      const end = v === total ? a1 - 0.0001 : a1, large = a1 - a0 > Math.PI ? 1 : 0;
      parts.push(`<path d="M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(end, r)} L${p(end, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)} Z" fill="${color(i)}"/>`);
    });
    data.labels.forEach((l, i) => {
      const ly = y + 8 + i * 20;
      parts.push(`<rect x="${cx + r + 30}" y="${ly}" width="10" height="10" rx="2" fill="${color(i)}"/><text x="${cx + r + 46}" y="${ly + 9}" font-size="12" fill="#333">${esc(short(l, 34))}</text><text x="${W - 16}" y="${ly + 9}" font-size="12" fill="#555" text-anchor="end">${((values[i] / total) * 100).toFixed(1)}%</text>`);
    });
    y += Math.max(2 * r, data.labels.length * 20 + 8) + 16;
  } else if (kind === "line") {
    legend();
    const all = data.series.flatMap((s) => s.data), ticks = niceTicks(Math.min(...all), Math.max(...all));
    const lo = ticks[0], hi = ticks[ticks.length - 1], H = 240, left = 16 + Math.max(...ticks.map((t) => tick(t).length)) * 7, right = 16, top = y, bottom = y + H - 24;
    const n = data.labels.length;
    const X = (i: number) => left + (n === 1 ? (W - left - right) / 2 : (i * (W - left - right)) / (n - 1));
    const Y = (v: number) => top + ((hi - v) * (bottom - top)) / (hi - lo || 1);
    for (const t of ticks) parts.push(`<line x1="${left}" x2="${W - right}" y1="${Y(t)}" y2="${Y(t)}" stroke="#ddd"/><text x="${left - 6}" y="${Y(t) + 4}" font-size="11" fill="#666" text-anchor="end">${tick(t)}</text>`);
    const every = Math.ceil(n / Math.max(2, Math.floor((W - left) / 70)));
    data.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) parts.push(`<text x="${X(i)}" y="${bottom + 18}" font-size="11" fill="#666" text-anchor="middle">${esc(short(l, 12))}</text>`); });
    data.series.forEach((s, j) => parts.push(`<polyline fill="none" stroke="${color(j)}" stroke-width="2.5" stroke-linejoin="round" points="${s.data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`));
    y += H + 8;
  } else {
    legend();
    const all = data.series.flatMap((s) => s.data), max = Math.max(0, ...all), min = Math.min(0, ...all);
    const labelW = 170, area = W - 16 - labelW - 16 - 90, span = (max - min || 1) / area, zero = 16 + labelW + -min / span;
    data.labels.forEach((l, i) => {
      parts.push(`<text x="${16 + labelW - 8}" y="${y + 12}" font-size="12" fill="#333" text-anchor="end">${esc(short(l, 24))}</text>`);
      data.series.forEach((s, j) => {
        const v = s.data[i], w = Math.max(Math.abs(v) / span, 1), x = v >= 0 ? zero : zero - w;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y + 2}" width="${w.toFixed(1)}" height="12" rx="2" fill="${color(j)}"/><text x="${(v >= 0 ? x + w + 6 : x - 6).toFixed(1)}" y="${y + 12}" font-size="11" fill="#444" text-anchor="${v >= 0 ? "start" : "end"}">${num(v)}</text>`);
        y += 16;
      });
      y += 6;
    });
    y += 10;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" ${font}><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
}
