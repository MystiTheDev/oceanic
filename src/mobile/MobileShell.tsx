/**
 * Phone layout (Android): replaces the desktop title bar, tabs and sidebar.
 * Home, Pages and Calendar tabs in a centred glass pill (with the + button at its end),
 * an open page full screen with back + page menu, and a profile sheet behind
 * the avatar. Android's back gesture closes sheets and pages.
 * Animations use Motion and follow Android's "Remove animations" setting.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTablet } from "./formFactor";
import { APPS } from "../components/AppSwitcher";
import { VersionHistory } from "../components/VersionHistory";
import { AnimatePresence, MotionConfig, animate, motion, useMotionValueEvent, useScroll, useTransform, type Transition } from "motion/react";
import {
  ArrowUpLeft, CalendarDays, Camera, SlidersHorizontal, ImagePlus, Paperclip, Check, Clock, CheckSquare, ChevronLeft, Copy, FileText, Home, Layers, MoonStar, MoreHorizontal, PenLine, Pin, Plus, Share2,
  RotateCcw, Search, Settings, Sun, Tag, Trash2, X, LayoutGrid,
  History, AlarmClock,
} from "lucide-react";
import { api, type SearchHit, type WorkspaceRecord } from "../data/api";
import { Highlight } from "../components/SearchModal";
import type { PageMeta } from "../data/workspace";
import { Avatar } from "../components/SettingsModal";
import { AvatarViewer } from "../components/AvatarCropper";
import "./mobile.css";
import { MobileCalendar, dotClass, dueByDay, iso } from "./MobileCalendar";
import { startOfWeek } from "../lib/prefs";
import { PropSheet, RowProps, fmtDue, setPropOpener, type PropKind } from "./MobileProps";
import type { PageProperties as PageProps } from "../data/api";
import { STATUSES } from "../lib/colors";
import { useTabletUI } from "./formFactor";
import { buzz, useMobilePrefs, type HomeSection } from "./mobilePrefs";
import type { AttachKind } from "./attach";
import { TagChip } from "../components/PageProperties";

/** True inside the Android (or iOS) app. */
export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
// Native feel on phones: no pinch zoom in the webview (desktop keeps its viewport).
if (isMobile) document.querySelector('meta[name="viewport"]')?.setAttribute("content",
  "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content, viewport-fit=cover");

type TabId = "home" | "pages" | "calendar";
const RECENT_KEY = "ocm.recentSearches";
type Filter = null | { tag: string } | { folder: string; title: string };
type Sheet = null | "export" | "filter" | "bulktag" | "bulkstatus" | "profile" | "trash" | "workspaces" | "page" | "note" | PropKind;

type Props = {
  userName: string;
  avatar: string;
  theme: "dark" | "light";
  pages: PageMeta[];
  trashed: PageMeta[];
  workspaces: WorkspaceRecord[];
  workspaceId: string;
  openPage: PageMeta | null;
  /** The page editor for `openPage`, built by App. */
  editor: ReactNode;
  onOpen: (id: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onCreateTask: (date?: string) => void;
  /** New note holding a photo, images or files picked right now. */
  onCreateWith: (kind: AttachKind) => void;
  visitedAt: Record<string, number>;
  onSettings: () => void;
  onTimers: () => void;
  onTags: () => void;
  onToggleTheme: () => void;
  onWorkspace: (id: string) => void;
  onPin: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Shares the page plus the subpages in `only` as a .ocean, Markdown or web-page file. */
  onExport: (id: string, only: string[], format: "ocean" | "markdown" | "html") => void;
  onTrash: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  tagLibrary: string[];
  onCreateTag: (tag: string, color: string) => void;
  onProps: (id: string, props: PageProps) => void;
  /** App switcher: open Oceanic Sketch. */
  onSketch: () => void;
};

const DAY = 86_400_000;
const propsOf = (x: PageMeta): PageProps => ({ dueDate: x.dueDate ?? null, status: x.status ?? null, tags: x.tags ?? [] });
const today = () => new Date(new Date().toDateString()).getTime();
/** Tablet Pages list headings by last edit. */
const ageGroup = (iso?: string) => { const t = Date.parse(iso ?? ""); return t >= today() ? "Today" : t >= today() - 6 * DAY ? "This week" : "Older"; };

/** Playful spring used across the phone UI (slight overshoot). */
const spring: Transition = { type: "spring", stiffness: 380, damping: 24, mass: 0.9 };
/** Calm, quick motion for tab switches and sheets: no overshoot. */
const calm: Transition = { duration: 0.2, ease: [0.2, 0, 0, 1] };
/** Springy press feedback for cards, rows and buttons. */
const press = { whileTap: { scale: 0.96 } };
/** Carousel cards that slide in from the side (dir 1 = from the right), one after another. */
const slideIn = (i: number, dir: number) => ({
  initial: { opacity: 0, x: 80 * dir },
  animate: { opacity: 1, x: 0 },
  transition: { ...spring, delay: Math.min(i, 6) * 0.06 },
});
/** Items that rise up one after another when a screen appears. */
const rise = (i: number) => ({
  initial: { opacity: 0, y: isTablet ? 0 : 18 },
  animate: { opacity: 1, y: 0 },
  transition: { ...spring, delay: Math.min(i, 10) * 0.045 },
});

/** A number that counts up from 0 when it first shows, then follows changes. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const c = animate(from.current, value, { duration: 0.9, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    from.current = value;
    return () => c.stop();
  }, [value]);
  return <>{shown}</>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Hero sky by hour: dawn 5–8, day 8–17, dusk 17–20, night otherwise. */
function timeOfDay() {
  const h = new Date().getHours();
  return h >= 5 && h < 8 ? "dawn" : h < 17 && h >= 8 ? "day" : h >= 17 && h < 20 ? "dusk" : "night";
}

/** Current time of day; rechecks every minute and when the app comes back to the front. */
function useTimeOfDay() {
  const [tod, setTod] = useState(timeOfDay);
  useEffect(() => {
    const check = () => setTod(timeOfDay());
    const id = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => (window.clearInterval(id), document.removeEventListener("visibilitychange", check));
  }, []);
  return tod;
}

function edited(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  const days = Math.floor((today() - new Date(new Date(t).toDateString()).getTime()) / DAY);
  if (days <= 0) return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

function due(date: string) {
  const days = Math.round((Date.parse(date + "T00:00") - today()) / DAY);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(date + "T00:00").toLocaleDateString([], { weekday: "short" });
}

const byEdited = (a: PageMeta, b: PageMeta) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/** First lines of each page's text, fetched once per page list. */
function usePreviews(ids: string[]) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    api
      .getPagePreviews(ids, 200)
      .then((rows) => setPreviews(Object.fromEntries(rows.map((r) => [r.id, r.text]))))
      .catch(() => {});
  }, [key]);
  return previews;
}

/** Soft layered waves in the accent colour, drifting slowly behind the Home greeting. */
function Waves() {
  return (
    <svg className="ocm-waves" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden>
      <path d="M-100 64 C-30 40 30 100 100 70 C170 40 230 100 300 70 S430 40 500 64 V140 H-100Z" opacity="0.14" className="ocm-w1" />
      <path d="M-100 88 C-20 66 50 118 120 92 S240 66 320 90 S440 118 500 88 V140 H-100Z" opacity="0.2" className="ocm-w2" />
      <path d="M-100 110 C-10 96 60 130 140 112 S250 96 340 114 S450 128 500 110 V140 H-100Z" className="ocm-w3" />
    </svg>
  );
}

/** Share of the sailing day (5:00 to 20:00) gone by, or null at night. */
function boatAt() {
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= 5 && h < 20 ? (h - 5) / 15 : null;
}

/** Small sailboat that crosses the banner from left (5:00) to right (20:00); hidden at night. */
function Boat() {
  const [at, setAt] = useState(boatAt);
  useEffect(() => {
    const check = () => setAt(boatAt());
    const id = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => (window.clearInterval(id), document.removeEventListener("visibilitychange", check));
  }, []);
  if (at === null) return null;
  return (
    <svg className="ocm-boat" viewBox="0 0 34 30" style={{ left: `calc(24px + ${at} * (100% - 48px))` }} aria-hidden>
      <line className="mast" x1="17" y1="3" x2="17" y2="22" />
      <path className="sail" d="M18 4 L29 20 H18 Z" />
      <path className="sail2" d="M16 7 L16 20 H7 Z" />
      <path className="hull" d="M3 22 H31 L26 28 H8 Z" />
    </svg>
  );
}

const SORTS = { edited: "Last edited", created: "Date created", title: "Title A–Z", due: "Due date" };
const FILTERS: [string, string][] = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["overdue", "Overdue"],
  ["hasdate", "Has a due date"],
];

const TABS = [
  ["home", Home, "Home"],
  ["pages", FileText, "Pages"],
  ["calendar", CalendarDays, "Calendar"],
] as const;
const TAB_ORDER = TABS.map(([id]) => id as TabId);

export function MobileShell(p: Props) {
  const prefs = useMobilePrefs();
  const tod = useTimeOfDay();
  // The Home list slides back in after a page closes, but not on app launch.
  const launched = useRef(false);
  useEffect(() => void (launched.current = true), []);
  const { pages, openPage } = p;
  const [tab, setTab] = useState<TabId>("home");
  const [dir, setDir] = useState(1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(null);
  const [recentTab, setRecentTab] = useState<"recent" | "suggested">("recent");
  const searchRef = useRef<HTMLInputElement>(null);
  // Pages search: full-text over titles and content (same search as the desktop).
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recents, setRecents] = useState<string[]>(() => JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
  useEffect(() => {
    const term = query.trim();
    if (!term) return setHits([]);
    const id = window.setTimeout(() => api.searchPages(term, false).then(setHits).catch(() => setHits([])), 150);
    return () => window.clearTimeout(id);
  }, [query]);
  const [focused, setFocused] = useState(false);
  const [viewing, setViewing] = useState(false);
  // Pages tab: sort, filters and multi-select.
  const [sortKey, setSortKey] = useState<"edited" | "created" | "title" | "due">("edited");
  const [shows, setShows] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => (tab !== "pages" ? (setSelecting(false), setSelected(new Set())) : undefined), [tab]);
  // Long-press a note card or row: its action sheet.
  const [noteId, setNoteId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const note = pages.find((x) => x.id === noteId);
  // Property chips under the title open the same sheets as the long-press rows.
  useEffect(() => setPropOpener((id, kind) => (setNoteId(id), setSheet(kind))), []);
  const hold = (id: string) => ({
    onContextMenu: (e: React.MouseEvent) => (e.preventDefault(), buzz(), setNoteId(id), setRenaming(false), setSheet("note")),
  });
  const share = async (x: PageMeta) => {
    const [row] = await api.getPagePreviews([x.id]).catch(() => []);
    const text = [x.title || "Untitled", row?.text].filter(Boolean).join("\n\n");
    if (navigator.share) navigator.share({ title: x.title || "Untitled", text }).catch(() => {});
    else navigator.clipboard?.writeText(text);
  };
  const saveRecents = (next: string[]) => (setRecents(next), localStorage.setItem(RECENT_KEY, JSON.stringify(next)));
  const remember = (term: string) => {
    term = term.trim();
    if (!term) return;
    saveRecents([term, ...recents.filter((x) => x !== term)].slice(0, 8));
  };
  const sorted = useMemo(() => [...pages].sort(byEdited), [pages]);
  const previews = usePreviews(sorted.map((x) => x.id));

  // Home header parallax: moves slower than the content and fades as you scroll.
  const scroller = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scroller });
  const heroY = useTransform(scrollY, [0, 200], [0, 80]);
  const heroFade = useTransform(scrollY, [0, 180], [1, 0.2]);
  // Tab bar goes compact while scrolling down, back to full size on scroll up.
  const [compact, setCompact] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => {
    const d = y - (scrollY.getPrevious() ?? 0);
    if (Math.abs(d) > 4) setCompact(d > 0 && y > 40);
  });
  // Tapping + opens a small create menu.
  const [plusMenu, setPlusMenu] = useState(false);
  const [appsMenu, setAppsMenu] = useState(false);
  // Open page: the top bar turns frosted and shows the title once the title scrolls away.
  const [pageScrolled, setPageScrolled] = useState(false);
  useEffect(() => setPageScrolled(false), [openPage?.id]);

  // Android back gesture: an open page or sheet adds a history entry; going back closes it.
  const layer = sheet ?? (openPage ? `page:${openPage.id}` : null);
  useEffect(() => {
    if (!layer) return;
    history.pushState({ oc: layer }, "");
    // The photo viewer handles its own back step.
    const onPop = () => !document.querySelector(".oc-avatar-view") && (sheet ? setSheet(null) : p.onBack());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [layer]);
  const closeSheet = () => history.back();
  // Export sheet: the page's subpages (depth-first, with depth), all ticked at first.
  const [exportId, setExportId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<"ocean" | "markdown" | "html">("ocean");
  const subtree = useMemo(() => {
    const out: { page: PageMeta; depth: number }[] = [];
    const walk = (id: string, depth: number) => pages.filter((x) => x.parentId === id).forEach((c) => (out.push({ page: c, depth }), walk(c.id, depth + 1)));
    if (exportId) walk(exportId, 0);
    return out;
  }, [exportId, pages]);
  const startExport = (id: string) => {
    buzz();
    setExportId(id);
    const all = new Set<string>();
    const walk = (pid: string) => pages.filter((x) => x.parentId === pid).forEach((c) => (all.add(c.id), walk(c.id)));
    walk(id);
    setPicked(all);
    setSheet("export");
  };
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // A subpage whose parent is unticked is left out with it.
  const included = (x: PageMeta): boolean => x.parentId === exportId || (picked.has(x.parentId!) && included(pages.find((y) => y.id === x.parentId)!));
  const run = (fn: () => void) => {
    buzz();
    setSheet(null);
    fn();
  };

  const go = (t: TabId) => {
    if (t === tab) return;
    buzz();
    setDir(TAB_ORDER.indexOf(t) > TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTab(t);
  };
  const tablet = useTabletUI();
  // Hardware keyboard on tablets: Ctrl+N new page, Ctrl+K/F search, Esc closes the page.
  useEffect(() => {
    if (!tablet) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === "n") (e.preventDefault(), p.onCreate());
      else if (mod && (k === "k" || k === "f")) (e.preventDefault(), setTab("pages"), setTimeout(() => searchRef.current?.focus(), 300));
      else if (e.key === "Escape" && openPage && !sheet) history.back();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const [calDay, setCalDay] = useState(() => iso(new Date()));
  const dueMap = useMemo(() => dueByDay(pages), [pages]);
  const weekStart = startOfWeek(new Date());

  const soon = pages
    .filter((x) => x.dueDate && x.status !== "done" && Date.parse(x.dueDate + "T00:00") - today() < 7 * DAY)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  // Pinned pages show in Shortcuts. Suggested: due soon, then recently opened, minus what Recent shows.
  const recent = sorted.filter((x) => !x.pinned).slice(0, 8);
  const visited = pages.filter((x) => p.visitedAt[x.id]).sort((a, b) => p.visitedAt[b.id] - p.visitedAt[a.id]);
  const suggested = [...new Set([...soon, ...visited])].filter((x) => !recent.includes(x)).slice(0, 8);
  const shown = recentTab === "recent" ? recent : suggested;
  const tags = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of pages) for (const t of x.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [pages]);
  const folders = useMemo(
    () =>
      sorted
        .filter((x) => !x.parentId)
        .map((x) => ({ page: x, count: pages.filter((c) => c.parentId === x.id).length }))
        .filter((f) => f.count),
    [sorted, pages],
  );
  const openFilter = (f: Filter) => {
    setFilter(f);
    setQuery("");
    go("pages");
  };
  const q = query.trim().toLowerCase();
  // While searching, list full-text hits in rank order; snippets by page id.
  const hit = Object.fromEntries(hits.map((h) => [h.pageId, h.snippet]));
  const matches = (x: PageMeta) =>
    !shows.size ||
    [...shows].some((f) =>
      f === "overdue" ? !!x.dueDate && x.status !== "done" && Date.parse(x.dueDate + "T00:00") < today() : f === "hasdate" ? !!x.dueDate : x.status === f,
    );
  const sortBy = (list: PageMeta[]) =>
    sortKey === "edited" || q
      ? list
      : [...list].sort((a, b) =>
          sortKey === "created"
            ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
            : sortKey === "title"
              ? (a.title || "Untitled").localeCompare(b.title || "Untitled")
              : (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
        );
  const listed = sortBy(
    (q ? hits.flatMap((h) => pages.filter((x) => x.id === h.pageId)) : sorted).filter(
      (x) => (!filter || ("tag" in filter ? x.tags?.includes(filter.tag) : x.parentId === filter.folder)) && matches(x),
    ),
  );
  const picked2 = pages.filter((x) => selected.has(x.id));
  const bulk = (fn: (x: PageMeta) => void) => (buzz(), picked2.forEach(fn), setSelecting(false), setSelected(new Set()), setSheet(null));

  const pinned = sorted.filter((x) => x.pinned);
  // Today widget: overdue, today and the next 3 days, not done.
  const todo = pages
    .filter((x) => x.dueDate && x.status !== "done" && Date.parse(x.dueDate + "T00:00") - today() < 4 * DAY)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const home: Record<HomeSection, ReactNode> = {
    recent: (
      <motion.section className="ocm-sec" {...rise(0)}>
        <div className="ocm-card-head">
          <span className="ocm-tabs">
            {(["recent", "suggested"] as const).map((t) => (
              <button key={t} className={recentTab === t ? "on" : ""} onClick={() => (buzz(), setRecentTab(t))}>
                {t === "recent" ? "Recent" : "Suggested"}
                {recentTab === t && <motion.span layoutId="ocm-tab-line" className="ocm-tab-line" transition={spring} />}
              </button>
            ))}
          </span>
          <button className="ocm-head-link" onClick={() => (buzz(), openFilter(null))}>See all</button>
        </div>
        {shown.length ? (
          <motion.div key={recentTab} className="ocm-cards">
            {shown.map((x, i) => (
              <motion.button key={x.id} className="ocm-note" onClick={() => p.onOpen(x.id)} {...hold(x.id)} {...slideIn(i, recentTab === "recent" ? -1 : 1)} {...press}>
                {x.pinned && (
                  <span className="ocm-pin" aria-label="Pinned">
                    <Pin size={11} />
                  </span>
                )}
                <span className="ocm-note-icon">{x.icon || "📄"}</span>
                <span className="ocm-note-title">{x.title || "Untitled"}</span>
                <span className="ocm-note-preview">{previews[x.id] ?? ""}</span>
                <span className="ocm-note-date">{edited(x.updatedAt)}</span>
              </motion.button>
            ))}
          </motion.div>
        ) : (
          <p className="ocm-empty">{recentTab === "recent" ? "No pages yet. Tap + to write one." : "Nothing to suggest yet."}</p>
        )}
      </motion.section>
    ),
    today: (
      <motion.section className="ocm-sec ocm-duo" {...rise(1)}>
        <div className="ocm-widget">
          <div className="ocm-widget-head">
            <CheckSquare size={15} /> Today {todo.length > 0 && <em>{todo.length}</em>}
          </div>
          {todo.length ? (
            <>
              {todo.slice(0, 4).map((x) => (
                <div key={x.id} className="ocm-task">
                  <button className="ocm-tick" aria-label={`Mark “${x.title || "Untitled"}” done`} onClick={() => (buzz(), p.onProps(x.id, { ...propsOf(x), status: "done" }))} />
                  <button className="ocm-task-title" onClick={() => p.onOpen(x.id)} {...hold(x.id)}>
                    <span className="ocm-task-name">{x.title || "Untitled"}</span>
                    <small className={due(x.dueDate!) === "Overdue" ? "ocm-overdue" : ""}>{due(x.dueDate!)}</small>
                  </button>
                </div>
              ))}
              {todo.length > 4 && (
                <button className="ocm-widget-more" onClick={() => go("calendar")}>
                  +{todo.length - 4} more
                </button>
              )}
            </>
          ) : (
            <div className="ocm-widget-empty">
              <span>All clear</span>
              <button onClick={() => (buzz(), p.onCreateTask())}>
                <Plus size={14} /> Add task
              </button>
            </div>
          )}
        </div>
        <div className="ocm-widget">
          <div className="ocm-widget-head">
            <Pin size={15} /> Pinned
          </div>
          {pinned.length ? (
            <>
              {pinned.slice(0, 4).map((x) => (
                <button key={x.id} className="ocm-pinned" onClick={() => p.onOpen(x.id)} {...hold(x.id)}>
                  <span>{x.icon || "📄"}</span> {x.title || "Untitled"}
                </button>
              ))}
              {pinned.length > 4 && (
                <button className="ocm-widget-more" onClick={() => openFilter(null)}>
                  +{pinned.length - 4} more
                </button>
              )}
            </>
          ) : (
            <div className="ocm-widget-empty">
              <span>Long-press a page to pin it.</span>
            </div>
          )}
        </div>
      </motion.section>
    ),
    week: (
      <motion.section className="ocm-sec" {...rise(2)}>
        <div className="ocm-card-head">This week</div>
        <div className="ocm-cal-strip">
          {Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
            const id = iso(d);
            return (
              <motion.button key={id} className={`ocm-cal-day${id === iso(new Date()) ? " today" : ""}`} onClick={() => (buzz(), setCalDay(id), go("calendar"))} {...press}>
                <small>{d.toLocaleDateString([], { weekday: "narrow" })}</small>
                {d.getDate()}
                <i className={dotClass(dueMap[id], id)} />
              </motion.button>
            );
          })}
        </div>
      </motion.section>
    ),
    tags: (tags.length > 0 || folders.length > 0) && (
      <motion.section className="ocm-sec" {...rise(3)}>
        <div className="ocm-card-head">Tags &amp; collections</div>
        {tags.length > 0 && (
          <div className="ocm-chips">
            {tags.map(([t, n]) => (
              <motion.button key={t} className="ocm-chip" onClick={() => (buzz(), openFilter({ tag: t }))} {...press}>
                <TagChip tag={t} small /> <em>{n}</em>
              </motion.button>
            ))}
          </div>
        )}
        {folders.length > 0 && (
          <div className="ocm-folders">
            {folders.map(({ page: x, count }) => (
              <motion.button key={x.id} className="ocm-folder" onClick={() => (buzz(), openFilter({ folder: x.id, title: x.title || "Untitled" }))} {...press}>
                <span className="ocm-folder-icon">{x.icon || "📁"}</span>
                <span className="ocm-folder-title">{x.title || "Untitled"}</span>
                <span className="ocm-folder-n">{count} {count === 1 ? "page" : "pages"}</span>
              </motion.button>
            ))}
          </div>
        )}
      </motion.section>
    ),
  };

  const sheets = (
    <AnimatePresence>
      {sheet && (
        <motion.div key="sheet" className="ocm-sheet-bg" onClick={closeSheet} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={calm}>
          <motion.div
            className="ocm-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={calm}
          >
            <div className="ocm-grab" />
            {sheet === "profile" && (
              <>
                <div className="ocm-profile">
                  <button aria-label="View photo" disabled={!p.avatar.startsWith("data:")} onClick={() => (buzz(), setViewing(true))}>
                    <Avatar name={p.userName} avatar={p.avatar} size={52} />
                  </button>
                  <div>
                    <strong>{p.userName || "You"}</strong>
                    <span>{p.workspaces.find((w) => w.id === p.workspaceId)?.name ?? "Workspace"}</span>
                  </div>
                </div>
                <button className="ocm-item" onClick={() => setSheet("workspaces")}>
                  <Layers size={20} /> Switch workspace
                </button>
                <button className="ocm-item" onClick={() => run(p.onTags)}>
                  <Tag size={20} /> Tags
                </button>
                <button className="ocm-item" onClick={() => setSheet("trash")}>
                  <Trash2 size={20} /> Trash <em>{p.trashed.length || ""}</em>
                </button>
                <button className="ocm-item" onClick={() => run(p.onToggleTheme)}>
                  {p.theme === "dark" ? <Sun size={20} /> : <MoonStar size={20} />} {p.theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button className="ocm-item" onClick={() => run(p.onTimers)}>
                  <AlarmClock size={20} /> Timers
                </button>
                <button className="ocm-item" onClick={() => run(p.onSettings)}>
                  <Settings size={20} /> Settings
                </button>
              </>
            )}
            {sheet === "filter" && (
              <>
                <h2>Sort by</h2>
                {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
                  <button key={k} className={`ocm-item ${sortKey === k ? "on" : ""}`} onClick={() => (buzz(), setSortKey(k))}>
                    {SORTS[k]}
                    {sortKey === k && <Check size={18} className="ocm-check" />}
                  </button>
                ))}
                <h2 className="ocm-sheet-sub">Show only</h2>
                {FILTERS.map(([k, label]) => (
                  <button key={k} className={`ocm-item ${shows.has(k) ? "on" : ""}`} onClick={() => (buzz(), setShows((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; }))}>
                    {k in STATUSES ? <span className="ocm-status-dot" style={{ background: STATUSES[k as keyof typeof STATUSES].color.text }} /> : k === "overdue" ? <Clock size={20} /> : <CalendarDays size={20} />} {label}
                    {shows.has(k) && <Check size={18} className="ocm-check" />}
                  </button>
                ))}
                <button className="ocm-item ocm-share-go" disabled={!shows.size && sortKey === "edited"} onClick={() => (buzz(), setShows(new Set()), setSortKey("edited"))}>
                  Reset
                </button>
              </>
            )}
            {sheet === "bulktag" && (
              <>
                <h2>Add a tag to {selected.size} {selected.size === 1 ? "page" : "pages"}</h2>
                {p.tagLibrary.length ? (
                  p.tagLibrary.map((t) => (
                    <button key={t} className="ocm-item" onClick={() => bulk((x) => !x.tags?.includes(t) && p.onProps(x.id, { ...propsOf(x), tags: [...(x.tags ?? []), t] }))}>
                      <TagChip tag={t} />
                    </button>
                  ))
                ) : (
                  <p className="ocm-empty">No tags yet. Add one from a page's properties first.</p>
                )}
              </>
            )}
            {sheet === "bulkstatus" && (
              <>
                <h2>Set status for {selected.size} {selected.size === 1 ? "page" : "pages"}</h2>
                {(Object.keys(STATUSES) as (keyof typeof STATUSES)[]).map((k) => (
                  <button key={k} className="ocm-item" onClick={() => bulk((x) => p.onProps(x.id, { ...propsOf(x), status: k }))}>
                    <span className="ocm-status-dot" style={{ background: STATUSES[k].color.text }} /> {STATUSES[k].label}
                  </button>
                ))}
                <button className="ocm-item ocm-danger" onClick={() => bulk((x) => p.onProps(x.id, { ...propsOf(x), status: null }))}>
                  <X size={20} /> Clear status
                </button>
              </>
            )}
            {sheet === "workspaces" && (
              <>
                <h2>Workspaces</h2>
                {p.workspaces.map((w) => (
                  <button key={w.id} className={`ocm-item ${w.id === p.workspaceId ? "on" : ""}`} onClick={() => run(() => p.onWorkspace(w.id))}>
                    <span className="ocm-ws">{w.icon || "🌊"}</span> {w.name}
                  </button>
                ))}
              </>
            )}
            {sheet === "trash" && (
              <>
                <h2>Trash</h2>
                {p.trashed.length ? (
                  p.trashed.map((x) => (
                    <div key={x.id} className="ocm-trash">
                      <span>
                        {x.icon} {x.title || "Untitled"}
                      </span>
                      <button aria-label="Restore" onClick={() => (buzz(), p.onRestore(x.id))}>
                        <RotateCcw size={18} />
                      </button>
                      <button aria-label="Delete forever" onClick={() => (buzz(), p.onDeleteForever(x.id))}>
                        <X size={18} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="ocm-empty">Trash is empty.</p>
                )}
              </>
            )}
            {sheet === "note" && note && (
              <>
                {renaming ? (
                  <form className="ocm-rename-row" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), p.onRename(note.id, title.trim()), setRenaming(false))}>
                    <input className="ocm-rename" autoFocus value={title} placeholder="Untitled" enterKeyHint="go" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.form?.requestSubmit())} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
                    <button type="submit" aria-label="Save title">
                      <Check size={20} />
                    </button>
                  </form>
                ) : (
                  <h2 className="ocm-sheet-title">{note.icon || "📄"} {note.title || "Untitled"}</h2>
                )}
                <button className="ocm-item" onClick={() => run(() => p.onPin(note.id))}>
                  <Pin size={20} /> {note.pinned ? "Unpin" : "Pin"}
                </button>
                <button className="ocm-item" onClick={() => run(() => p.onDuplicate(note.id))}>
                  <Copy size={20} /> Duplicate
                </button>
                <button className="ocm-item" onClick={() => run(() => setHistoryId(note.id))}>
                  <History size={20} /> History
                </button>
                <button className="ocm-item" onClick={(e) => (e.stopPropagation(), buzz(), setTitle(note.title), setRenaming(true))}>
                  <PenLine size={20} /> Rename
                </button>
                <button className="ocm-item" onClick={() => (buzz(), setSheet("date"))}>
                  <CalendarDays size={20} /> Due date <em>{note.dueDate ? fmtDue(note.dueDate) : ""}</em>
                </button>
                <button className="ocm-item" onClick={() => (buzz(), setSheet("status"))}>
                  <CheckSquare size={20} /> Status <em>{note.status ? STATUSES[note.status].label : ""}</em>
                </button>
                <button className="ocm-item" onClick={() => (buzz(), setSheet("tags"))}>
                  <Tag size={20} /> Tags <em>{note.tags?.join(", ")}</em>
                </button>
                <button className="ocm-item" onClick={() => run(() => share(note))}>
                  <Share2 size={20} /> Share as text
                </button>
                <button className="ocm-item" onClick={() => startExport(note.id)}>
                  <Share2 size={20} /> Export
                </button>
                <button className="ocm-item ocm-danger" onClick={() => run(() => p.onTrash(note.id))}>
                  <Trash2 size={20} /> Move to Trash
                </button>
              </>
            )}
            {(sheet === "date" || sheet === "status" || sheet === "tags" || sheet === "addprop") && note && (
              <PropSheet
                kind={sheet}
                value={propsOf(note)}
                onChange={(v) => p.onProps(note.id, v)}
                library={p.tagLibrary}
                onCreateTag={p.onCreateTag}
                onKind={setSheet}
                onDone={closeSheet}
              />
            )}
            {sheet === "export" && exportId && (
              <>
                <h2 className="ocm-sheet-title">Export as</h2>
                {([["ocean", "Oceanic file (.ocean)"], ["markdown", "Markdown (.md)"], ["html", "Web page (.html)"]] as const).map(([f, label]) => (
                  <button key={f} className="ocm-item" onClick={() => (buzz(), setFormat(f))}>
                    {label}
                    {format === f && <Check size={20} className="ocm-check" />}
                  </button>
                ))}
                {subtree.length > 0 && <>
                <h2 className="ocm-sheet-title">Subpages</h2>
                <button className="ocm-item" onClick={() => (buzz(), setPicked(picked.size === subtree.length ? new Set() : new Set(subtree.map((x) => x.page.id))))}>
                  <Layers size={20} /> Select all
                  {picked.size === subtree.length && <Check size={20} className="ocm-check" />}
                </button>
                <div className="ocm-export-list">
                  {subtree.map(({ page, depth }) => (
                    <button key={page.id} className="ocm-item" style={{ paddingLeft: 10 + depth * 20 }} disabled={!included(page)} onClick={() => (buzz(), toggle(page.id))}>
                      <span>{page.icon || "📄"}</span> {page.title || "Untitled"}
                      {picked.has(page.id) && included(page) && <Check size={20} className="ocm-check" />}
                    </button>
                  ))}
                </div>
                </>}
                <button className="ocm-item ocm-share-go" onClick={() => run(() => p.onExport(exportId, [...picked].filter((x) => subtree.some((s) => s.page.id === x && included(s.page))), format))}>
                  <Share2 size={20} /> Share
                </button>
              </>
            )}
            {sheet === "page" && openPage && (
              <>
                <button className="ocm-item" onClick={() => run(() => p.onPin(openPage.id))}>
                  <Pin size={20} /> {openPage.pinned ? "Unpin" : "Pin"}
                </button>
                <button className="ocm-item" onClick={() => run(() => p.onDuplicate(openPage.id))}>
                  <Copy size={20} /> Duplicate
                </button>
                <button className="ocm-item" onClick={() => startExport(openPage.id)}>
                  <Share2 size={20} /> Export
                </button>
                <button className="ocm-item" onClick={() => run(() => setHistoryId(openPage.id))}>
                  <History size={20} /> History
                </button>
                <button className="ocm-item ocm-danger" onClick={() => run(() => p.onTrash(openPage.id))}>
                  <Trash2 size={20} /> Move to Trash
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
      {historyId && <VersionHistory key="history" pageId={historyId} onClose={() => setHistoryId(null)} />}
    </AnimatePresence>
  );

  // The open page slides in from the right over the list; back slides it out.
  const page = openPage && (
    <motion.div key="page" className="ocm ocm-page ocm-layer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring}>
      <header className={`ocm-pagebar${pageScrolled ? " scrolled" : ""}`}>
        <motion.button {...press} className="ocm-icon" aria-label="Back" onClick={() => history.back()}>
          <ChevronLeft size={24} />
        </motion.button>
        <span className="ocm-pagebar-title">{openPage.icon} {openPage.title || "Untitled"}</span>
        <motion.button {...press} className="ocm-icon" aria-label="Page menu" onClick={() => (buzz(), setSheet("page"))}>
          <MoreHorizontal size={22} />
        </motion.button>
      </header>
      <div className="ocm-editor" onScrollCapture={(e) => setPageScrolled((e.target as HTMLElement).scrollTop > 110)}>{p.editor}</div>
    </motion.div>
  );
  const list = (
    <motion.div
      key="list"
      className="ocm ocm-layer"
      initial={launched.current ? { x: "-25%", opacity: 0.6 } : false}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-25%", opacity: 0.6 }}
      transition={spring}
    >
      <div className="ocm-scroll" ref={scroller}>
        <AnimatePresence mode="wait" initial={false}>
          {tab === "home" ? (
            <motion.div key="home" className="ocm-homeview" initial={{ opacity: 0, x: -40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 * dir }} transition={calm}>
              <motion.header className={`ocm-hero ocm-${tod}`} style={{ y: heroY, opacity: heroFade }}>
                {/* Sun low at dawn/dusk, high by day; a moon and twinkling stars at night. */}
                <span className="ocm-sun" aria-hidden />
                {/* Stars stay mounted so they can fade in and out with the sky. */}
                {[12, 28, 47, 63, 80, 91, 36, 70].map((x, i) => (
                    <span key={i} className="ocm-star" style={{ left: `${x}%`, top: `${8 + ((i * 37) % 50)}%`, animationDelay: `${i * 0.4}s` }} aria-hidden />
                  ))}
                <Waves />
                {/* Boat rides on the front wave. */}
                <Boat />
                <div className="ocm-hero-row">
                  <div>
                    <h1>
                      {greeting()}
                      {p.userName ? `, ${p.userName}` : ""}
                    </h1>
                    <p>{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
                    <p className="ocm-stats">
                      <CountUp value={soon.length} /> due this week · <CountUp value={pages.length} /> {pages.length === 1 ? "page" : "pages"}
                    </p>
                  </div>
                </div>
              </motion.header>

              <motion.button className="ocm-search ocm-glass ocm-find" onClick={() => (buzz(), openFilter(null), setTimeout(() => searchRef.current?.focus(), 300))} {...rise(0)} {...press}>
                <Search size={18} /> Find any page
              </motion.button>
              <motion.section className="ocm-create" {...rise(0)}>
                <div className="ocm-create-head">Create</div>
                <div className="ocm-tiles">
                <motion.button className="ocm-tile ocm-tile-page" onClick={() => (buzz(), p.onCreate())} {...press}>
                  <Plus size={17} /> New page <FileText className="ocm-tile-art" size={40} />
                </motion.button>
                <motion.button className="ocm-tile ocm-tile-task" onClick={() => (buzz(), p.onCreateTask())} {...press}>
                  <Plus size={17} /> New task <CheckSquare className="ocm-tile-art" size={40} />
                </motion.button>
                </div>
                <div className="ocm-start-label">Or, start with</div>
                <div className="ocm-tiles ocm-tiles-3">
                  {([["photo", "Photo", Camera], ["image", "Image", ImagePlus], ["file", "File", Paperclip]] as const).map(([kind, label, Icon]) => (
                    <motion.button key={kind} className={`ocm-tile ocm-tile-${kind}`} onClick={() => (buzz(), p.onCreateWith(kind))} {...press}>
                      <Icon size={17} /> {label} <Icon className="ocm-tile-art" size={40} />
                    </motion.button>
                  ))}
                </div>
              </motion.section>
              {/* Sections glide to their new order and fade when hidden or shown. */}
              <AnimatePresence>
                {prefs.homeOrder
                  .filter((id) => !prefs.homeHidden.includes(id))
                  .map((id) => (
                    <motion.div key={id} className={`ocm-hs-${id}`} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring}>
                      {home[id]}
                    </motion.div>
                  ))}
              </AnimatePresence>
            </motion.div>
          ) : tab === "calendar" ? (
            <motion.div key="calendar" className="ocm-calview" initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={calm}>
              <MobileCalendar pages={pages} day={calDay} setDay={setCalDay} onOpen={p.onOpen} hold={hold} onCreateTask={p.onCreateTask} />
            </motion.div>
          ) : (
            <motion.div key="pages" initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={calm}>
              <header className="ocm-title ocm-pages-head">
                <div>
                  <h1>Pages</h1>
                  <p>{selecting ? `${selected.size} selected` : `${listed.length} of ${pages.length} pages · ${SORTS[sortKey].toLowerCase()}`}</p>
                </div>
                <button className="ocm-head-btn" onClick={() => (buzz(), setSelecting((v) => !v), setSelected(new Set()))}>
                  {selecting ? "Done" : "Select"}
                </button>
              </header>
              {filter && (
                <button className="ocm-chip ocm-chip-on" onClick={() => (buzz(), setFilter(null))}>
                  {"tag" in filter ? <Tag size={13} /> : <FileText size={13} />} {"tag" in filter ? filter.tag : filter.title} <X size={14} />
                </button>
              )}
              <div className="ocm-search-row">
              <form className="ocm-search" onSubmit={(e) => (e.preventDefault(), remember(query), searchRef.current?.blur())}>
                <Search size={18} />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all pages" enterKeyHint="search" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
                {query && (
                  <button type="button" aria-label="Clear" onClick={() => setQuery("")}>
                    <X size={16} />
                  </button>
                )}
              </form>
              <button className={`ocm-filter-btn${shows.size || sortKey !== "edited" ? " on" : ""}`} aria-label="Sort and filter" onClick={() => (buzz(), setSheet("filter"))}>
                <SlidersHorizontal size={18} />
                {shows.size > 0 && <em>{shows.size}</em>}
              </button>
              </div>
              {/* Recent searches: shown while the empty box is focused. Pointer-down keeps the keyboard up. */}
              {focused && !q && recents.length > 0 && (
                <div className="ocm-recents" onPointerDown={(e) => e.preventDefault()}>
                  <div className="ocm-recents-head">
                    Recent searches
                    <button onClick={() => (buzz(), saveRecents([]))}>Clear</button>
                  </div>
                  {recents.map((t) => (
                    <div key={t} className="ocm-recent">
                      <button className="ocm-recent-term" onClick={() => (buzz(), setQuery(t), remember(t), searchRef.current?.blur())}>
                        <Clock size={17} /> <span>{t}</span>
                      </button>
                      <button aria-label={`Put “${t}” in the search box`} onClick={() => setQuery(t + " ")}>
                        <ArrowUpLeft size={17} />
                      </button>
                      <button aria-label={`Remove “${t}”`} onClick={() => (buzz(), saveRecents(recents.filter((x) => x !== t)))}>
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="ocm-list">
                {listed.map((x, i) => (
                  <Fragment key={x.id}>
                  {isTablet && sortKey === "edited" && (i === 0 || ageGroup(x.updatedAt) !== ageGroup(listed[i - 1].updatedAt)) && <p className="ocm-card-head ocm-group">{ageGroup(x.updatedAt)}</p>}
                  <motion.button
                    className={`ocm-row${selected.has(x.id) ? " sel" : ""}`}
                    onClick={() =>
                      selecting
                        ? (buzz(), setSelected((prev) => { const n = new Set(prev); n.has(x.id) ? n.delete(x.id) : n.add(x.id); return n; }))
                        : (q && remember(query), p.onOpen(x.id))
                    }
                    {...(selecting ? {} : hold(x.id))}
                    {...rise(i)}
                    {...press}
                  >
                    {selecting && <span className={`ocm-row-check${selected.has(x.id) ? " on" : ""}`}>{selected.has(x.id) && <Check size={14} />}</span>}
                    <span className="ocm-row-icon">{x.icon || "📄"}</span>
                    <span className="ocm-row-main">
                      <span className="ocm-row-title"><Highlight text={x.title || "Untitled"} query={query} /></span>
                      {q && hit[x.id] ? (
                        <span className="ocm-row-preview"><Highlight text={hit[x.id]} /></span>
                      ) : (
                        previews[x.id] && <span className="ocm-row-preview">{previews[x.id]}</span>
                      )}
                      <RowProps value={propsOf(x)} />
                    </span>
                    <span className="ocm-row-date">{edited(x.updatedAt)}</span>
                  </motion.button>
                  </Fragment>
                ))}
                {!listed.length && <p className="ocm-empty">{q ? `No pages match “${query}”.` : "No pages here."}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="ocm-nav-fade" aria-hidden />
      <AnimatePresence>
        {plusMenu && <motion.div className="ocm-plus-scrim" onClick={() => setPlusMenu(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      {selecting && tab === "pages" ? (
        <div className="ocm-bulk">
          <button disabled={!selected.size} onClick={() => bulk((x) => (picked2.every((y) => y.pinned) ? x.pinned : !x.pinned) && p.onPin(x.id))}>
            <Pin size={19} /> {picked2.length && picked2.every((y) => y.pinned) ? "Unpin" : "Pin"}
          </button>
          <button disabled={!selected.size} onClick={() => (buzz(), setSheet("bulktag"))}>
            <Tag size={19} /> Tag
          </button>
          <button disabled={!selected.size} onClick={() => (buzz(), setSheet("bulkstatus"))}>
            <CheckSquare size={19} /> Status
          </button>
          <button disabled={!selected.size} className="ocm-danger" onClick={() => bulk((x) => p.onTrash(x.id))}>
            <Trash2 size={19} /> Trash
          </button>
        </div>
      ) : (
      <nav className={`ocm-nav${compact ? " compact" : ""}`}>
        <div className="ocm-pill ocm-liquid">
          {TABS.map(([id, Icon, label]) => (
            <motion.button key={id} className={tab === id ? "on" : ""} aria-label={label} onClick={() => go(id)} whileTap={{ scale: 0.88 }} transition={spring}>
              {/* The glass lens springs between tabs. */}
              {tab === id && <motion.span layoutId="ocm-lens" className="ocm-lens" transition={spring} />}
              <Icon size={22} />
              <span className="ocm-pill-label">{label}</span>
            </motion.button>
          ))}
          {/* App switcher: only apps that work on Android are listed. */}
          <span className="ocm-apps-wrap">
            <motion.button aria-label="Apps" aria-expanded={appsMenu} onClick={() => (buzz(), setAppsMenu((o) => !o))} whileTap={{ scale: 0.88 }} transition={spring}>
              <LayoutGrid size={22} />
              <span className="ocm-pill-label">Apps</span>
            </motion.button>
            <AnimatePresence>
              {appsMenu && (
                <motion.div className="ocm-plus-menu ocm-apps-menu" initial={{ opacity: 0, scale: 0.85, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: 8 }} transition={spring}>
                  <button onClick={() => (setAppsMenu(false), buzz(), p.onSketch())}><i><img src={APPS.sketch.logo} alt="" width={20} /></i><span>{APPS.sketch.name}<small>{APPS.sketch.tagline}</small></span></button>
                </motion.div>
              )}
            </AnimatePresence>
          </span>
          <motion.button className="ocm-pill-me" aria-label="Profile" onClick={() => (buzz(), setSheet("profile"))} whileTap={{ scale: 0.88 }} transition={spring}>
            <Avatar name={p.userName} avatar={p.avatar} size={28} />
            <span className="ocm-pill-label">You</span>
          </motion.button>
        </div>
        <span className="ocm-plus-wrap">
          <AnimatePresence>
            {plusMenu && (
              <motion.div className="ocm-plus-menu" initial={{ opacity: 0, scale: 0.85, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: 8 }} transition={spring}>
                <button onClick={() => (setPlusMenu(false), buzz(), p.onCreate())}><i><FileText size={18} /></i><span>New page<small>Blank page</small></span></button>
                <button onClick={() => (setPlusMenu(false), buzz(), p.onCreateTask())}><i><CheckSquare size={18} /></i><span>New task<small>Checklist with due date</small></span></button>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.button
            className="ocm-plus ocm-liquid"
            aria-label={plusMenu ? "Close menu" : "New"}
            aria-expanded={plusMenu}
            onClick={() => (buzz(), setPlusMenu((o) => !o))}
            whileTap={{ scale: 0.88 }}
            transition={spring}
          >
            <motion.span style={{ display: "grid" }} animate={{ rotate: plusMenu ? 45 : 0 }} transition={spring}>
              <Plus size={24} />
            </motion.span>
          </motion.button>
        </span>
      </nav>
      )}
    </motion.div>
  );

  return (
    // "user": follows Android's Remove animations setting; Settings can force them off.
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
      <div className={`ocm-root${tablet ? ` ocm-tab ocm-${tablet} ocm-on-${tab}` : ""}`}>
        {/* No initial={false} here: Motion would then block entrance animations of everything inside. */}
        {/* Tablets keep the list (and its side rail) mounted under the page. */}
        <AnimatePresence>{tablet ? [list, page] : openPage ? page : list}</AnimatePresence>
        {sheets}
        {viewing && <AvatarViewer src={p.avatar} onClose={() => setViewing(false)} />}
      </div>
    </MotionConfig>
  );
}
