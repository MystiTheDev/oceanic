import { useState, type ReactNode } from "react";
import { ArrowDownUp, ChevronRight, Clock, FileText, Network, Search, Shapes, Star } from "lucide-react";
import type { PageMeta } from "../data/workspace";
import type { MindmapRecord } from "../data/api";
import { ago } from "./HomeView";

type Tab = "recents" | "favorites" | "pages" | "mindmaps";
type Sort = "visited" | "edited" | "name";
type Row = { id: string; icon: ReactNode; title: string; kind: "Page" | "Mindmap"; edited?: string; visited?: number; page?: PageMeta };

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "recents", label: "Recents", icon: <Clock className="size-4" /> },
  { id: "favorites", label: "Favorites", icon: <Star className="size-4" /> },
  { id: "pages", label: "Pages", icon: <FileText className="size-4" /> },
  { id: "mindmaps", label: "Mindmaps", icon: <Network className="size-4" /> },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: "visited", label: "Last visited" },
  { id: "edited", label: "Last edited" },
  { id: "name", label: "Name" },
];

/** Notion's Library: every page and mindmap in one table, with tabs, search and sort. */
export function LibraryView({
  pages,
  mindmaps,
  visitedAt,
  onOpenPage,
  onOpenMindmap,
  onNewPage,
}: {
  pages: PageMeta[];
  mindmaps: MindmapRecord[];
  visitedAt: Record<string, number>;
  onOpenPage: (id: string) => void;
  onOpenMindmap: (id: string) => void;
  onNewPage: () => void;
}) {
  const [tab, setTab] = useState<Tab>("recents");
  const [sort, setSort] = useState<Sort>("visited");
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const pageRow = (p: PageMeta): Row => ({ id: p.id, icon: p.icon, title: p.title || "Untitled", kind: "Page", edited: p.updatedAt, visited: visitedAt[p.id], page: p });
  const mapRow = (m: MindmapRecord): Row => ({
    id: "mindmap:" + m.id,
    icon: <Network className="size-4 text-[color:var(--oc-mm-violet-light)]" />,
    title: m.title || "Untitled mindmap",
    kind: "Mindmap",
    edited: m.updatedAt,
    visited: visitedAt["mindmap:" + m.id],
  });

  const q = query?.trim().toLowerCase() ?? "";
  // Searching flattens the tree; otherwise page tabs show top-level pages with ▶ to expand.
  const roots = (list: PageMeta[]) => (q ? list : list.filter((p) => !p.parentId || !pages.some((x) => x.id === p.parentId)));
  let rows: Row[] =
    tab === "recents"
      ? [...pages.map(pageRow), ...mindmaps.map(mapRow)].filter((r) => r.visited)
      : tab === "favorites"
        ? pages.filter((p) => p.pinned).map(pageRow)
        : tab === "pages"
          ? roots(pages).map(pageRow)
          : mindmaps.map(mapRow);
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));
  const cmp = (a: Row, b: Row) =>
    sort === "name" ? a.title.localeCompare(b.title) : sort === "edited" ? (b.edited ?? "").localeCompare(a.edited ?? "") : (b.visited ?? 0) - (a.visited ?? 0);
  rows.sort(cmp);
  const childrenOf = (id: string) => pages.filter((p) => p.parentId === id).map(pageRow).sort(cmp);

  const renderRow = (r: Row, depth: number): ReactNode => {
    const kids = r.page && !q && tab !== "recents" ? childrenOf(r.id) : [];
    const expanded = open.has(r.id);
    return (
      <div key={r.id}>
        <div
          onClick={() => (r.kind === "Mindmap" ? onOpenMindmap(r.id.slice(8)) : onOpenPage(r.id))}
          className="grid h-9 cursor-pointer grid-cols-[minmax(0,1fr)_120px_140px_140px] items-center border-b border-white/[0.06] text-[14px] hover:bg-white/[0.03]"
        >
          <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((s) => (s.has(r.id) ? new Set([...s].filter((x) => x !== r.id)) : new Set([...s, r.id])));
              }}
              className={`grid size-5 shrink-0 place-items-center rounded text-neutral-500 hover:bg-white/[0.08] ${kids.length ? "" : "invisible"}`}
            >
              <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
            </button>
            <span className="grid w-5 shrink-0 place-items-center">{r.icon}</span>
            <span className="truncate font-medium text-neutral-100">{r.title}</span>
          </span>
          <span className="text-neutral-400">{r.kind}</span>
          <span className="text-neutral-300">{ago(r.edited)}</span>
          <span className="text-neutral-300">{r.visited ? ago(new Date(r.visited).toISOString()) : "—"}</span>
        </div>
        {expanded && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="oc-page-in scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-12 pb-24 pt-14">
        <div className="flex items-center">
          <h1 className="flex-1 text-[32px] font-bold tracking-tight text-neutral-100">Library</h1>
          <button
            type="button"
            onClick={onNewPage}
            className="h-8 cursor-pointer rounded-md bg-[var(--oc-brand)] px-3 text-[14px] font-medium text-white hover:brightness-110"
          >
            New page
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-colors ${
                tab === t.id ? "bg-white/[0.08] text-neutral-100" : "text-neutral-400 hover:bg-white/[0.04]"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <span className="flex-1" />
          {query !== null ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setQuery(null)}
              onKeyDown={(e) => e.key === "Escape" && setQuery(null)}
              placeholder="Type to search…"
              className="h-7 w-48 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none focus:border-sky-500/60"
            />
          ) : (
            <IconBtn title="Search" onClick={() => setQuery("")}>
              <Search className="size-4" />
            </IconBtn>
          )}
          <IconBtn title={`Sort: ${SORTS.find((s) => s.id === sort)!.label}`} onClick={() => setSort(SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length].id)}>
            <ArrowDownUp className="size-4" />
          </IconBtn>
          <span className="text-[12px] text-neutral-500">{SORTS.find((s) => s.id === sort)!.label}</span>
        </div>

        <div className="mt-3 grid h-9 grid-cols-[minmax(0,1fr)_120px_140px_140px] items-center border-b border-white/[0.06] text-[14px] text-neutral-500">
          <span className="flex items-center gap-2 pl-7">
            <FileText className="size-4" /> Name
          </span>
          <span className="flex items-center gap-2">
            <Shapes className="size-4" /> Type
          </span>
          <span className="flex items-center gap-2">
            <Clock className="size-4" /> Last edited
          </span>
          <span className="flex items-center gap-2">
            <Clock className="size-4" /> Last visited
          </span>
        </div>
        {rows.length ? rows.map((r) => renderRow(r, 0)) : <p className="py-8 text-center text-[14px] text-neutral-500">Nothing here yet.</p>}
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06]">
      {children}
    </button>
  );
}
