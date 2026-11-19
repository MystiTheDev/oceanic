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
  CalendarDays, ChevronLeft, Copy, FileText, Home, Layers, MoonStar, MoreHorizontal, Pin, Plus,
  RotateCcw, Search, Settings, Share2, Sun, Tag, Trash2, X,
} from "lucide-react";
import { api, type WorkspaceRecord } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { Avatar } from "../components/SettingsModal";
import "./mobile.css";
import { buzz, useMobilePrefs } from "./mobilePrefs";

/** True inside the Android (or iOS) app. */
export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

type TabId = "home" | "pages";
type Sheet = null | "profile" | "trash" | "workspaces" | "page";

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
  onSettings: () => void;
  onTags: () => void;
  onToggleTheme: () => void;
  onWorkspace: (id: string) => void;
  onPin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
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
      <path d="M-100 110 C-10 96 60 130 140 112 S250 96 340 114 S450 128 500 110 V140 H-100Z" opacity="0.28" className="ocm-w3" />
    </svg>
  );
}

const TABS = [
  ["home", Home, "Home"],
  ["pages", FileText, "Pages"],
] as const;

export function MobileShell(p: Props) {
  const prefs = useMobilePrefs();
  const { pages, openPage } = p;
  const [tab, setTab] = useState<TabId>("home");
  const [dir, setDir] = useState(1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
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
  const recent = [...sorted.filter((x) => x.pinned), ...sorted.filter((x) => !x.pinned)].slice(0, 6);
  const q = query.trim().toLowerCase();
  const listed = q ? sorted.filter((x) => (x.title || "Untitled").toLowerCase().includes(q)) : sorted;

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
                <button className="ocm-item" onClick={() => run(() => p.onExport(openPage.id))}>
                  <Share2 size={20} /> Export
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
      initial={{ x: "-25%", opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-25%", opacity: 0.6 }}
      transition={spring}
    >
      <div className="ocm-scroll" ref={scroller}>
        <AnimatePresence mode="wait" initial={false}>
          {tab === "home" ? (
            <motion.div key="home" initial={{ opacity: 0, x: -40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 * dir }} transition={calm}>
              <motion.header className="ocm-hero" style={{ y: heroY, opacity: heroFade }}>
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

              <motion.section className="ocm-card" {...rise(0)}>
                <button className="ocm-card-head" onClick={() => go("pages")}>
                  Recent pages <span>›</span>
                </button>
                {recent.length ? (
                  <div className="ocm-cards">
                    {recent.map((x, i) => (
                      <motion.button key={x.id} className="ocm-note" onClick={() => p.onOpen(x.id)} {...rise(i + 1)} {...press}>
                        <span className="ocm-note-icon">
                          {x.icon || "📄"}
                          {x.pinned && <Pin size={13} className="ocm-pin" />}
                        </span>
                        <span className="ocm-note-title">{x.title || "Untitled"}</span>
                        <span className="ocm-note-preview">{previews[x.id] ?? ""}</span>
                        <span className="ocm-note-date">{edited(x.updatedAt)}</span>
                      </motion.button>
                    ))}
                    {sorted.length > recent.length && (
                      <motion.button className="ocm-note ocm-seeall" onClick={() => go("pages")} {...rise(recent.length + 1)} {...press}>
                        See all
                        <span>{sorted.length} pages</span>
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <p className="ocm-empty">No pages yet. Tap + to write one.</p>
                )}
              </motion.section>

              <motion.section className="ocm-card" {...rise(2)}>
                <div className="ocm-card-head">Due soon</div>
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
            </motion.div>
          ) : (
            <motion.div key="pages" initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={calm}>
              <header className="ocm-title">
                <h1>Pages</h1>
                <p>{pages.length} pages · last edited first</p>
              </header>
              <label className="ocm-search">
                <Search size={18} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search page titles" />
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
                {q && !listed.length && <p className="ocm-empty">No page titles match “{query}”.</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className="ocm-nav">
        <div className="ocm-pill">
          {TABS.map(([id, Icon, label]) => (
            <motion.button key={id} layout className={tab === id ? "on" : ""} onClick={() => go(id)} transition={spring} whileTap={{ scale: 0.92 }}>
              {/* The accent pill slides between tabs. */}
              {tab === id && <motion.span layoutId="ocm-active" className="ocm-active" transition={spring} />}
              <Icon size={20} />
              {tab === id && (
                <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
                  {label}
                </motion.span>
              )}
            </motion.button>
          ))}
          {/* Calendar and Search arrive in the next step. */}
          <button disabled aria-label="Calendar (coming soon)">
            <CalendarDays size={20} />
          </button>
          <button disabled aria-label="Search (coming soon)">
            <Search size={20} />
          </button>
          <motion.button className="ocm-plus" aria-label="New page" onClick={() => (buzz(), p.onCreate())} whileTap={{ scale: 0.82, rotate: 90 }} transition={spring}>
            <Plus size={22} />
          </motion.button>
        </div>
      </nav>
    </motion.div>
  );

  return (
    // "user": follows Android's Remove animations setting; Settings can force them off.
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
      <div className="ocm-root">
        <AnimatePresence initial={false}>{screen}</AnimatePresence>
        {sheets}
      </div>
    </MotionConfig>
  );
}
