import { useEffect, useRef, useState } from "react";
import { Search, Trash2, Undo2, X } from "lucide-react";
import { Modal } from "./Modal";
import type { PageMeta } from "../data/workspace";
import { openContextMenu } from "./ContextMenu";

type TrashPopoverProps = {
  anchor: HTMLElement;
  pages: PageMeta[];
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onRestoreAll: () => void;
  onEmptyTrash: () => void;
  onClose: () => void;
};

/** Trash: centred glass dialog with search, Restore and Delete forever. */
export function TrashPopover({
  pages,
  onRestore,
  onDeleteForever,
  onRestoreAll,
  onEmptyTrash,
  onClose,
}: TrashPopoverProps) {
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** Bulk action awaiting confirmation in the footer. */
  const [confirmAll, setConfirmAll] = useState<"restore" | "delete" | null>(null);
  const count = pages.length;
  const noun = count === 1 ? "1 page" : `${count} pages`;
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const shown = [...pages]
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    .filter((p) => (p.title || "Untitled").toLowerCase().includes(q));

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <Modal glass onClose={onClose} className="flex h-[min(560px,80vh)] w-[min(560px,92vw)] flex-col">
      <div ref={ref} className="flex items-center gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold tracking-tight text-neutral-100">Trash</h2>
          <p className="text-[12px] text-neutral-500">{count ? `${noun} · restore any time` : "Deleted pages show up here"}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/[0.06] text-neutral-400 hover:bg-white/[0.12] hover:text-neutral-100">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-4 pb-2">
        <div className="flex h-8 items-center gap-2 rounded-full bg-white/[0.06] px-3 focus-within:ring-2 focus-within:ring-[color:var(--color-sky-500)]/50">
          <Search className="size-3.5 shrink-0 text-neutral-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages in Trash"
            className="w-full bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500"
          />
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Trash2 className="size-6 text-neutral-600" />
            <p className="text-[13px] text-neutral-500">
              {q ? "No matches in Trash" : "Trash is empty"}
            </p>
          </div>
        ) : (
          shown.map((page) =>
            confirmId === page.id ? (
              <div
                key={page.id}
                className="oc-fade-in flex h-12 items-center gap-2 rounded-lg bg-red-500/10 px-3 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-red-300">Delete forever?</span>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="cursor-pointer rounded px-2 py-0.5 text-neutral-300 transition-colors duration-100 hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteForever(page.id);
                    setConfirmId(null);
                  }}
                  className="cursor-pointer rounded bg-red-500/80 px-2 py-0.5 font-medium text-[#fff] transition-colors duration-100 hover:bg-red-500"
                >
                  Delete
                </button>
              </div>
            ) : (
              <div
                key={page.id}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: "Restore", icon: <Undo2 className="size-4" />, onSelect: () => onRestore(page.id) },
                    "divider",
                    {
                      label: "Delete forever",
                      icon: <Trash2 className="size-4" />,
                      danger: true,
                      onSelect: () => setConfirmId(page.id),
                    },
                  ])
                }
                className="group flex h-12 items-center gap-3 rounded-lg px-3 text-[13.5px] text-neutral-200 transition-colors duration-100 hover:bg-white/[0.05]"
              >
                <span className="w-5 shrink-0 text-center leading-none">{page.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{page.title || "Untitled"}</span>
                  {page.trashedAt ? <span className="block text-[11.5px] text-neutral-500">Deleted {ago(page.trashedAt)}</span> : null}
                </span>
                <button
                  type="button"
                  title="Restore"
                  onClick={() => onRestore(page.id)}
                  className="grid size-6 cursor-pointer place-items-center rounded text-neutral-500 transition-colors duration-100 hover:bg-white/[0.08] hover:text-neutral-200"
                >
                  <Undo2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete forever"
                  onClick={() => setConfirmId(page.id)}
                  className="grid size-6 cursor-pointer place-items-center rounded text-neutral-500 transition-colors duration-100 hover:bg-red-500/15 hover:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ),
          )
        )}
      </div>

      {count > 0 && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          {confirmAll ? (
            <div
              className={`oc-fade-in flex h-8 items-center gap-2 rounded-full px-3 text-[13px] ${
                confirmAll === "delete" ? "bg-red-500/10" : "bg-white/[0.04]"
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate ${confirmAll === "delete" ? "text-red-300" : "text-neutral-200"}`}
              >
                {confirmAll === "delete"
                  ? `Delete ${noun} forever?`
                  : `Restore ${noun}?`}
              </span>
              <button
                type="button"
                onClick={() => setConfirmAll(null)}
                className="cursor-pointer rounded px-2 py-0.5 text-neutral-300 transition-colors duration-100 hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  if (confirmAll === "delete") onEmptyTrash();
                  else onRestoreAll();
                  setConfirmAll(null);
                }}
                className={`cursor-pointer rounded px-2 py-0.5 font-medium text-[#fff] transition-colors duration-100 ${
                  confirmAll === "delete" ? "bg-red-500/80 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"
                }`}
              >
                {confirmAll === "delete" ? "Delete all" : "Restore all"}
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAll("restore")}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.07] px-4 text-[13px] text-neutral-200 transition-colors duration-100 hover:bg-white/[0.12]"
              >
                <Undo2 className="size-3.5" />
                Restore all
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll("delete")}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-red-500/15 px-4 text-[13px] text-red-300 transition-colors duration-100 hover:bg-red-500/25 hover:text-red-200"
              >
                <Trash2 className="size-3.5" />
                Delete all
              </button>
            </div>
          )}
        </div>
      )}

      <p className="border-t border-white/[0.06] px-5 py-2.5 text-[11.5px] text-neutral-500">
        Deleting forever can't be undone.
      </p>
    </Modal>
  );
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
