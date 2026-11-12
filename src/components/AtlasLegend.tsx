import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { REL_TYPES, type RelType } from "../data/api";
import { MUTED_STROKE, REL_COLORS, REL_LABELS, SYMMETRIC_TYPES } from "../data/atlas";

/** Collapsible color key for Atlas: card kinds and relationship colors. Sits above the zoom controls. */
export function AtlasLegend({ muted }: { muted: ReadonlySet<RelType> }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-16 right-4 z-10 w-48 rounded-lg border border-white/[0.08] bg-neutral-800/90 text-[11px] shadow-xl shadow-black/40 backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between px-2.5 py-1.5 font-medium text-neutral-300 hover:text-neutral-100"
      >
        Legend
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 px-2.5 pb-2">
            <p className="flex items-center gap-2 text-neutral-400">
              <span className="h-2.5 w-4 rounded-full ring-1 ring-violet-400/60" /> Concept
            </p>
            <p className="flex items-center gap-2 text-neutral-400">
              <span className="h-2.5 w-4 rounded-[3px] border border-white/25" /> Page
            </p>
            <div className="my-1.5 h-px bg-white/[0.06]" />
            {REL_TYPES.map((t) => (
              <p key={t} className={`flex items-center gap-2 ${muted.has(t) ? "text-neutral-600 line-through" : "text-neutral-300"}`}>
                <svg width="16" height="6" className="shrink-0">
                  <line
                    x1="1"
                    y1="3"
                    x2="15"
                    y2="3"
                    stroke={muted.has(t) ? MUTED_STROKE : REL_COLORS[t]}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                {REL_LABELS[t]}
                {SYMMETRIC_TYPES.has(t) && <span className="text-neutral-600">↔</span>}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
