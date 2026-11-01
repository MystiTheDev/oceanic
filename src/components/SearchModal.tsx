import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, Check, ChevronDown, Clock, CornerDownLeft, Search, X } from "lucide-react";
import { api, type PageStatus, type SearchHit, type WorkspaceRecord } from "../data/api";
import { getSeedBlocks, type PageMeta } from "../data/workspace";
import { STATUSES } from "../lib/colors";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { StatusBadge, TagChip } from "./PageProperties";

type SearchModalProps = {
  /** Live pages of every workspace. */
  pages: PageMeta[];
  workspaces: WorkspaceRecord[];
  onOpenPage: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onClose: () => void;
};

type Sort = "best" | "edited" | "created";
type DateRange = "any" | "today" | "week" | "month";
const SORTS: Record<Sort, string> = { best: "Best match", edited: "Last edited", created: "Created" };
const DATES: Record<DateRange, string> = { any: "Any time", today: "Today", week: "Past week", month: "Past 30 days" };
const DAY = 86_400_000;
const RECENT_KEY = "recentSearches";

/** Splits "\u0001hit\u0002" markers (or plain substring hits) into highlighted spans. */
function Highlight({ text, query }: { text: string; query?: string }) {
  if (text.includes("\u0001")) {
    return (
      <>
        {text.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) =>
          part.startsWith("\u0001") ? (
            <mark key={i} className="oc-search-hit">{part.slice(1, -1)}</mark>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </>
    );
  }
  const terms = (query ?? "").trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="oc-search-hit">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Notion's search: filters under the field, results left, live preview right. */
export function SearchModal({ pages, workspaces, onOpenPage, onOpenInNewTab, onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [sort, setSort] = useState<Sort>("best");
  const [titleOnly, setTitleOnly] = useState(false);
  const [wsFilter, setWsFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<PageStatus>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateRange>("any");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    api.getSettings().then((s) => setRecentSearches(JSON.parse(s[RECENT_KEY] ?? "[]"))).catch(() => {});
  }, []);

  // Full-text search, debounced a touch so typing stays smooth.
  useEffect(() => {
    if (!q) return setHits(null);
    const t = window.setTimeout(() => {
      api.searchPages(q, titleOnly).then(setHits).catch(() => setHits([]));
    }, 90);
    return () => window.clearTimeout(t);
  }, [q, titleOnly]);

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const allTags = useMemo(() => [...new Set(pages.flatMap((p) => p.tags ?? []))].sort(), [pages]);

  const results = useMemo(() => {
    const now = Date.now();
    const since = { any: 0, today: now - DAY, week: now - 7 * DAY, month: now - 30 * DAY }[dateFilter];
    const hitMap = new Map((hits ?? []).map((h) => [h.pageId, h]));
    let list = (q ? (hits ?? []).map((h) => byId.get(h.pageId)) : pages).filter((p): p is PageMeta => !!p);
    list = list.filter(
      (p) =>
        (!wsFilter || p.workspaceId === wsFilter) &&
        [...tagFilter].every((t) => p.tags?.includes(t)) &&
        (statusFilter.size === 0 || (!!p.status && statusFilter.has(p.status))) &&
        (!since || Date.parse(p.updatedAt ?? "") >= since),
    );
    const time = (p: PageMeta, k: "updatedAt" | "createdAt") => Date.parse(p[k] ?? "") || 0;
    if (sort === "edited" || (sort === "best" && !q)) list.sort((a, b) => time(b, "updatedAt") - time(a, "updatedAt"));
    else if (sort === "created") list.sort((a, b) => time(b, "createdAt") - time(a, "createdAt"));
    return list.slice(0, 60).map((p) => ({ page: p, hit: hitMap.get(p.id) }));
  }, [q, hits, pages, byId, sort, wsFilter, tagFilter, statusFilter, dateFilter]);

  useEffect(() => setCursor(0), [results.length, q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Empty query: group by when the page was last edited, like Notion.
  const groups = useMemo(() => {
    if (q || sort !== "best") return [{ title: q ? "Results" : SORTS[sort], items: results }];
    const now = Date.now();
    const age = (p: PageMeta) => now - (Date.parse(p.updatedAt ?? "") || 0);
    const buckets: [string, (a: number) => boolean][] = [
      ["Today", (a) => a < DAY],
      ["Past week", (a) => a >= DAY && a < 7 * DAY],
      ["Past 30 days", (a) => a >= 7 * DAY && a < 30 * DAY],
      ["Older", (a) => a >= 30 * DAY],
    ];
    return buckets.map(([title, f]) => ({ title, items: results.filter((r) => f(age(r.page))) })).filter((g) => g.items.length);
  }, [results, q, sort]);
  const flat = groups.flatMap((g) => g.items);
  const selected = flat[cursor]?.page;

  const rememberSearch = () => {
    if (!q) return;
    const next = [q, ...recentSearches.filter((s) => s !== q)].slice(0, 6);
    setRecentSearches(next);
    api.setSetting(RECENT_KEY, JSON.stringify(next)).catch(() => {});
  };
  const open = (id: string, newTab = false) => {
    rememberSearch();
    if (newTab) onOpenInNewTab(id);
    else onOpenPage(id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (document.querySelector(".oc-context-menu")) return;
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      open(selected.id, e.ctrlKey || e.metaKey);
    }
  };

  const toggleIn = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };
  const menuAt = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} } as never, items);
  };
  const wsName = (id: string) => workspaces.find((w) => w.id === id);
  const breadcrumb = (p: PageMeta) => {
    const trail: string[] = [];
    for (let x = p.parentId ? byId.get(p.parentId) : undefined; x; x = x.parentId ? byId.get(x.parentId) : undefined)
      trail.unshift(x.title || "Untitled");
    const ws = wsName(p.workspaceId);
    return [ws ? `${ws.icon} ${ws.name}` : null, ...trail].filter(Boolean).join(" / ");
  };
  const anyFilter = !!wsFilter || tagFilter.size > 0 || statusFilter.size > 0 || dateFilter !== "any" || titleOnly;

  return createPortal(
    <div
      className="oc-fade-in fixed inset-0 z-50 flex justify-center bg-black/50 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        onKeyDown={onKeyDown}
        className="oc-pop-in flex h-[min(560px,78vh)] w-[min(880px,calc(100vw-32px))] origin-top flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] shadow-2xl shadow-black/60"
      >
        {/* ---- Field ---- */}
        <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
          <Search className="size-[18px] shrink-0 text-neutral-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Oceanic…"
            spellCheck={false}
            className="w-full bg-transparent text-[17px] text-neutral-100 outline-none placeholder:text-neutral-500"
          />
          {query && (
            <button
              type="button"
              title="Clear"
              onClick={() => (setQuery(""), inputRef.current?.focus())}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-200"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* ---- Filters ---- */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-3.5 pb-2.5">
          <Chip
            active={sort !== "best"}
            icon={<ArrowDownUp className="size-3" />}
            onClick={(e) =>
              menuAt(e, (Object.keys(SORTS) as Sort[]).map((s) => ({ label: SORTS[s], checked: sort === s, onSelect: () => setSort(s) })))
            }
          >
            {SORTS[sort]}
          </Chip>
          <Chip active={titleOnly} onClick={() => setTitleOnly((v) => !v)}>
            {titleOnly && <Check className="size-3" />}Title only
          </Chip>
          <Chip
            active={!!wsFilter}
            onClick={(e) =>
              menuAt(e, [
                { label: "All workspaces", checked: !wsFilter, onSelect: () => setWsFilter(null) },
                "divider",
                ...workspaces.map((w): MenuItem => ({
                  label: w.name,
                  icon: <span className="w-4 text-center text-[13px]">{w.icon}</span>,
                  checked: wsFilter === w.id,
                  onSelect: () => setWsFilter(w.id),
                })),
              ])
            }
          >
            {wsFilter ? wsName(wsFilter)?.name : "Workspace"}
          </Chip>
          <Chip
            active={tagFilter.size > 0}
            onClick={(e) =>
              menuAt(
                e,
                allTags.length
                  ? allTags.map((t): MenuItem => ({ label: t, checked: tagFilter.has(t), onSelect: () => toggleIn(tagFilter, t, setTagFilter) }))
                  : [{ label: "No tags yet", disabled: true }],
              )
            }
          >
            {tagFilter.size ? `Tags · ${tagFilter.size}` : "Tags"}
          </Chip>
          <Chip
            active={statusFilter.size > 0}
            onClick={(e) =>
              menuAt(
                e,
                (Object.keys(STATUSES) as PageStatus[]).map((s): MenuItem => ({
                  label: STATUSES[s].label,
                  icon: <span className="block size-2 rounded-full" style={{ backgroundColor: STATUSES[s].color.text }} />,
                  checked: statusFilter.has(s),
                  onSelect: () => toggleIn(statusFilter, s, setStatusFilter),
                })),
              )
            }
          >
            {statusFilter.size ? `Status · ${statusFilter.size}` : "Status"}
          </Chip>
          <Chip
            active={dateFilter !== "any"}
            onClick={(e) =>
              menuAt(e, (Object.keys(DATES) as DateRange[]).map((d) => ({ label: DATES[d], checked: dateFilter === d, onSelect: () => setDateFilter(d) })))
            }
          >
            {dateFilter === "any" ? "Date edited" : DATES[dateFilter]}
          </Chip>
          {anyFilter && (
            <button
              type="button"
              onClick={() => {
                setWsFilter(null);
                setTagFilter(new Set());
                setStatusFilter(new Set());
                setDateFilter("any");
                setTitleOnly(false);
              }}
              className="ml-1 cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-300"
            >
              Reset
            </button>
          )}
        </div>

        {/* ---- Results + preview ---- */}
        <div className="flex min-h-0 flex-1">
          <div ref={listRef} className="scrollbar-thin w-[46%] min-w-0 shrink-0 overflow-y-auto border-r border-white/[0.06] p-1.5">
            {!q && recentSearches.length > 0 && (
              <div className="mb-1">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-neutral-500">Recent searches</p>
                {recentSearches.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-neutral-300 hover:bg-white/[0.05]"
                  >
                    <Clock className="size-3.5 shrink-0 text-neutral-500" />
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
            )}

            {q && hits === null ? null : flat.length === 0 ? (
              <p className="px-3 py-10 text-center text-[13px] text-neutral-500">
                {q ? `No results for “${q}”` : "No pages match these filters"}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.title}>
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-neutral-500">{g.title}</p>
                  {g.items.map(({ page, hit }) => {
                    const idx = flat.findIndex((r) => r.page.id === page.id);
                    const on = idx === cursor;
                    const crumb = breadcrumb(page);
                    return (
                      <button
                        key={page.id}
                        type="button"
                        data-idx={idx}
                        onMouseMove={() => idx !== cursor && setCursor(idx)}
                        onClick={(e) => open(page.id, e.ctrlKey || e.metaKey)}
                        className={`flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-75 ${
                          on ? "bg-white/[0.07]" : ""
                        }`}
                      >
                        <span className="mt-0.5 w-5 shrink-0 text-center text-[15px] leading-5">{page.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[14px] font-medium text-neutral-100">
                              <Highlight text={page.title || "Untitled"} query={q} />
                            </span>
                            {on && <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-neutral-500" />}
                          </span>
                          {hit?.snippet ? (
                            <span className="line-clamp-2 text-[12px] leading-[17px] text-neutral-400">
                              <Highlight text={hit.snippet} />
                            </span>
                          ) : (
                            crumb && <span className="block truncate text-[12px] text-neutral-500">{crumb}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="min-w-0 flex-1">
            {selected ? (
              <Preview key={selected.id} page={selected} crumb={breadcrumb(selected)} query={q} />
            ) : (
              <div className="grid h-full place-items-center text-[13px] text-neutral-600">Nothing selected</div>
            )}
          </div>
        </div>

        {/* ---- Keyboard hints ---- */}
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-white/[0.06] px-4 text-[11px] text-neutral-500">
          <Hint keys="↑↓">Select</Hint>
          <Hint keys="↵">Open</Hint>
          <Hint keys="Ctrl ↵">Open in new tab</Hint>
          <Hint keys="Esc">Close</Hint>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Right pane: the page's properties and its first blocks, rendered lightly. */
function Preview({ page, crumb, query }: { page: PageMeta; crumb: string; query: string }) {
  const [blocks, setBlocks] = useState<{ type: string; text: string; level?: number; checked?: boolean }[] | null>(null);
  useEffect(() => {
    let live = true;
    api.getPage(page.id).then((p) => {
      const doc = p?.content ? JSON.parse(p.content) : getSeedBlocks(page.id);
      const out: { type: string; text: string; level?: number; checked?: boolean }[] = [];
      const walk = (list: any[]) => {
        for (const b of list ?? []) {
          if (out.length > 40) return;
          const text = Array.isArray(b.content)
            ? b.content.map((c: any) => c.text ?? c.props?.latex ?? "").join("")
            : typeof b.content === "string"
              ? b.content
              : "";
          out.push({ type: b.type, text, level: b.props?.level, checked: b.props?.checked });
          walk(b.children);
        }
      };
      walk(doc);
      if (live) setBlocks(out);
    });
    return () => {
      live = false;
    };
  }, [page.id]);

  return (
    <div className="oc-fade-in scrollbar-thin h-full overflow-y-auto px-7 py-6">
      {crumb && <p className="mb-3 truncate text-[11px] text-neutral-500">{crumb}</p>}
      <div className="mb-2 text-[34px] leading-none">{page.icon}</div>
      <h3 className="mb-3 text-[22px] font-bold leading-tight tracking-tight text-neutral-100">{page.title || "Untitled"}</h3>
      {(page.status || page.tags?.length || page.dueDate) && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {page.status && <StatusBadge status={page.status} small />}
          {page.tags?.map((t) => <TagChip key={t} tag={t} small />)}
          {page.dueDate && <span className="text-[11px] text-neutral-500">Due {page.dueDate}</span>}
        </div>
      )}
      <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-neutral-300">
        {blocks?.map((b, i) =>
          b.type === "heading" ? (
            <p key={i} className={`mt-2 font-semibold text-neutral-100 ${b.level === 1 ? "text-[17px]" : "text-[15px]"}`}>
              <Highlight text={b.text} query={query} />
            </p>
          ) : b.type === "divider" ? (
            <hr key={i} className="my-1.5 border-white/[0.08]" />
          ) : b.text ? (
            <p key={i} className={b.type === "quote" ? "border-l-2 border-white/20 pl-3 text-neutral-400" : ""}>
              {b.type === "bulletListItem" && "• "}
              {b.type === "numberedListItem" && "1. "}
              {b.type === "checkListItem" && (b.checked ? "☑ " : "☐ ")}
              <span className={b.type === "checkListItem" && b.checked ? "line-through opacity-70" : ""}>
                <Highlight text={b.text} query={query} />
              </span>
            </p>
          ) : null,
        )}
        {blocks && !blocks.some((b) => b.text) && <p className="text-neutral-600">Empty page</p>}
      </div>
    </div>
  );
}

function Chip({
  active,
  icon,
  onClick,
  children,
}: {
  active?: boolean;
  icon?: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-[26px] cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors ${
        active
          ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
          : "border-white/[0.1] text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200"
      }`}
    >
      {icon}
      {children}
      {!icon && !active && <ChevronDown className="size-3 opacity-60" />}
    </button>
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px font-sans text-[10px] text-neutral-400">{keys}</kbd>
      {children}
    </span>
  );
}
