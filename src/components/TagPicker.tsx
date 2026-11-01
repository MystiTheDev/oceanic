import { useState } from "react";
import { Plus } from "lucide-react";
import { COLOR_IDS, COLORS } from "../lib/colors";
import { TagChip } from "./PageProperties";

/**
 * Tag dropdown: filter the tag library, pick one, or "Add new tag" → choose a
 * colour → it's created and used. `exclude` hides tags already applied.
 */
export function TagPicker({
  library,
  exclude = [],
  onPick,
  onCreate,
  onClose,
  className = "left-0 w-64",
}: {
  /** Position/width; the Tags panel stretches it to its column. */
  className?: string;
  library: string[];
  exclude?: string[];
  onPick: (tag: string) => void;
  onCreate: (tag: string, color: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null);
  const q = query.trim();
  const shown = library.filter((t) => !exclude.includes(t) && t.toLowerCase().includes(q.toLowerCase()));
  const exists = library.some((t) => t.toLowerCase() === q.toLowerCase());

  return (
    <div
      className={`oc-pop-in absolute top-full z-40 mt-1 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1.5 shadow-xl shadow-black/40 ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {colorFor ? (
        <div className="p-1">
          <p className="mb-2 text-[12px] text-neutral-400">
            Colour for <span className="font-medium text-neutral-100">“{colorFor}”</span>
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                title={COLORS[id].label}
                onClick={() => (onCreate(colorFor, id), onClose())}
                className="flex h-7 cursor-pointer items-center justify-center rounded-md text-[11px] font-medium transition-transform hover:scale-105"
                style={{ background: COLORS[id].bg, color: COLORS[id].text }}
              >
                {COLORS[id].label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && q) shown[0] && exists ? (onPick(shown[0]), onClose()) : !exists && setColorFor(q);
            }}
            placeholder="Find or create a tag…"
            className="mb-1 h-7 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none focus:border-sky-500/60"
          />
          <div className="scrollbar-thin max-h-56 overflow-y-auto">
            {shown.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => (onPick(t), onClose())}
                className="flex h-8 w-full cursor-pointer items-center rounded-md px-1.5 hover:bg-white/[0.06]"
              >
                <TagChip tag={t} small />
              </button>
            ))}
            {!shown.length && !q && <p className="px-2 py-2 text-[12px] text-neutral-500">No tags yet. Type a name to create one.</p>}
            {q && !exists && (
              <button
                type="button"
                onClick={() => setColorFor(q)}
                className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-sky-400 hover:bg-white/[0.06]"
              >
                <Plus size={14} /> Add new tag “{q}”
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

