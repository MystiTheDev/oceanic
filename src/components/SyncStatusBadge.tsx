import { useEffect, useRef, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { useSyncStatus, type SyncStatus } from "../lib/sync";

const DOT: Record<SyncStatus, string> = {
  synced: "bg-emerald-400",
  pending: "bg-amber-400",
  error: "bg-red-400",
  offline: "bg-neutral-500",
};
const LABEL: Record<SyncStatus, string> = {
  synced: "Synced",
  pending: "Waiting to sync",
  error: "Sync problem",
  offline: "Offline / not paired",
};

/** Small phone+PC badge with a state dot; tap for details and Sync settings. */
export function SyncStatusBadge({ pageId, compact = false }: { pageId: string; compact?: boolean }) {
  const { status, notes } = useSyncStatus();
  const note = notes[pageId] ?? status;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", close), window.removeEventListener("keydown", esc));
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        title={`Sync: ${LABEL[note]} — ${LABEL[status]}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`relative grid shrink-0 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 ${compact ? "ocm-icon" : "size-7"}`}
      >
        <MonitorSmartphone className="size-4" />
        <span className={`absolute bottom-0.5 right-0.5 size-1.5 rounded-full ring-1 ring-neutral-900 ${DOT[note]}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[80] mt-1 w-56 rounded-xl border border-white/10 bg-neutral-900 p-2 text-left shadow-2xl shadow-black/60">
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Sync status</p>
          <p className="flex items-center gap-2 rounded-md px-1 py-1 text-[12.5px] text-neutral-200"><span className={`size-1.5 rounded-full ${DOT[status]}`} /> All devices: {LABEL[status]}</p>
          <p className="flex items-center gap-2 rounded-md px-1 py-1 text-[12.5px] text-neutral-200"><span className={`size-1.5 rounded-full ${DOT[note]}`} /> This note: {LABEL[note]}</p>
          <button type="button" onClick={() => (setOpen(false), window.dispatchEvent(new CustomEvent("oc-open-settings", { detail: "sync" })))}
            className="mt-1 w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[12.5px] text-sky-300 hover:bg-white/[0.06]">
            Open sync settings →
          </button>
        </div>
      )}
    </span>
  );
}
