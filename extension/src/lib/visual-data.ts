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
