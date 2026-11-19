/**
 * Phone layout (Android): replaces the desktop title bar, tabs and sidebar.
 * Home and Pages tabs in a centred glass pill (with the + button at its end),
 * an open page full screen with back + page menu, and a profile sheet behind
 * the avatar. Android's back gesture closes sheets and pages.
 * Animations use Motion and follow Android's "Remove animations" setting.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, animate, motion, useScroll, useTransform, type Transition } from "motion/react";
import {
  CalendarDays, CheckSquare, ChevronDown, ChevronLeft, ChevronUp, Eye, EyeOff, Copy, FileText, Home, Layers, MoonStar, MoreHorizontal, Pin, Plus,
  RotateCcw, Search, Settings, Sun, Tag, Trash2, X,
} from "lucide-react";
import { api, type WorkspaceRecord } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { Avatar } from "../components/SettingsModal";
import "./mobile.css";
import { HOME_SECTIONS, buzz, setMobilePref, useMobilePrefs, type HomeSection } from "./mobilePrefs";

/** True inside the Android (or iOS) app. */
export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

type TabId = "home" | "pages";
type Filter = null | { tag: string } | { folder: string; title: string };
type Sheet = null | "home" | "profile" | "trash" | "workspaces" | "page";

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
  onCreateTask: () => void;
  visitedAt: Record<string, number>;
  onSettings: () => void;
  onTags: () => void;
  onToggleTheme: () => void;
  onWorkspace: (id: string) => void;
  onPin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
};

const DAY = 86_400_000;
const today = () => new Date(new Date().toDateString()).getTime();

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
  initial: { opacity: 0, y: 18 },
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

const TABS = [
  ["home", Home, "Home"],
  ["pages", FileText, "Pages"],
] as const;

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(null);
  const [recentTab, setRecentTab] = useState<"recent" | "suggested">("recent");
  const searchRef = useRef<HTMLInputElement>(null);
  const sorted = useMemo(() => [...pages].sort(byEdited), [pages]);
  const previews = usePreviews(sorted.map((x) => x.id));

  // Home header parallax: moves slower than the content and fades as you scroll.
  const scroller = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scroller });
  const heroY = useTransform(scrollY, [0, 200], [0, 80]);
  const heroFade = useTransform(scrollY, [0, 180], [1, 0.2]);

  // Android back gesture: an open page or sheet adds a history entry; going back closes it.
  const layer = sheet ?? (openPage ? `page:${openPage.id}` : null);
  useEffect(() => {
    if (!layer) return;
    history.pushState({ oc: layer }, "");
    const onPop = () => (sheet ? setSheet(null) : p.onBack());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [layer]);
  const closeSheet = () => history.back();
  const run = (fn: () => void) => {
    buzz();
    setSheet(null);
    fn();
  };

  const go = (t: TabId) => {
    if (t === tab) return;
    buzz();
    setDir(t === "pages" ? 1 : -1);
    setTab(t);
  };

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
  const listed = sorted.filter(
    (x) =>
      (!q || (x.title || "Untitled").toLowerCase().includes(q)) &&
      (!filter || ("tag" in filter ? x.tags?.includes(filter.tag) : x.parentId === filter.folder)),
  );

  const more = (
    <button className="ocm-more" aria-label="Customize Home" onClick={() => (buzz(), setSheet("home"))}>
      <MoreHorizontal size={18} />
    </button>
  );
  const pinned = sorted.filter((x) => x.pinned);
  const home: Record<HomeSection, ReactNode> = {
    create: (
      <motion.div className="ocm-tiles" {...rise(1)}>
        <motion.button className="ocm-tile ocm-tile-page" onClick={() => (buzz(), p.onCreate())} {...press}>
          <Plus size={18} /> New page <FileText className="ocm-tile-art" size={64} />
        </motion.button>
        <motion.button className="ocm-tile ocm-tile-task" onClick={() => (buzz(), p.onCreateTask())} {...press}>
          <Plus size={18} /> New task <CheckSquare className="ocm-tile-art" size={64} />
        </motion.button>
      </motion.div>
    ),
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
                  {more}
                </div>
                {shown.length ? (
                  <motion.div key={recentTab} className="ocm-cards" >
                    {shown.map((x, i) => (
                      <motion.button key={x.id} className="ocm-note ocm-glass" onClick={() => p.onOpen(x.id)} {...slideIn(i, recentTab === "recent" ? -1 : 1)} {...press}>
                        {x.pinned && (
                          <span className="ocm-pin" aria-label="Pinned">
                            <Pin size={13} />
                          </span>
                        )}
                        <span className="ocm-note-icon">{x.icon || "📄"}</span>
                        <span className="ocm-note-title">{x.title || "Untitled"}</span>
                        <span className="ocm-note-preview">{previews[x.id] ?? ""}</span>
                        <span className="ocm-note-date">{edited(x.updatedAt)}</span>
                      </motion.button>
                    ))}
                    {recentTab === "recent" && (
                      <motion.button className="ocm-note ocm-glass ocm-seeall" onClick={() => openFilter(null)} {...slideIn(shown.length, -1)} {...press}>
                        See all
                        <span>{sorted.length} pages</span>
                      </motion.button>
                    )}
                  </motion.div>
                ) : (
                  <p className="ocm-empty">No pages yet. Tap + to write one.</p>
                )}
              </motion.section>


    ),
    shortcuts: pinned.length > 0 && (
      <motion.section className="ocm-sec" {...rise(2)}>
        <div className="ocm-card-head">Shortcuts {more}</div>
        <div className="ocm-shortcuts">
          {pinned.map((x, i) => (
            <motion.button key={x.id} className="ocm-shortcut ocm-glass" onClick={() => p.onOpen(x.id)} {...rise(i + 3)} {...press}>
              {x.icon || "📄"} {x.title || "Untitled"}
            </motion.button>
          ))}
        </div>
      </motion.section>
    ),
    tags: (
              (tags.length > 0 || folders.length > 0) && (
                <motion.section className="ocm-sec" {...rise(1)}>
                  <div className="ocm-card-head">Tags &amp; collections {more}</div>
                  {tags.length > 0 && (
                    <div className="ocm-chips">
                      {tags.map(([t, n], i) => (
                        <motion.button key={t} className="ocm-chip" onClick={() => (buzz(), openFilter({ tag: t }))} {...rise(i + 2)} {...press}>
                          <Tag size={13} /> {t} <em>{n}</em>
                        </motion.button>
                      ))}
                    </div>
                  )}
                  {folders.length > 0 && (
                    <div className="ocm-folders">
                      {folders.map(({ page: x, count }, i) => (
                        <motion.button
                          key={x.id}
                          className="ocm-folder ocm-glass"
                          onClick={() => (buzz(), openFilter({ folder: x.id, title: x.title || "Untitled" }))}
                          {...rise(i + 3)}
                          {...press}
                        >
                          <span className="ocm-folder-icon">{x.icon || "📁"}</span>
                          <span className="ocm-folder-title">{x.title || "Untitled"}</span>
                          <span className="ocm-folder-n">{count} {count === 1 ? "page" : "pages"}</span>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </motion.section>
              )
    ),
    due: (
              <motion.section className="ocm-card ocm-glass" {...rise(2)}>
                <div className="ocm-card-head">Due soon {more}</div>
                {soon.length ? (
                  soon.map((x, i) => (
                    <motion.button key={x.id} className="ocm-due" onClick={() => p.onOpen(x.id)} {...rise(i + 3)} {...press}>
                      <span>
                        {x.icon} {x.title || "Untitled"}
                      </span>
                      <span className={due(x.dueDate!) === "Overdue" ? "ocm-overdue" : ""}>{due(x.dueDate!)}</span>
                    </motion.button>
                  ))
                ) : (
                  <p className="ocm-empty">Nothing due this week.</p>
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
                  <Avatar name={p.userName} avatar={p.avatar} size={52} />
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
                <button className="ocm-item" onClick={() => run(p.onSettings)}>
                  <Settings size={20} /> Settings
                </button>
              </>
            )}
            {sheet === "home" && (
              <>
                <h2>Customize Home</h2>
                {prefs.homeOrder.map((id, i) => {
                  const off = prefs.homeHidden.includes(id);
                  const move = (d: number) => {
                    const o = [...prefs.homeOrder];
                    [o[i], o[i + d]] = [o[i + d], o[i]];
                    buzz();
                    setMobilePref({ homeOrder: o });
                  };
                  return (
                    <motion.div key={id} layout transition={spring} className={`ocm-trash ${off ? "ocm-off" : ""}`}>
                      <span>{HOME_SECTIONS[id]}</span>
                      <button aria-label="Move up" disabled={!i} onClick={() => move(-1)}><ChevronUp size={18} /></button>
                      <button aria-label="Move down" disabled={i === prefs.homeOrder.length - 1} onClick={() => move(1)}><ChevronDown size={18} /></button>
                      <button aria-label={off ? "Show" : "Hide"} onClick={() => (buzz(), setMobilePref({ homeHidden: off ? prefs.homeHidden.filter((h) => h !== id) : [...prefs.homeHidden, id] }))}>
                        {off ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </motion.div>
                  );
                })}
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
            {sheet === "page" && openPage && (
              <>
                <button className="ocm-item" onClick={() => run(() => p.onPin(openPage.id))}>
                  <Pin size={20} /> {openPage.pinned ? "Unpin" : "Pin"}
                </button>
                <button className="ocm-item" onClick={() => run(() => p.onDuplicate(openPage.id))}>
                  <Copy size={20} /> Duplicate
                </button>
                <button className="ocm-item ocm-danger" onClick={() => run(() => p.onTrash(openPage.id))}>
                  <Trash2 size={20} /> Move to Trash
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // The open page slides in from the right over the list; back slides it out.
  const screen = openPage ? (
    <motion.div key="page" className="ocm ocm-page ocm-layer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring}>
      <header className="ocm-pagebar">
        <motion.button {...press} className="ocm-icon" aria-label="Back" onClick={() => history.back()}>
          <ChevronLeft size={24} />
        </motion.button>
        <motion.button {...press} className="ocm-icon" aria-label="Page menu" onClick={() => (buzz(), setSheet("page"))}>
          <MoreHorizontal size={22} />
        </motion.button>
      </header>
      <div className="ocm-editor">{p.editor}</div>
    </motion.div>
  ) : (
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
            <motion.div key="home" initial={{ opacity: 0, x: -40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 * dir }} transition={calm}>
              <motion.header className={`ocm-hero ocm-${tod}`} style={{ y: heroY, opacity: heroFade }}>
                {/* Sun low at dawn/dusk, high by day; a moon and twinkling stars at night. */}
                <span className="ocm-sun" aria-hidden />
                {/* Stars stay mounted so they can fade in and out with the sky. */}
                {[12, 28, 47, 63, 80, 91, 36, 70].map((x, i) => (
                    <span key={i} className="ocm-star" style={{ left: `${x}%`, top: `${8 + ((i * 37) % 50)}%`, animationDelay: `${i * 0.4}s` }} aria-hidden />
                  ))}
                <Waves />
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
                  <motion.button {...press} className="ocm-avatar" aria-label="Profile" onClick={() => (buzz(), setSheet("profile"))}>
                    <Avatar name={p.userName} avatar={p.avatar} size={42} />
                  </motion.button>
                </div>
              </motion.header>

              {/* Opens the Pages search until the Search tab (phase 3) lands. */}
              <motion.button className="ocm-search ocm-glass ocm-find" onClick={() => (buzz(), openFilter(null), setTimeout(() => searchRef.current?.focus(), 300))} {...rise(0)} {...press}>
                <Search size={18} /> Find any page
              </motion.button>
              {/* Sections glide to their new order and fade when hidden or shown. */}
              <AnimatePresence>
                {prefs.homeOrder
                  .filter((id) => !prefs.homeHidden.includes(id))
                  .map((id) => (
                    <motion.div key={id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring}>
                      {home[id]}
                    </motion.div>
                  ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="pages" initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={calm}>
              <header className="ocm-title">
                <h1>Pages</h1>
                <p>{pages.length} pages · last edited first</p>
              </header>
              {filter && (
                <button className="ocm-chip ocm-chip-on" onClick={() => (buzz(), setFilter(null))}>
                  {"tag" in filter ? <Tag size={13} /> : <FileText size={13} />} {"tag" in filter ? filter.tag : filter.title} <X size={14} />
                </button>
              )}
              <label className="ocm-search">
                <Search size={18} />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search page titles" />
                {query && (
                  <button aria-label="Clear" onClick={() => setQuery("")}>
                    <X size={16} />
                  </button>
                )}
              </label>
              <div className="ocm-list">
                {listed.map((x, i) => (
                  <motion.button key={x.id} className="ocm-row" onClick={() => p.onOpen(x.id)} {...rise(i)} {...press}>
                    <span className="ocm-row-icon">{x.icon || "📄"}</span>
                    <span className="ocm-row-main">
                      <span className="ocm-row-title">{x.title || "Untitled"}</span>
                      {previews[x.id] && <span className="ocm-row-preview">{previews[x.id]}</span>}
                    </span>
                    <span className="ocm-row-date">{edited(x.updatedAt)}</span>
                  </motion.button>
                ))}
                {!listed.length && <p className="ocm-empty">{q ? `No page titles match “${query}”.` : "No pages here."}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className="ocm-nav">
        {/* Liquid-glass refraction: the backdrop is displaced by a smooth noise map. */}
        <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
          <filter id="ocm-refract" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="2" seed="7" result="n" />
            <feGaussianBlur in="n" stdDeviation="2" result="m" />
            <feDisplacementMap in="SourceGraphic" in2="m" scale="38" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <div className="ocm-pill ocm-liquid">
          {TABS.map(([id, Icon, label]) => (
            <motion.button key={id} className={tab === id ? "on" : ""} aria-label={label} onClick={() => go(id)} whileTap={{ scale: 0.88 }} transition={spring}>
              <Icon size={22} />
              {/* The dot slides between tabs. */}
              {tab === id && <motion.span layoutId="ocm-dot" className="ocm-dot" transition={spring} />}
            </motion.button>
          ))}
          {/* Calendar and Search arrive in the next step. */}
          <button disabled aria-label="Calendar (coming soon)">
            <CalendarDays size={22} />
          </button>
          <button disabled aria-label="Search (coming soon)">
            <Search size={22} />
          </button>
        </div>
        <motion.button className="ocm-plus ocm-liquid" aria-label="New page" onClick={() => (buzz(), p.onCreate())} whileTap={{ scale: 0.82, rotate: 90 }} transition={spring}>
          <Plus size={24} />
        </motion.button>
      </nav>
    </motion.div>
  );

  return (
    // "user": follows Android's Remove animations setting; Settings can force them off.
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
      <div className="ocm-root">
        {/* No initial={false} here: Motion would then block entrance animations of everything inside. */}
        <AnimatePresence>{screen}</AnimatePresence>
        {sheets}
      </div>
    </MotionConfig>
  );
}
