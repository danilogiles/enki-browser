import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { KEEP_KEY, SEARCH_SETTINGS_URL } from "../lib/legacy-search";

/** Copy is Ink's (Enki room, 2026-10-10). Informational, not an alert: neutral border, Shield icon. */
export function LegacySearchCard() {
  const [state, setState] = useState<"loading" | "show" | "steps" | "hidden">("loading");
  useEffect(() => {
    chrome.storage.local.get(KEEP_KEY).then((v) => setState(v[KEEP_KEY] ? "hidden" : "show"), () => setState("show"));
  }, []);
  if (state === "loading" || state === "hidden") return null;
  return (
    <div role="note" data-testid="legacy-search-card" className="mx-3 mb-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-xs text-zinc-300">
      <div className="flex items-start gap-2">
        <Shield size={16} className="mt-[1px] shrink-0 text-enki-400" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-zinc-100">Your address bar searches go to your AI model</p>
          <p className="mt-1">Enki was set as your search engine by an earlier version. Your typed searches went to your AI provider, not DuckDuckGo.</p>
          {state === "steps" && (
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Open search engine settings.</li>
              <li>Next to DuckDuckGo, open the ⋮ menu and choose <b>Make default</b>.</li>
            </ol>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {state === "show" && (
              <button type="button" className="rounded-md border border-ink-700 px-3 py-1 text-xs" onClick={() => { setState("hidden"); void chrome.storage.local.set({ [KEEP_KEY]: true }); }}>
                Keep for now
              </button>
            )}
            <button type="button" className="rounded-md bg-enki-500 px-3 py-1 text-xs font-medium text-ink-950"
              onClick={() => { if (state === "show") setState("steps"); else void chrome.tabs.create({ url: SEARCH_SETTINGS_URL }); }}>
              {state === "show" ? "Switch back to DuckDuckGo" : "Open search engine settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
