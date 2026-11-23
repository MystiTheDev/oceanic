import { useEffect, useRef, useState } from "react";
import { Cloud, Layers, Pin, Plus, Search, X } from "lucide-react";
import { usePageDirectory } from "../editor/pageDirectory";
import { useEscape } from "../lib/overlay";
import { MAX_NOTES, type ContextNote } from "../lib/nerida";

/* Context picker for Nerida: chips for the notes the next message sends, and a
 * popover listing them with pin (always send, kept with the chat), remove and add. */

const WHY: Record<ContextNote["why"], string> = {
  current: "Open note",
  child: "Sub-page",
  link: "Linked",
  backlink: "Links here",
  mention: "Added",
  found: "Found by search",
};

type Props = {
  /** Every note in context, in priority order; the first `sendCount` are sent. */
  notes: ContextNote[];
  sendCount: number;
  tokens: number;
  /** Provider name when notes would leave the computer. */
  cloud: string | null;
  onPin: (id: string) => void;
  onRemove: (n: ContextNote) => void;
  onAdd: (id: string) => void;
};

export function ContextPicker({ notes, sendCount, tokens, cloud, onPin, onRemove, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const { pages } = usePageDirectory();
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const ids = new Set(notes.map((n) => n.id));
  const adds = q.trim()
    ? [...pages.values()].filter((p) => !p.trashedAt && !ids.has(p.id) && (p.title || "Untitled").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5)
    : [];
  const sent = notes.slice(0, sendCount);

  return (
    <div ref={box} className="relative mb-1 flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Choose which notes Nerida reads"
        className={`oc-nl-chip flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] transition-colors ${open ? "border-teal-300/40 bg-teal-300/[0.08] text-teal-100" : "border-white/[0.1] text-neutral-400 hover:text-neutral-200"}`}>
        {cloud ? <Cloud className="size-3 text-amber-300" /> : <Layers className="size-3" />}
        {sent.length ? `${sent.length} note${sent.length > 1 ? "s" : ""} · ~${tokens.toLocaleString()} tokens` : "Add notes"}
      </button>
      {sent.map((n) => (
        <span key={n.id} title={`${WHY[n.why]}${n.pinned ? " · pinned" : ""}`}
          className={`oc-nl-chip oc-chip-in flex max-w-[160px] items-center gap-1 rounded-full border bg-white/[0.03] px-2 py-0.5 text-[11.5px] text-neutral-300 ${n.why === "found" && !n.pinned ? "border-dashed border-sky-300/30" : n.pinned ? "border-teal-300/30" : "border-white/[0.1]"}`}>
          {n.pinned ? <Pin className="size-2.5 shrink-0 text-teal-300" /> : n.why === "found" ? <Search className="size-2.5 shrink-0 text-sky-300" /> : <span>{n.icon}</span>}
          <span className="truncate">{n.title}</span>
          <button type="button" title="Don't send this note" className="cursor-pointer text-neutral-500 hover:text-neutral-200" onClick={() => onRemove(n)}><X className="size-3" /></button>
        </span>
      ))}
      {open && (
        <div className="oc-menu-pop absolute bottom-full left-0 z-30 mb-2 w-80 rounded-xl border border-white/[0.08] bg-neutral-900/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur">
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] text-neutral-500">
            Nerida reads these notes with your next message (up to {MAX_NOTES}; long notes are cut to the parts that match).
          </p>
          {cloud && (
            <p className="mx-1 mb-1.5 flex items-start gap-1.5 rounded-lg bg-amber-300/[0.07] px-2 py-1.5 text-[11.5px] text-amber-200/90">
              <Cloud className="mt-px size-3 shrink-0" /> {cloud} is a cloud model: these notes are sent to that provider.
            </p>
          )}
          {!notes.length && <p className="px-2 py-1.5 text-[12.5px] text-neutral-400">No notes yet. Add one below, or just ask: Nerida searches all your notes.</p>}
          <div className="max-h-56 overflow-y-auto">
            {notes.map((n, i) => (
              <div key={n.id} className={`group flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] hover:bg-white/[0.05] ${i >= sendCount ? "opacity-45" : ""}`}>
                <span className="w-4 shrink-0 text-center">{n.icon || "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-neutral-200">{n.title}</span>
                  <span className="block text-[10.5px] text-neutral-500">{i >= sendCount ? `Over the ${MAX_NOTES}-note limit` : WHY[n.why]}</span>
                </span>
                <button type="button" title={n.pinned ? "Unpin" : "Pin: always send with this chat"} onClick={() => onPin(n.id)}
                  className={`cursor-pointer rounded p-1 ${n.pinned ? "text-teal-300" : "text-neutral-500 opacity-0 group-hover:opacity-100 hover:text-neutral-200"}`}>
                  <Pin className="size-3.5" />
                </button>
                <button type="button" title="Don't send this note" onClick={() => onRemove(n)} className="cursor-pointer rounded p-1 text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-white/[0.06] pt-1.5">
            <label className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1">
              <Plus className="size-3.5 text-neutral-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a note…" className="w-full bg-transparent text-[12.5px] text-neutral-200 outline-none placeholder:text-neutral-500"
                onKeyDown={(e) => { if (e.key === "Enter" && adds[0]) (onAdd(adds[0].id), setQ("")); }} />
            </label>
            {adds.map((p) => (
              <button key={p.id} type="button" onClick={() => (onAdd(p.id), setQ(""))}
                className="flex w-full cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1 text-left text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">
                <span className="w-4 shrink-0 text-center">{p.icon || "📄"}</span><span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
