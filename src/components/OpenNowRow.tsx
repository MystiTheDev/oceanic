import type { ReactNode } from "react";
import { X } from "lucide-react";

export type OpenItem = { tabId: string; title: string };

/** "Open now" on an app's Home: files still open in the background (their tabs are hidden while editing). */
export function OpenNowRow({ items, icon, tone, onFocus, onClose }: { items: OpenItem[]; icon: ReactNode; tone: string; onFocus: (tabId: string) => void; onClose: (tabId: string) => void }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Open now</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <div key={it.tabId} className="oc-press group flex h-10 max-w-[260px] items-center rounded-xl border border-white/[0.08] bg-white/[0.03] pl-3 pr-1 transition-colors hover:bg-white/[0.07]" style={{ borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` }}>
            <button type="button" onClick={() => onFocus(it.tabId)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
              <span className="relative shrink-0" style={{ color: tone }}>
                {icon}
                <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full" style={{ background: tone }} />
              </span>
              <span className="truncate text-[13px] font-medium text-neutral-200">{it.title || "Untitled"}</span>
            </button>
            <button type="button" data-tip="Close" onClick={() => onClose(it.tabId)} className="ml-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-200">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
