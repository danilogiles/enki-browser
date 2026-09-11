import { useState } from "react";
import { saveSettings, type Settings } from "../lib/settings";

export function QuickModels({ settings, disabled, onChange }: { settings: Settings; disabled: boolean; onChange: (model: string) => void }) {
  const [search, setSearch] = useState("");
  const favorites = settings.favoriteModels ?? [];
  const choices = [...new Set([settings.model, settings.askModel, settings.actModel, ...favorites].filter(Boolean))]
    .filter((m) => m.toLowerCase().includes(search.toLowerCase()));
  const pinned = favorites.includes(settings.model);
  return <details className="border-b border-ink-800 px-3 py-2 text-xs">
    <summary className="cursor-pointer text-zinc-300">Quick model switch</summary>
    <div className="mt-2 space-y-2">
      <label className="block text-zinc-400" htmlFor="model-search">Search favorites</label>
      <input id="model-search" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded border border-ink-700 bg-ink-900 p-2" />
      <div className="flex flex-wrap gap-1">
        {choices.map((m) => <button key={m} disabled={disabled} title={m} onClick={() => onChange(m)} className={`max-w-full truncate rounded border px-2 py-1 disabled:opacity-50 ${m === settings.model ? "border-enki-500 text-enki-400" : "border-ink-700 text-zinc-300"}`}>{m}</button>)}
        {!choices.length && <span className="text-zinc-400">No matches. Add models in Settings.</span>}
      </div>
      <button disabled={disabled} className="text-enki-400 underline disabled:opacity-50" onClick={() => void saveSettings({ ...settings, favoriteModels: pinned ? favorites.filter((m) => m !== settings.model) : [...favorites, settings.model] })}>{pinned ? "Unpin current model" : "Pin current model"}</button>
    </div>
  </details>;
}
