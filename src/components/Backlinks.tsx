import { Fragment, useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Network } from "lucide-react";
import { api, type Backlink } from "../data/api";
import { usePageDirectory } from "../editor/pageDirectory";

/**
 * Notion's backlinks line under the title: a quiet "3 backlinks" toggle that
 * expands into the linking pages, each with the text around the reference.
 */
export function Backlinks({ pageId, version }: { pageId: string; version: number }) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const [open, setOpen] = useState(false);
  const { pages, open: openPage } = usePageDirectory();

  useEffect(() => {
    let live = true;
    api
      .getBacklinks(pageId)
      .then((l) => live && setLinks(l))
      .catch((e) => console.error("Loading backlinks failed", e));
    return () => {
      live = false;
    };
  }, [pageId, version]);

  // One row per page: a document link (with its snippet) wins over a canvas
  // connection, but keeps the connection's label. Sources in Trash (or under
  // a trashed page) aren't in the directory, so they drop out.
  const merged = new Map<string, Backlink & { canvasLabel: string | null }>();
  for (const l of links) {
    if (!pages.has(l.sourceId)) continue;
    const prev = merged.get(l.sourceId);
    const canvasLabel = l.via === "canvas" ? l.label : (prev?.canvasLabel ?? null);
    if (!prev || l.via === "document") merged.set(l.sourceId, { ...l, canvasLabel });
    else prev.canvasLabel = canvasLabel;
  }
  const visible = [...merged.values()];
  if (!visible.length) return null;

  return (
    <div className="oc-fade-in mb-1 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 -ml-1.5 text-neutral-500 transition-colors duration-100 hover:bg-white/[0.05] hover:text-neutral-300"
      >
        <ArrowUpRight className="size-3.5" />
        {visible.length} backlink{visible.length === 1 ? "" : "s"}
        <ChevronRight className={`size-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="mt-1 space-y-0.5 border-l border-neutral-800 pl-2">
            {visible.map((l) => {
              const source = pages.get(l.sourceId)!;
              return (
                <li key={l.sourceId}>
                  <button
                    type="button"
                    onClick={(e) => openPage(source.id, e.ctrlKey || e.metaKey)}
                    className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-white/[0.05]"
                  >
                    <span className="flex items-center gap-1.5 text-neutral-200">
                      <span className="leading-none">{source.icon}</span>
                      <span className="truncate">{source.title || "Untitled"}</span>
                      {l.canvasLabel !== null && (
                        <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded bg-white/[0.06] px-1.5 py-px text-[11px] text-neutral-400">
                          <Network className="size-3" />
                          {l.canvasLabel || "Canvas"}
                        </span>
                      )}
                    </span>
                    {l.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500">
                        <Snippet text={l.snippet} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Renders `[[pageId]]` markers as the linked page's current icon + title. */
function Snippet({ text }: { text: string }) {
  const { pages } = usePageDirectory();
  const parts = text.split(/\[\[([^\]]+)\]\]/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const page = pages.get(part);
        return (
          <span key={i} className="text-neutral-300 underline decoration-neutral-600 underline-offset-2">
            {page ? `${page.icon} ${page.title || "Untitled"}` : "Deleted page"}
          </span>
        );
      })}
    </>
  );
}
