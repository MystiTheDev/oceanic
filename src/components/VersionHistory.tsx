import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PartialBlock } from "@blocknote/core";
import { api } from "../data/api";
import { RESTORE_VERSION, type RestoreDetail } from "../lib/ydoc";

type Version = { at: number; content: string };

/** First lines of a saved body, for the list. */
function preview(content: string): string {
  const out: string[] = [];
  const walk = (bs: { content?: unknown; children?: unknown[] }[]) => {
    for (const b of bs) {
      if (out.join(" ").length > 160) return;
      if (Array.isArray(b.content)) out.push(b.content.map((c: { text?: string }) => c.text ?? "").join(""));
      if (b.children?.length) walk(b.children as never);
    }
  };
  try {
    walk(JSON.parse(content));
  } catch {
    /* not JSON */
  }
  return out.filter(Boolean).join(" · ").slice(0, 160) || "Empty page";
}

/** Saved versions of a page (last 20 or 30 days) with a Restore button. Desktop and phone. */
export function VersionHistory({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [list, setList] = useState<Version[] | null>(null);
  useEffect(() => {
    void api.pageVersions(pageId).then(setList, () => setList([]));
  }, [pageId]);

  const restore = (v: Version) => {
    const detail: RestoreDetail = { pageId, blocks: JSON.parse(v.content) as PartialBlock[] };
    window.dispatchEvent(new CustomEvent(RESTORE_VERSION, { detail }));
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-white/[0.08] bg-neutral-800 shadow-xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="text-sm font-semibold text-neutral-100">Version history</span>
          <button type="button" className="text-sm text-neutral-400 hover:text-neutral-100" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {list === null ? null : list.length === 0 ? (
            <p className="p-4 text-sm text-neutral-400">No older versions yet. A version is kept each time you start editing after a 10-minute break, and before a sync changes the page.</p>
          ) : (
            list.map((v) => (
              <div key={v.at} className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-100">{new Date(v.at).toLocaleString()}</div>
                  <div className="truncate text-xs text-neutral-400">{preview(v.content)}</div>
                </div>
                <button type="button" className="shrink-0 rounded-md bg-sky-500/20 px-3 py-1 text-sm text-sky-200 hover:bg-sky-500/30" onClick={() => restore(v)}>
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
