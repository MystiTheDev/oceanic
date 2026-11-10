import { Fragment, useEffect, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { MoreHorizontal, Star } from "lucide-react";
import type { PageMeta } from "../data/workspace";
import { PageMenu, type PageMenuAction } from "./PageMenu";
import { ExportDialog } from "./ExportDialog";
import { Toast } from "./Toast";
import { NeridaMark } from "./NeridaOrb";
import { openNeridaCards } from "./NeridaCards";
import { nerida, useNerida } from "../lib/nerida";

type PageHeaderProps = {
  page: PageMeta;
  pages: PageMeta[];
  /** Last edit this session; the label is hidden until there is one. */
  editedAt: number | undefined;
  onNavigate: (pageId: string) => void;
  onTogglePin: (pageId: string) => void;
  onDuplicate: (pageId: string) => void;
  onTrash: (pageId: string) => void;
  /** Current document for any page (for exporting sub-pages that aren't open). */
  loadBlocks: (pageId: string) => Promise<PartialBlock[]>;
  font: string;
  onFont: (pageId: string, font: string) => void;
};

/** Notion's slim page top bar: breadcrumb path left; edited, ☆, ⋯ right. */
export function PageHeader({
  page,
  pages,
  editedAt,
  onNavigate,
  onTogglePin,
  onDuplicate,
  onTrash,
  loadBlocks,
  font,
  onFont,
}: PageHeaderProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<{ message: string; key: number } | null>(null);
  const now = useNow(30_000);
  const neridaOpen = useNerida().open;

  // Root → … → current page.
  const byId = new Map(pages.map((p) => [p.id, p]));
  const trail: PageMeta[] = [];
  for (let p: PageMeta | undefined = page; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    trail.unshift(p);
  }

  const runAction = (action: PageMenuAction) => {
    if (action === "favorite") onTogglePin(page.id);
    else if (action === "duplicate") onDuplicate(page.id);
    else if (action === "trash") onTrash(page.id);
    else if (action === "export") setExportOpen(true);
    else if (action === "flashcards") openNeridaCards({ pageId: page.id });
    else if (action === "rename") {
      const title = document.querySelector<HTMLInputElement>("input[data-page-title]");
      title?.focus();
      title?.select();
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      {/* ---- Breadcrumbs ---- */}
      <nav className="flex min-w-0 flex-1 items-center text-[13px]">
        {trail.map((p, i) => {
          const last = i === trail.length - 1;
          return (
            <Fragment key={p.id}>
              {i > 0 && <span className="shrink-0 px-0.5 text-neutral-600">/</span>}
              <button
                type="button"
                onClick={() => onNavigate(p.id)}
                className={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-white/[0.06] ${
                  last ? "text-neutral-200" : "shrink-[2] text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <span className="shrink-0 leading-none">{p.icon}</span>
                <span className="truncate">{p.title || "Untitled"}</span>
              </button>
            </Fragment>
          );
        })}
      </nav>

      {/* ---- Right cluster ---- */}
      <div className="flex shrink-0 items-center gap-0.5">
        {editedAt && (
          <span className="oc-fade-in mr-1.5 hidden text-[13px] text-neutral-500 sm:inline">
            Edited {relativeTime(editedAt, now)}
          </span>
        )}

        <IconButton title="Ask Nerida (Ctrl+J)" active={neridaOpen} onClick={() => nerida.toggle()}>
          <NeridaMark size={16} />
        </IconButton>

        <IconButton
          title={page.pinned ? "Remove from Favorites" : "Add to Favorites"}
          onClick={() => onTogglePin(page.id)}
        >
          <Star
            className={`size-4 transition-colors duration-150 ${page.pinned ? "text-amber-400" : ""}`}
            fill={page.pinned ? "currentColor" : "none"}
          />
        </IconButton>

        <IconButton
          title="Style, export, and more…"
          active={!!menuAnchor}
          onClick={(e) => {
            const el = e.currentTarget;
            setMenuAnchor((a) => (a ? null : el));
          }}
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      </div>

      {menuAnchor && (
        <PageMenu
          anchor={menuAnchor}
          placement="below"
          showExport
          pinned={page.pinned}
          font={font}
          onFont={(f) => onFont(page.id, f)}
          onAction={runAction}
          onClose={() => setMenuAnchor(null)}
        />
      )}

      {exportOpen && (
        <ExportDialog
          page={page}
          pages={pages}
          loadBlocks={loadBlocks}
          onDone={(message) => setNotice({ message, key: Date.now() })}
          onClose={() => setExportOpen(false)}
        />
      )}
      {notice && (
        <Toast key={notice.key} message={notice.message} onDismiss={() => setNotice(null)} duration={3000} />
      )}
    </div>
  );
}

function IconButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid size-7 cursor-pointer place-items-center rounded-md transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100 ${
        active ? "bg-white/[0.06] text-neutral-100" : "text-neutral-400"
      }`}
    >
      {children}
    </button>
  );
}

/** Re-render every `ms` so relative times stay fresh. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  const id = useRef<number | undefined>(undefined);
  useEffect(() => {
    id.current = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id.current);
  }, [ms]);
  return now;
}

function relativeTime(then: number, now: number) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
