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

/** Small phone+PC badge with a state dot; opens Sync settings on tap. */
export function SyncStatusBadge({ pageId, compact = false }: { pageId: string; compact?: boolean }) {
  const { status, notes } = useSyncStatus();
  const note = notes[pageId] ?? status;
  return (
    <button
      type="button"
      title={`Sync: ${LABEL[note]} — ${LABEL[status]}`}
      onClick={() => window.dispatchEvent(new CustomEvent("oc-open-settings", { detail: "sync" }))}
      className={`relative grid shrink-0 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 ${compact ? "ocm-icon" : "size-7"}`}
    >
      <MonitorSmartphone className="size-4" />
      <span className={`absolute bottom-0.5 right-0.5 size-1.5 rounded-full ring-1 ring-neutral-900 ${DOT[note]}`} />
    </button>
  );
}
