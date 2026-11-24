import { useEffect, useId, useMemo, useState } from "react";
/** Editable combobox: full local search, bounded DOM, no network and no allowlist. */
export function ModelPicker({ label, value, models, onChange, placeholder, id }: {
  label: string; value: string; models: readonly string[]; onChange: (value: string) => void; placeholder?: string; id?: string;
}) {
  const uid = useId(); const listId = `${uid}-models`;
  const [open, setOpen] = useState(false); const [active, setActive] = useState(-1);
  const matches = useMemo(() => { const q = value.toLowerCase(); return models.filter((m) => m.toLowerCase().includes(q)); }, [models, value]);
  const shown = matches.slice(0, 40);
  const choose = (m: string) => { onChange(m); setActive(-1); setOpen(false); };
  const selected = open && active >= 0 && active < shown.length ? active : -1;
  useEffect(() => { if (selected >= 0) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected, listId]);
  return <div className="relative min-w-0 flex-1">
    <input id={id} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
      aria-activedescendant={selected >= 0 ? `${listId}-${selected}` : undefined}
      value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
      className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-enki-400"
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }}
      onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); setOpen(false); setActive(-1); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((n) => shown.length ? n < 0 ? (e.key === "ArrowDown" ? 0 : shown.length - 1) : (n + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length : -1); }
        else if (e.key === "Enter" && open) { e.preventDefault(); if (selected >= 0) choose(shown[selected]); else setOpen(false); }
      }} />
    {open && <div className="absolute z-30 w-full rounded-lg border border-ink-700 bg-ink-900 shadow-xl">
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="max-h-48 overflow-y-auto">
        {shown.map((m, i) => <li key={m} id={`${listId}-${i}`} role="option" aria-selected={selected === i}
          onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m)}
          className={`cursor-pointer break-all px-3 py-2 text-xs ${selected === i ? "bg-ink-700" : "hover:bg-ink-800"}`}>{m}</li>)}
      </ul>
      <p className="px-3 py-2 text-xs text-zinc-400">Showing {shown.length} of {matches.length} matches. Search covers all loaded models. Any model ID can be entered manually.</p>
    </div>}
  </div>;
}
