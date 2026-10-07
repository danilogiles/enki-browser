/**
 * Charts and mind maps inside answers.
 *
 * A markdown table with numbers becomes a chart on its own: the model only has to put the data
 * in a table, which it does reliably, and the user gets a picture with tabs to see it as bars,
 * a line, a pie or the plain table. A fenced ```chart block (JSON) covers data with no table, and
 * a ```mindmap block (an indented list) draws a map. Everything is drawn here, without a charting
 * library: the panel is small and these four shapes are all it needs.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";

import { dataFromSpec, dataFromTable, parseMindmap, type DataSet, type Kind, type MapNode } from "../lib/visual-data";

const PALETTE = ["var(--color-enki-400)", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c", "#60a5fa", "#94a3b8"];

const looksLikeTime = (labels: string[]) => labels.length >= 3 && labels.every((l) => /^(\d{4}|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|\d{4}-\d{2}(-\d{2})?|Q[1-4]\b.*|(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)\w*\.?(\s*\/?\s*\d{2,4})?)$/i.test(l.trim()));
// A pie shows shares of the first numeric column (votes before percentages, as tables put them).
const pieFits = (d: DataSet) => d.labels.length <= 12 && d.series[0].data.every((v) => v >= 0) && d.series[0].data.some((v) => v > 0);

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 });
const compact = (n: number) => n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Votes next to percentages: on one axis the smaller series would be a sliver, so show one at a time. */
const scalesDiffer = (d: DataSet) => {
  const peaks = d.series.map((s) => Math.max(...s.data.map(Math.abs)) || 1);
  return d.series.length > 1 && Math.max(...peaks) / Math.min(...peaks) > 10;
};

/** Round axis steps (1, 2, 2.5, 5 × 10ⁿ) covering [min, max], with 0 included for all-positive data. */
function niceTicks(min: number, max: number, count = 4): number[] {
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

// ---------- the chart card with its mini-tabs

export function DataView({ data, prefer, table }: { data: DataSet; prefer?: Kind; table?: ReactNode }) {
  const kinds: Kind[] = ["bar", "line", ...(pieFits(data) ? (["pie"] as Kind[]) : []), "table"];
  const initial: Kind = prefer && kinds.includes(prefer) ? prefer : looksLikeTime(data.labels) ? "line" : "bar";
  const [kind, setKind] = useState<Kind>(initial);
  const mixed = scalesDiffer(data);
  const [active, setActive] = useState(0);
  const shown: DataSet = mixed ? { ...data, series: [data.series[active]] } : data;
  const names: Record<Kind, string> = { bar: "Bar", line: "Line", pie: "Pie", table: "Table" };
  return (
    <figure className="enki-visual my-2 rounded-xl border border-ink-700 bg-ink-900/60 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        {data.title && <figcaption className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{data.title}</figcaption>}
        <div role="tablist" aria-label="Chart type" className="ml-auto flex gap-0.5 rounded-lg bg-ink-800 p-0.5">
          {kinds.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${kind === k ? "bg-ink-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>
              {names[k]}
            </button>
          ))}
        </div>
      </div>
      {kind === "bar" && <Bars data={shown} first={mixed ? active : 0} />}
      {kind === "line" && <Lines data={shown} first={mixed ? active : 0} />}
      {kind === "pie" && <Pie data={pieFits(shown) ? shown : data} />}
      {kind === "table" && (table ?? <PlainTable data={data} />)}
      {data.series.length > 1 && kind !== "table" && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-400">
          {data.series.map((s, i) => mixed ? (
            <button key={s.name} aria-pressed={active === i} onClick={() => setActive(i)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${active === i ? "border-zinc-500/60 text-zinc-100" : "border-ink-700 hover:text-zinc-200"}`}>
              <i className="inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />{s.name}
            </button>
          ) : kind !== "pie" && (
            <span key={s.name} className="flex items-center gap-1 px-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />{s.name}</span>
          ))}
        </div>
      )}
    </figure>
  );
}

/**
 * Horizontal bars: long labels (candidates, products, countries) stay readable in a narrow panel.
 * Bars use at most 80% of the track so the value always fits after them.
 */
function Bars({ data, first = 0 }: { data: DataSet; first?: number }) {
  const all = data.series.flatMap((s) => s.data);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = (max - min || 1) / 80;
  const zero = -min / span;
  const colorOf = (j: number) => PALETTE[(first + j) % PALETTE.length];
  return (
    <div className="flex flex-col gap-1.5">
      {data.labels.map((label, i) => (
        <div key={i} className="grid grid-cols-[minmax(56px,min(38%,200px))_1fr] items-center gap-2 text-[11px]">
          <span className="truncate text-zinc-300" title={label}>{label}</span>
          <div className="flex flex-col gap-0.5">
            {data.series.map((s, j) => {
              const v = s.data[i];
              const w = Math.abs(v) / span;
              return (
                <div key={j} className="relative h-4">
                  <div className="absolute top-0.5 h-3 rounded-sm" title={`${s.name}: ${fmt(v)}`}
                    style={{ left: `${v >= 0 ? zero : zero - w}%`, width: `${Math.max(w, 0.6)}%`, background: colorOf(j) }} />
                  <span className="absolute top-0 whitespace-nowrap tabular-nums text-zinc-300"
                    style={v >= 0 ? { left: `calc(${zero + w}% + 5px)` } : { right: `calc(${100 - zero + w}% + 5px)` }}>{fmt(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Lines({ data, first = 0 }: { data: DataSet; first?: number }) {
  const colorOf = (j: number) => PALETTE[(first + j) % PALETTE.length];
  const [ref, width] = useWidth<HTMLDivElement>();
  const all = data.series.flatMap((s) => s.data);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const height = 170, right = 10, top = 8, bottom = 22;
  const left = 10 + Math.max(...ticks.map((t) => compact(t).length)) * 6;
  const n = data.labels.length;
  const x = (i: number) => left + (n === 1 ? (width - left - right) / 2 : (i * (width - left - right)) / (n - 1));
  const y = (v: number) => top + ((hi - v) * (height - top - bottom)) / (hi - lo || 1);
  const every = Math.ceil(n / Math.max(2, Math.floor((width - left) / 56)));
  return (
    <div ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Line chart" className="block overflow-visible">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--color-ink-700)" strokeDasharray={t === 0 ? undefined : "3 3"} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-zinc-400)">{compact(t)}</text>
          </g>
        ))}
        {data.labels.map((l, i) => i % every === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} fontSize="10" fill="var(--color-zinc-400)">{l.length > 10 ? `${l.slice(0, 9)}…` : l}</text>
        ) : null)}
        {data.series.map((s, j) => (
          <g key={j} stroke={colorOf(j)} fill={colorOf(j)}>
            <polyline fill="none" strokeWidth="2" strokeLinejoin="round" points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.data.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={n > 30 ? 0 : 3}><title>{`${data.labels[i]} · ${s.name}: ${fmt(v)}`}</title></circle>)}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Pie({ data }: { data: DataSet }) {
  const values = data.series[0].data;
  const total = values.reduce((a, b) => a + b, 0);
  let angle = -Math.PI / 2;
  const r = 60, inner = 34, c = 64;
  const arcs = values.map((v, i) => {
    const a0 = angle, a1 = angle + (v / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number) => `${c + rr * Math.cos(a)},${c + rr * Math.sin(a)}`;
    // A single 100% slice cannot be drawn as one arc; nudge its end.
    const end = v === total ? a1 - 0.0001 : a1;
    return <path key={i} d={`M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(end, r)} L${p(end, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)} Z`} fill={PALETTE[i % PALETTE.length]}><title>{`${data.labels[i]}: ${fmt(v)}`}</title></path>;
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {data.series.length > 1 && <p className="w-full text-[11px] text-zinc-400">{data.series[0].name}</p>}
      <svg width={128} height={128} role="img" aria-label="Pie chart" className="shrink-0">{arcs}</svg>
      <ul className="min-w-0 flex-1 space-y-0.5 text-[11px]">
        {data.labels.map((l, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-zinc-300" title={l}>{l}</span>
            <span className="ml-auto pl-2 tabular-nums text-zinc-400">{((values[i] / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlainTable({ data }: { data: DataSet }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead><tr><th />{data.series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{data.labels.map((l, i) => <tr key={i}><td>{l}</td>{data.series.map((s) => <td key={s.name} className="tabular-nums">{fmt(s.data[i])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- mind maps

export function MindMap({ root }: { root: MapNode }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const layout = useMemo(() => {
    const ROW = 26, CHAR = 6.2, MAXW = 170, GAP = 28;
    const width = (label: string) => Math.min(MAXW, 18 + label.length * CHAR);
    const cols: number[] = [];
    const nodes: Array<{ id: string; label: string; x: number; y: number; w: number; depth: number; branch: number; kids: number; parent?: string }> = [];
    let leaf = 0;
    const visit = (n: MapNode, id: string, depth: number, branch: number, parent?: string): number => {
      cols[depth] = Math.max(cols[depth] ?? 0, width(n.label));
      const open = !closed.has(id);
      const ys = open ? n.children.map((c, i) => visit(c, `${id}.${i}`, depth + 1, depth === 0 ? i : branch, id)) : [];
      const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : leaf++ * ROW + ROW / 2;
      nodes.push({ id, label: n.label, x: 0, y, w: width(n.label), depth, branch, kids: n.children.length, parent });
      return y;
    };
    visit(root, "0", 0, 0);
    const xs = cols.reduce<number[]>((acc, _w, i) => [...acc, i === 0 ? 4 : acc[i - 1] + cols[i - 1] + GAP], []);
    nodes.forEach((n) => (n.x = xs[n.depth]));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return { nodes, byId, width: xs[xs.length - 1] + cols[cols.length - 1] + 8, height: Math.max(leaf, 1) * ROW + 4 };
  }, [root, closed]);
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const color = (n: { depth: number; branch: number }) => (n.depth === 0 ? "var(--color-zinc-200)" : PALETTE[n.branch % PALETTE.length]);
  return (
    <figure className="enki-visual my-2 overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/60 p-2">
      <svg width={layout.width} height={layout.height} role="img" aria-label={`Mind map: ${root.label}`} className="block">
        {layout.nodes.filter((n) => n.parent).map((n) => {
          const p = layout.byId.get(n.parent!)!;
          const x1 = p.x + p.w, x2 = n.x, mid = (x1 + x2) / 2;
          return <path key={`l${n.id}`} d={`M${x1},${p.y} C${mid},${p.y} ${mid},${n.y} ${x2},${n.y}`} fill="none" stroke={color(n)} strokeOpacity="0.6" strokeWidth="1.5" />;
        })}
        {layout.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`} className={n.kids ? "cursor-pointer" : ""} onClick={() => n.kids && toggle(n.id)}>
            <rect x={0} y={-10} width={n.w} height={20} rx={10} fill="var(--color-ink-800)" stroke={color(n)} strokeWidth={n.depth === 0 ? 2 : 1} />
            <text x={9} y={4} fontSize="11" fill="var(--color-zinc-100)" fontWeight={n.depth === 0 ? 600 : 400}>
              {n.label.length * 6.2 + 18 > n.w ? `${n.label.slice(0, Math.floor((n.w - 22) / 6.2))}…` : n.label}
              <title>{n.label}{n.kids ? ` (${closed.has(n.id) ? "click to open" : "click to fold"})` : ""}</title>
            </text>
            {n.kids > 0 && closed.has(n.id) && <text x={n.w + 3} y={4} fontSize="10" fill="var(--color-zinc-400)">+{n.kids}</text>}
          </g>
        ))}
      </svg>
    </figure>
  );
}

// ---------- react-markdown hooks

type Hast = { type: string; tagName?: string; value?: string; children?: Hast[]; properties?: Record<string, unknown> };
const textOf = (n: Hast): string => (n.type === "text" ? n.value ?? "" : (n.children ?? []).map(textOf).join(""));
const elements = (n: Hast | undefined, tag?: string): Hast[] => (n?.children ?? []).filter((c) => c.type === "element" && (!tag || c.tagName === tag));

export const visualComponents: Components = {
  // Links in answers (citations above all) open in a new tab, never inside the panel.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node, children }) => {
    const rows = [...elements(node as Hast, "thead"), ...elements(node as Hast, "tbody")].flatMap((g) => elements(g, "tr"));
    const cells = rows.map((r) => elements(r).map((c) => textOf(c).trim()));
    const data = cells.length > 2 ? dataFromTable(cells[0], cells.slice(1)) : null;
    const table = <div className="overflow-x-auto"><table>{children}</table></div>;
    return data ? <DataView data={data} table={table} /> : table;
  },
  pre: ({ node, children }) => {
    const code = elements(node as Hast, "code")[0];
    const lang = ((code?.properties?.className as string[] | undefined) ?? []).find((c) => c.startsWith("language-"))?.slice(9);
    if (code && lang === "chart") {
      const spec = dataFromSpec(textOf(code));
      if (spec) return <DataView data={spec} prefer={spec.type} />;
    }
    if (code && lang === "mindmap") {
      const root = parseMindmap(textOf(code));
      if (root) return <MindMap root={root} />;
    }
    return <pre>{children}</pre>;
  },
};
