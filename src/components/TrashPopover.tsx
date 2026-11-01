import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Trash2, Undo2 } from "lucide-react";
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

/** Notion's Trash: popover beside the sidebar with search, Restore and Delete forever. */
export function TrashPopover({
  anchor,
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

  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.top, window.innerHeight - 440);
  const left = rect.right + 6;

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ top: Math.max(8, top), left }}
      className="oc-pop-in fixed z-50 flex max-h-[min(420px,70vh)] w-[340px] origin-top-left flex-col rounded-lg border border-white/[0.08] bg-neutral-800 shadow-xl shadow-black/50"
    >
      <div className="p-2">
        <div className="flex h-7 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 transition-colors duration-100 focus-within:border-sky-500/60">
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

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-1">
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
                className="oc-fade-in flex h-8 items-center gap-2 rounded-md bg-red-500/10 px-2 text-[13px]"
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
                className="group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-white/[0.05]"
              >
                <span className="w-5 shrink-0 text-center leading-none">{page.icon}</span>
                <span className="min-w-0 flex-1 truncate">{page.title || "Untitled"}</span>
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
        <div className="border-t border-white/[0.06] p-1.5">
          {confirmAll ? (
            <div
              className={`oc-fade-in flex h-8 items-center gap-2 rounded-md px-2 text-[13px] ${
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
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setConfirmAll("restore")}
                className="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100"
              >
                <Undo2 className="size-3.5" />
                Restore all
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll("delete")}
                className="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 className="size-3.5" />
                Delete all
              </button>
            </div>
          )}
        </div>
      )}

      <p className="border-t border-white/[0.06] px-3 py-2 text-[11px] text-neutral-500">
        Pages in Trash can be restored. Deleting forever can't be undone.
      </p>
    </div>,
    document.body,
  );
}
