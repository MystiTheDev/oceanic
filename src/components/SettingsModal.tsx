import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { AvatarCropper, AvatarViewer } from "./AvatarCropper";
import { set as setSrs, useSrs } from "../lib/srs";
import { PACKS, addToDictionary, forgetLearned, removeFromDictionary, setPacks, setReplacements, setSpellSettings, useSpell, type Dialect } from "../lib/spell/engine";
import { DELETE_APPS, setAskBeforeDelete, useConfirmDelete } from "../lib/confirmDelete";
import { checkForUpdates, useUpdates } from "../lib/updates";
import { pickSketchFolder, setSketchLayout, useSketch, type SketchLayout } from "../sketch/store";
import { pickFolder, setUiStyle, useDocs, type DocsUiStyle } from "../docs/store";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "../lib/dialog";
import {
  AppWindow, Brush, Check, ChevronRight, SpellCheck, ChevronDown, Database, FileText, GraduationCap, Info, Keyboard, Network, Palette, Search, Settings2, Smartphone, Smile, Sparkles, StickyNote, Trash2, Upload, User, X,
} from "lucide-react";
import { api } from "../data/api";
import { resetAtlasGuide } from "./AtlasGuide";
import { startTour } from "./Tour";
import { startSetup } from "./SetupWizard";
import { APP_VERSION } from "./SidebarFooter";
import { NeridaSettings } from "./NeridaSettings";
import { NeridaMark } from "./NeridaOrb";
import { Modal, ModalButton } from "./Modal";
import { EmojiPicker } from "./EmojiPicker";
import { useEscape } from "../lib/overlay";
import { SyncSettings } from "./SyncSettings";
import logo from "../assets/logo-raw.png";
import docsLogo from "../assets/docs-logo.png";
import sketchLogo from "../assets/sketch-logo.png";
import mindmapLogo from "../assets/mindmap-logo.png";
import { motion } from "framer-motion";
import { DENSITIES, ZOOMS, getDensity, getZoom, setUiScale } from "../lib/uiScale";

export const ACCENTS = ["#2383e2", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#d946ef"];

export type AppSettings = {
  userName: string;
  /** "" = coloured initial, an emoji, or a data: URL photo (128px). */
  avatar: string;
  theme: "dark" | "light" | "system";
  accent: string;
  closeToTray: boolean;
  /** What's in front at launch. Saved tabs are restored either way. */
  startup: "home" | "last" | "nerida";
  /** Home page look: the classic Oceanic Home or the student dashboard. */
  homeStyle: "classic" | "student";
  weekStart: "sunday" | "monday";
  /** Notes editor text size. */
  editorSize: "small" | "default" | "large";
  /** Focus timer's two-note chime when a session ends. */
  studyChime: boolean;
  /** Short splash when switching apps from the sidebar. */
  appLoader: boolean;
  /** Sidebar nav icon colours; `sidebarColors` is JSON of item → hex, used when "custom". */
  sidebarIcons: "subtle" | "richer" | "custom";
  sidebarColors: string;
};

export const SIDEBAR_ITEMS = [["home", "Home"], ["library", "Library"], ["tags", "Tags"], ["trash", "Trash"], ["import", "Import"]] as const;
const RICHER: Record<string, string> = { home: "#5aa2e9", library: "#a78bfa", tags: "#4ade80", trash: "#f87171", import: "#fbbf24" };
export const sidebarPalette = (s: AppSettings): Record<string, string> | null => {
  if (s.sidebarIcons === "subtle") return null;
  if (s.sidebarIcons === "richer") return RICHER;
  try {
    return { ...RICHER, ...JSON.parse(s.sidebarColors || "{}") };
  } catch {
    return RICHER;
  }
};

/* ------------------------------------------------------------------ registry
   Every row is data, so search can show matches from all pages at once. */
type Ctx = { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void };
type Row = { icon?: ReactNode; title: string; description?: ReactNode; keywords?: string; control: (c: Ctx) => ReactNode; wide?: boolean };
type Group = { heading?: string; icon?: ReactNode; cols?: boolean; rows: Row[] };
type PageId = "account" | "preferences" | "general" | "storage" | "deleting" | "shortcuts" | "about" | "docs" | "sketch" | "mindmap" | "study" | "spelling" | "nerida" | "sync";
type Page = { id: PageId; label: string; icon: ReactNode; color: string; blurb: string; groups?: Group[]; custom?: (c: Ctx) => ReactNode; hero?: boolean; bare?: boolean; keywords?: string };

const NAV: { heading: string; pages: PageId[] }[] = [
  { heading: "General", pages: ["general", "preferences", "shortcuts", "spelling"] },
  { heading: "Sync & data", pages: ["sync", "storage", "deleting"] },
  { heading: "AI", pages: ["nerida"] },
  { heading: "Apps", pages: ["docs", "sketch", "mindmap", "study"] },
  { heading: "", pages: ["about"] },
];

const kbd = (...keys: string[]) => (
  <span className="flex items-center gap-1">
    {keys.map((k) => (
      <kbd key={k} className="min-w-[22px] rounded-md bg-white/[0.08] px-1.5 py-0.5 text-center font-sans text-[11.5px] font-medium text-neutral-200 shadow-[inset_0_-1px_0_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.08)]">{k}</kbd>
    ))}
  </span>
);
const sc = (title: string, ...keys: string[]): Row => ({ title, keywords: keys.join(" "), control: () => kbd(...keys) });

const local = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const setLocal = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked */
  }
};

/** Tinted app icon for rows (same look as the sidebar tiles). */
const AppTile = ({ icon, color }: { icon: ReactNode; color: string }) => (
  <span className="oc-keep -mr-2 grid size-7 shrink-0 place-items-center rounded-[28%] [&_svg]:size-4" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>{icon}</span>
);
const DELETE_ICONS: Record<(typeof DELETE_APPS)[number]["id"], { icon: ReactNode; color: string }> = {
  notes: { icon: <StickyNote />, color: "#eab308" },
  docs: { icon: <FileText />, color: "#2b7cd3" },
  sketch: { icon: <Brush />, color: "#ff375f" },
  mindmap: { icon: <Network />, color: "#30d158" },
};

const PAGES: Page[] = [
  { id: "account", label: "My account", icon: <User />, color: "#8e8e93", blurb: "Your name and profile picture.", hero: true, custom: (c) => <AccountPage {...c} /> },
  {
    id: "preferences",
    label: "Appearance",
    icon: <Palette />,
    color: "#5e5ce6",
    blurb: "Theme, colours, text size, zoom and density.",
    groups: [
      {
        heading: "Appearance",
        rows: [
          {
            title: "Theme",
            description: "Use system setting follows Windows' light or dark mode.",
            keywords: "dark light mode",
            control: ({ settings, onChange }) => (
              <Select value={settings.theme} onChange={(theme) => onChange({ theme })} options={[["system", "Use system setting"], ["light", "Light"], ["dark", "Dark"]]} />
            ),
          },
          { title: "Accent color", description: "Selections, focus rings, links and primary buttons.", keywords: "colour", control: (c) => <AccentPicker {...c} /> },
          { title: "Sidebar icons", description: "Subtle grey, Richer colours, or pick your own colour for each item.", keywords: "colour sidebar icons", control: (c) => <SidebarIconsPicker {...c} /> },
          {
            title: "Editor text size",
            description: "Text size in notes. Headings scale with it.",
            keywords: "font zoom",
            control: ({ settings, onChange }) => (
              <Select value={settings.editorSize} onChange={(editorSize) => onChange({ editorSize })} options={[["small", "Small"], ["default", "Default"], ["large", "Large"]]} />
            ),
          },
        ],
      },
      {
        heading: "Layout",
        rows: [
          { title: "Interface zoom", description: "Scales all of Oceanic on this device.", keywords: "zoom scale size bigger smaller", control: () => <ScaleSelect kind="zoom" /> },
          { title: "Density", description: "Compact fits more on screen; Relaxed adds breathing room. This device only.", keywords: "compact relaxed spacing tight", control: () => <ScaleSelect kind="density" /> },
        ],
      },
      {
        heading: "Date & time",
        rows: [
          {
            title: "Start week on",
            description: "Calendar and the class timetable.",
            keywords: "monday sunday calendar",
            control: ({ settings, onChange }) => (
              <Select value={settings.weekStart} onChange={(weekStart) => onChange({ weekStart })} options={[["sunday", "Sunday"], ["monday", "Monday"]]} />
            ),
          },
        ],
      },
    ],
  },
  {
    id: "general",
    label: "General",
    icon: <Settings2 />,
    color: "#8e8e93",
    blurb: "Startup, window and tray behaviour.",
    groups: [
      {
        heading: "Startup",
        rows: [
          { title: "Launch at login", description: "Start Oceanic when you sign in, so study reminders arrive on time.", keywords: "startup autostart boot windows", control: () => <LaunchSwitch cmd="autostart" /> },
          { title: "Start minimized", description: "Stay in the system tray when launched at login.", keywords: "startup tray hidden background", control: () => <LaunchSwitch cmd="start_minimized" /> },
          {
            title: "Open on startup",
            description: "Which tab is in front when Oceanic starts. Open tabs are always restored.",
            keywords: "launch",
            control: ({ settings, onChange }) => (
              <Select value={settings.startup} onChange={(startup) => onChange({ startup })} options={[["last", "Last opened page"], ["home", "Home"], ["nerida", "Nerida AI"]]} />
            ),
          },
        ],
      },
      {
        heading: "Window",
        rows: [
          { title: "Close to system tray", description: "Hide to the tray instead of quitting when you click ×.", keywords: "background", control: ({ settings, onChange }) => <Switch on={settings.closeToTray} onChange={(closeToTray) => onChange({ closeToTray })} /> },
          { title: "Loading screen when switching apps", description: "A short logo splash when you switch apps from More apps.", keywords: "splash animation intro", control: ({ settings, onChange }) => <Switch on={settings.appLoader} onChange={(appLoader) => onChange({ appLoader })} /> },
          {
            title: "Home screen",
            description: "Plain Home, or the Student dashboard with tasks and deadlines.",
            keywords: "dashboard study student classic",
            control: ({ settings, onChange }) => (
              <Select value={settings.homeStyle} onChange={(homeStyle) => onChange({ homeStyle })} options={[["classic", "Plain Home"], ["student", "Student dashboard"]]} />
            ),
          },
        ],
      },
      {
        heading: "Help",
        rows: [{ title: "Atlas tutorial", description: "Show the getting-started checklist next time you open Atlas.", keywords: "onboarding guide help concepts", control: () => <Btn onClick={resetAtlasGuide}>Restart</Btn> }],
      },
    ],
  },
  {
    id: "storage",
    label: "Storage",
    icon: <Database />,
    color: "#64748b",
    blurb: "Where your notes live and which folders Oceanic remembers.",
    groups: [
      { heading: "Database", rows: [{ title: "Database location", description: <StoragePath />, keywords: "folder move backup", control: () => <MoveStorage />, wide: true }] },
      { heading: "Privacy", rows: [{ title: "Folder access", description: <FolderAccessInfo />, keywords: "privacy permissions forget folders files security", control: () => <ForgetFolders /> }] },
    ],
  },
  {
    id: "deleting",
    label: "Deleting",
    icon: <Trash2 />,
    color: "#ff453a",
    blurb: "Oceanic asks before a file is deleted or removed. Open files always need closing first.",
    groups: [
      {
        heading: "Ask before deleting",
        rows: [
          { title: "All apps", keywords: "confirm delete trash", control: () => <span className="flex gap-1.5"><Btn onClick={() => DELETE_APPS.forEach((a) => setAskBeforeDelete(a.id, true))}>All on</Btn><Btn onClick={() => DELETE_APPS.forEach((a) => setAskBeforeDelete(a.id, false))}>All off</Btn></span> },
          ...DELETE_APPS.map((a) => ({
            icon: <AppTile {...DELETE_ICONS[a.id]} />,
            title: a.label,
            keywords: "confirm delete trash",
            control: () => <DeleteSwitch app={a.id} />,
          })),
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: <Keyboard />,
    color: "#64748b",
    blurb: "Every keyboard shortcut in Oceanic.",
    groups: [
      {
        heading: "All apps", cols: true, icon: <AppTile icon={<Keyboard />} color="#8e8e93" />,
        rows: [
          sc("Search", "Ctrl", "K"), sc("Settings", "Ctrl", ","), sc("New item in this app", "Ctrl", "N"), sc("Embed in a note (Docs, Sketch, Mindmap)", "Ctrl", "Shift", "M"), sc("New tab", "Ctrl", "T"), sc("Close tab", "Ctrl", "W"),
          sc("Next tab", "Ctrl", "Tab"), sc("Previous tab", "Ctrl", "Shift", "Tab"), sc("Go to tab 1–8 / last", "Ctrl", "1–9"),
          sc("Show / hide sidebar", "Ctrl", "\\"), sc("Back", "Alt", "←"), sc("Forward", "Alt", "→"),
        ],
      },
      { heading: "Notes editor", cols: true, icon: <img src={logo} alt="" className="size-5 object-contain" />, rows: [sc("Commands menu", "/"), sc("Link to a page", "[["), sc("Bold", "Ctrl", "B"), sc("Italic", "Ctrl", "I"), sc("Underline", "Ctrl", "U")] },
      { heading: "Oceanic Docs", cols: true, icon: <img src={docsLogo} alt="" className="size-5 object-contain" />, rows: [sc("Save", "Ctrl", "S"), sc("Collapse / pin the ribbon", "Ctrl", "F1")] },
      {
        heading: "Oceanic Sketch", cols: true, icon: <img src={sketchLogo} alt="" className="size-5 object-contain" />,
        rows: [sc("Open image", "Ctrl", "O"), sc("Save", "Ctrl", "S"), sc("Undo", "Ctrl", "Z"), sc("Redo", "Ctrl", "Y"), sc("Zoom in", "Ctrl", "+"), sc("Zoom out", "Ctrl", "−"), sc("Fit to window", "Ctrl", "0")],
      },
      { heading: "Oceanic Mindmap", cols: true, icon: <img src={mindmapLogo} alt="" className="size-5 object-contain" />, rows: [sc("Add child topic", "Tab"), sc("Add sibling topic", "Enter"), sc("Edit topic", "F2"), sc("Delete topic", "Del")] },
    ],
  },
  { id: "sync", label: "Sync", icon: <Smartphone />, color: "#0a84ff", blurb: "Keep your phone and PC in step.", custom: () => <SyncSettings /> },
  { id: "spelling", label: "Spelling", icon: <SpellCheck />, color: "#ff9f0a", blurb: "Spellcheck, your dictionary and subject packs.", bare: true, custom: () => <SpellingPage /> },
  { id: "nerida", label: "Nerida AI", icon: <NeridaMark size={16} />, color: "#14b8a6", blurb: "The on-device AI assistant.", bare: true, custom: () => (
    <>
      <div className="mt-[var(--st-gap)] flex gap-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-300" />
        <p className="text-[12.5px] leading-snug text-neutral-300">Nerida is an AI and can make mistakes. Check important facts, dates, numbers and sources before you rely on them, especially for study and exams.</p>
      </div>
      <div className="mt-3"><NeridaSettings /></div>
    </>
  ) },
  { id: "about", label: "About", icon: <Info />, color: "#0a84ff", blurb: "Version, updates and credits.", keywords: "update updates upgrade check version release tour replay tutorial walkthrough", hero: true, custom: () => <AboutPage /> },
  {
    id: "docs",
    label: "Oceanic Docs",
    icon: <FileText />,
    color: "#2b7cd3",
    blurb: "Toolbar style and where documents are saved.",
    groups: [
      {
        rows: [
          { title: "Toolbar style", description: "Word-style ribbon, a single Google Docs-style toolbar, or a minimal floating bar.", keywords: "ribbon", control: () => <DocsStyle /> },
          { title: "Docs folder", description: <DocsFolder />, keywords: "location", control: () => <Btn onClick={pickFolder}>Change…</Btn> },
        ],
      },
    ],
  },
  {
    id: "sketch",
    label: "Oceanic Sketch",
    icon: <Brush />,
    color: "#ff375f",
    blurb: "Layout and where images are saved.",
    groups: [
      {
        rows: [
          { title: "Layout", description: "How Oceanic Sketch arranges its tools.", keywords: "paint photoshop", control: () => <SketchLayoutPick />, wide: true },
          { title: "Sketch folder", description: <SketchFolder />, keywords: "location", control: () => <Btn onClick={pickSketchFolder}>Change…</Btn> },
        ],
      },
    ],
  },
  {
    id: "mindmap",
    label: "Oceanic Mindmap",
    icon: <Network />,
    color: "#30d158",
    blurb: "Minimap and Mindmap Home.",
    groups: [
      {
        rows: [
          { title: "Show minimap", description: "Open maps with the minimap visible.", keywords: "overview", control: () => <LocalSwitch storageKey="oceanic.mindmapMinimap" /> },
          {
            title: "Home layout",
            description: "How your maps are listed on Mindmap Home.",
            keywords: "grid list gallery",
            control: () => <LocalSelect storageKey="oceanic.mindmapGallery" fallback="grid" options={[["grid", "Grid"], ["list", "List"]]} />,
          },
        ],
      },
    ],
  },
  {
    id: "study",
    label: "Study dashboard",
    icon: <GraduationCap />,
    color: "#bf5af2",
    blurb: "Focus timer and flashcards.",
    groups: [
      {
        heading: "Focus timer",
        rows: [{ title: "Play a chime", description: "A soft two-note chime when a focus session or break ends.", keywords: "sound timer pomodoro", control: ({ settings, onChange }) => <Switch on={settings.studyChime} onChange={(studyChime) => onChange({ studyChime })} /> }],
      },
      {
        heading: "Flashcards",
        rows: [{ title: "New cards per day", description: "How many never-reviewed cards join your reviews each day.", keywords: "flashcards srs spaced repetition limit", control: () => <NewPerDay /> }],
      },
    ],
  },
];
const pageOf = (id: PageId) => PAGES.find((p) => p.id === id)!;

/** Launch-at-login toggles (desktop only): read and set through the app's commands. */
function LaunchSwitch({ cmd }: { cmd: "autostart" | "start_minimized" }) {
  const [on, setOn] = useState(false);
  const [autostart, setAutostart] = useState(true);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>(`${cmd}_get`).then(setOn).catch(() => {});
    // Start minimized only matters with Launch at login on: follow it.
    if (cmd !== "start_minimized") return;
    const load = () => void invoke<boolean>("autostart_get").then(setAutostart).catch(() => {});
    load();
    launchChanged.addEventListener("change", load);
    return () => launchChanged.removeEventListener("change", load);
  }, [cmd]);
  const set = (v: boolean) => (setOn(v), void invoke(`${cmd}_set`, { on: v }).then(() => launchChanged.dispatchEvent(new Event("change"))).catch(() => setOn(!v)));
  const off = cmd === "start_minimized" && !autostart;
  return (
    <span data-tip={off ? "Turn on Launch at login first" : undefined} className="inline-flex">
      <span className={off ? "pointer-events-none opacity-40" : undefined}><Switch on={on && !off} onChange={set} /></span>
    </span>
  );
}
const launchChanged = new EventTarget();

/** Notion-style settings: profile + search + grouped pages on the left, rows on the right. */
export function SettingsModal({ settings, onChange, onClose, initialPage = "account" }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void; onClose: () => void; initialPage?: string }) {
  const [page, setPage] = useState<PageId>(initialPage as PageId);
  const [query, setQuery] = useState("");
  const ctx = { settings, onChange };
  const q = query.trim().toLowerCase();

  /** Search: every matching row, grouped by its page. */
  const results = useMemo(() => {
    if (!q) return [];
    const text = (r: Row) => `${r.title} ${typeof r.description === "string" ? r.description : ""} ${r.keywords ?? ""}`.toLowerCase();
    return PAGES.flatMap((p) => {
      const rows = (p.groups ?? []).flatMap((g) => g.rows).filter((r) => text(r).includes(q) || p.label.toLowerCase().includes(q));
      return rows.length || p.keywords?.includes(q) ? [{ page: p, rows }] : [];
    });
  }, [q]);

  return (
    <Modal glass onClose={onClose} className="oc-settings relative flex h-[min(720px,88vh)] w-[min(1150px,94vw)]">
      <nav className="oc-st-side scrollbar-thin relative m-2 mr-0 flex w-[240px] shrink-0 flex-col overflow-y-auto rounded-2xl px-2.5 pb-3 pt-3">
        <label className="oc-st-search mb-3 flex h-8 items-center gap-1.5 rounded-full px-3 focus-within:ring-2 focus-within:ring-[color:var(--color-sky-500)]/50">
          <Search className="size-3.5 shrink-0 text-neutral-500" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
          )}
        </label>
        {/* Profile (macOS: the account card on top of the list) */}
        <button type="button" onClick={() => (setQuery(""), setPage("account"))} className={`relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${!q && page === "account" ? "" : "hover:bg-white/[0.05]"}`}>
          {!q && page === "account" && <motion.span layoutId="oc-st-pill" transition={{ duration: 0.18 }} className="oc-st-pill absolute inset-0 rounded-lg" />}
          <span className="relative"><Avatar name={settings.userName} avatar={settings.avatar} size={36} /></span>
          <span className="relative min-w-0">
            <span className={`block truncate text-[13.5px] font-semibold ${!q && page === "account" ? "text-neutral-50" : "text-neutral-100"}`}>{settings.userName || "You"}</span>
            <span className={`block truncate text-[11.5px] ${!q && page === "account" ? "text-neutral-400" : "text-neutral-500"}`}>Profile</span>
          </span>
        </button>
        {NAV.map((g) => (
          <div key={g.heading || "end"} className="mt-[var(--st-gap-nav)]">
            {g.heading && <p className="px-2 pb-1 text-[11px] font-semibold text-neutral-500">{g.heading}</p>}
            {g.pages.map((id) => {
              const p = pageOf(id);
              const on = !q && page === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => (setQuery(""), setPage(id))}
                  className={`relative flex h-[var(--st-nav)] w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[13.5px] transition-colors ${on ? "font-medium text-neutral-50" : "text-neutral-300 hover:bg-white/[0.05]"}`}
                >
                  {on && <motion.span layoutId="oc-st-pill" transition={{ duration: 0.18 }} className="oc-st-pill absolute inset-0 rounded-lg" />}
                  <Tile page={p} size="var(--st-tile)" />
                  <span className="relative truncate">{p.label}</span>
                                  </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Outside the scroll area so it stays put. */}
      <button type="button" data-tip="Close (Esc)" onClick={onClose} className="absolute right-3 top-3 z-20 grid size-7 cursor-pointer place-items-center rounded-full bg-white/[0.06] text-neutral-400 hover:bg-white/[0.12] hover:text-neutral-100">
        <X className="size-4" />
      </button>
      {/* Content stays solid: glass is for chrome only. */}
      <div className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto oc-st-canvas">
        <div key={q ? "search" : page} className="oc-fade-in mx-auto max-w-[var(--st-col)] px-10 pb-16 pt-8">
          {q ? (
            <>
              <h2 className="text-[20px] font-bold tracking-tight text-neutral-100">Results for “{query.trim()}”</h2>
              {!results.length && <p className="py-10 text-center text-[13px] text-neutral-500">No settings match.</p>}
              {results.map(({ page: p, rows }) => (
                <section key={p.id}>
                  <button type="button" onClick={() => (setQuery(""), setPage(p.id))} className="mb-1.5 ml-1 mt-[var(--st-gap)] flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-neutral-400 hover:text-neutral-100">
                    <Tile page={p} size="18px" /> {p.label}
                  </button>
                  <Card>
                    {rows.length ? rows.map((r) => <SettingRow key={r.title} row={r} ctx={ctx} />) : (
                      /* Pages with no rows (About): a link to open them. */
                      <button type="button" onClick={() => (setQuery(""), setPage(p.id))} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] text-neutral-100">Open {p.label}</span>
                          <span className="block text-[12px] text-neutral-500">{p.id === "about" ? `Version ${APP_VERSION} · check for updates, replay the tour` : p.blurb}</span>
                        </span>
                        <ChevronRight className="size-4 text-neutral-500" />
                      </button>
                    )}
                  </Card>
                </section>
              ))}
            </>
          ) : (
            <>
              {!pageOf(page).hero && <PageHeader page={pageOf(page)} />}
              {pageOf(page).custom && (pageOf(page).hero || pageOf(page).bare ? pageOf(page).custom!(ctx) : <Card pad>{pageOf(page).custom!(ctx)}</Card>)}
              {pageOf(page).groups?.map((g, i) => (
                <section key={g.heading ?? i}>
                  {g.heading ? <h3 className="mb-1.5 ml-4 mt-[var(--st-gap)] flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500 [&>span]:size-5 [&>span]:mr-0 [&>span_svg]:size-3">{g.icon}{g.heading}</h3> : <div className="mt-[var(--st-gap)]" />}
                  <Card cols={g.cols}>{g.rows.map((r) => <SettingRow key={r.title} row={r} ctx={ctx} />)}</Card>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ building blocks */
/** Tinted icon tile: coloured glyph on a faint same-colour squircle. */
const Tile = ({ page, size }: { page: Page; size: string }) => (
  <span className="oc-keep relative grid shrink-0 place-items-center rounded-[28%] [&_svg]:size-[64%]" style={{ width: size, height: size, color: page.color, background: `color-mix(in srgb, ${page.color} 16%, transparent)` }}>
    {page.icon}
  </span>
);

const PageHeader = ({ page }: { page: Page }) => (
  <header>
    <h2 className="text-[22px] font-bold tracking-tight text-neutral-100">{page.label}</h2>
    <p className="mt-0.5 text-[13px] text-neutral-500">{page.blurb}</p>
  </header>
);

/** Inset grouped list: rounded card, hairlines between rows. `pad` for custom pages that bring their own rows. */
const Card = ({ children, pad, cols }: { children: ReactNode; pad?: boolean; cols?: boolean }) => (
  <div className={`oc-st-card mt-[var(--st-gap)] [h3+&]:mt-0 rounded-xl border border-white/[0.07] bg-white/[0.045] shadow-[0_1px_2px_rgb(0_0_0/0.2)] ${pad ? "px-4 py-1" : cols ? "oc-st-cols grid grid-cols-2" : "divide-y divide-white/[0.06]"}`}>{children}</div>
);

function SettingRow({ row, ctx }: { row: Row; ctx: Ctx }) {
  return (
    <div className={`flex min-h-[var(--st-row)] gap-6 px-4 py-[var(--st-pad)] ${row.wide ? "flex-col gap-2.5" : "items-center"}`}>
      {row.icon}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-neutral-100">{row.title}</p>
        {row.description && <div className="mt-0.5 break-words text-[12px] leading-snug text-neutral-500">{row.description}</div>}
      </div>
      <div className="shrink-0">{row.control(ctx)}</div>
    </div>
  );
}

/** Zoom / density: per-device, so they live in localStorage, not AppSettings. */
function ScaleSelect({ kind }: { kind: "zoom" | "density" }) {
  const [v, setV] = useState(kind === "zoom" ? getZoom : getDensity);
  return <Select value={v} onChange={(x) => (setV(x), setUiScale(kind, x))} options={kind === "zoom" ? ZOOMS : DENSITIES} />;
}

const Btn = ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="h-8 cursor-pointer rounded-md border border-white/[0.1] px-3 text-[13px] text-neutral-200 transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40">
    {children}
  </button>
);

/** Notion-style dropdown: a quiet button showing the value; a popover list with a check. */
export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  const [openUp, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0, up: false });
  useEscape(() => setOpen(false), openUp);
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    const up = r.bottom + 40 * options.length + 16 > window.innerHeight;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, right: window.innerWidth - r.right, up });
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} type="button" aria-haspopup="listbox" aria-expanded={openUp} onClick={show} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13.5px] text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-neutral-100">
        {options.find(([v]) => v === value)?.[1] ?? value}
        <ChevronDown className="size-3.5 text-neutral-500" />
      </button>
      {/* Portaled: the modal's transform + overflow would clip a fixed popover. */}
      {openUp && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onMouseDown={() => setOpen(false)} />
          <div
            className="oc-pop-in fixed z-[81] min-w-[200px] rounded-lg border border-white/[0.08] bg-[var(--oc-raised)] p-1 shadow-2xl shadow-black/50"
            style={{ right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {options.map(([v, label]) => (
              <button key={v} type="button" onClick={() => (onChange(v), setOpen(false))} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-neutral-200 hover:bg-white/[0.06]">
                <span className="flex-1">{label}</span>
                {v === value && <Check className="size-4 text-neutral-300" />}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-[18px] w-8 cursor-pointer rounded-full transition-colors ${on ? "bg-[var(--color-sky-500)]" : "bg-white/[0.15]"}`}>
      <span className={`absolute left-0.5 top-0.5 size-3.5 rounded-full bg-[#fff] shadow transition-transform duration-150 ${on ? "translate-x-3.5" : "translate-x-0"}`} />
    </button>
  );
}

function LocalSwitch({ storageKey }: { storageKey: string }) {
  const [on, setOn] = useState(() => local(storageKey, "0") === "1");
  return <Switch on={on} onChange={(v) => (setOn(v), setLocal(storageKey, v ? "1" : "0"))} />;
}
function LocalSelect({ storageKey, fallback, options }: { storageKey: string; fallback: string; options: [string, string][] }) {
  const [v, setV] = useState(() => local(storageKey, fallback));
  return <Select value={v} onChange={(x) => (setV(x), setLocal(storageKey, x))} options={options} />;
}

function DeleteSwitch({ app }: { app: (typeof DELETE_APPS)[number]["id"] }) {
  const { ask } = useConfirmDelete();
  return <Switch on={ask[app]} onChange={(on) => setAskBeforeDelete(app, on)} />;
}

function AccentPicker({ settings, onChange }: Ctx) {
  return (
    <div className="flex items-center gap-1.5">
      {ACCENTS.map((c) => (
        <button key={c} type="button" data-tip={c} onClick={() => onChange({ accent: c })} className="grid size-6 cursor-pointer place-items-center rounded-full transition-transform hover:scale-110" style={{ backgroundColor: c }}>
          {settings.accent.toLowerCase() === c && <Check className="size-3.5 text-[#fff]" />}
        </button>
      ))}
      <label data-tip="Custom color" className="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full border border-white/20" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
        <input type="color" value={settings.accent} onChange={(e) => onChange({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export function SidebarIconsPicker({ settings, onChange }: Ctx) {
  const pal = sidebarPalette({ ...settings, sidebarIcons: "custom" })!;
  return (
    <div className="flex flex-col items-end gap-2">
      <Select value={settings.sidebarIcons} onChange={(sidebarIcons) => onChange({ sidebarIcons })} options={[["subtle", "Subtle"], ["richer", "Richer"], ["custom", "Custom"]]} />
      {settings.sidebarIcons === "custom" && (
        <div className="flex items-center gap-1.5">
          {SIDEBAR_ITEMS.map(([k, label]) => (
            <label key={k} data-tip={label} className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-white/20" style={{ background: pal[k] }}>
              <input type="color" value={pal[k]} onChange={(e) => onChange({ sidebarColors: JSON.stringify({ ...pal, [k]: e.target.value }) })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ app-specific controls */
function DocsStyle() {
  const { uiStyle } = useDocs();
  return <Select<DocsUiStyle> value={uiStyle} onChange={setUiStyle} options={[["ribbon", "Ribbon (Word)"], ["docs", "Toolbar (Google Docs)"], ["minimal", "Minimal (Oceanic)"]]} />;
}
function DocsFolder() {
  return <>{useDocs().folder ?? "Not chosen yet"}</>;
}
function SketchFolder() {
  return <>{useSketch().folder ?? "Documents\\Oceanic Sketch"}</>;
}
function SketchLayoutPick() {
  const { layout } = useSketch();
  const card = (id: SketchLayout, title: string, desc: string) => (
    <button
      type="button"
      onClick={() => setSketchLayout(id)}
      className={`flex-1 cursor-pointer rounded-lg border p-3 text-left transition-colors ${layout === id ? "border-[color:var(--oc-sketch)] bg-[color:var(--oc-sketch)]/10" : "border-white/[0.08] hover:border-white/20"}`}
    >
      <span className="block text-[13px] font-medium text-neutral-100">{title}</span>
      <span className="block text-[12px] text-neutral-400">{desc}</span>
    </button>
  );
  return (
    <div className="flex w-[420px] gap-2">
      {card("paint", "Paint", "One toolbar row on top")}
      {card("photoshop", "Photoshop", "Tool rail on the left, panels on the right")}
    </div>
  );
}

function StoragePath() {
  const [path, setPath] = useState("");
  useEffect(() => void api.getStoragePath().then(setPath).catch(() => setPath("Unknown")), []);
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(path).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)));
  return (
    <>
      <span className="block">One file holds all your notes. Moving it copies the file and restarts Oceanic; the old copy stays as a backup.</span>
      <button type="button" onClick={copy} data-tip="Copy path" className="mt-2 flex max-w-full cursor-pointer items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-left font-mono text-[11.5px] text-neutral-300 hover:bg-white/[0.1]">
        <span className="truncate">{path}</span>{copied ? <Check className="size-3 shrink-0 text-teal-300" /> : null}
      </button>
    </>
  );
}
function MoveStorage() {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const dir = await open({ directory: true, purpose: "storage", title: "Choose a folder for Oceanic's database" });
    if (typeof dir === "string") setConfirm(dir);
  };
  return (
    <>
      <span className="flex gap-1.5" data-tip={isTauri() ? undefined : "Needs the desktop app"}>
        <Btn onClick={() => void api.getStoragePath().then((p) => revealItemInDir(p))} disabled={!isTauri()}>Show in Explorer</Btn>
        <Btn onClick={() => void pick()} disabled={!isTauri()}>Move…</Btn>
      </span>
      {confirm && (
        <Modal glass onClose={() => setConfirm(null)} className="w-[420px] p-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">Move database?</h2>
          <p className="mt-1 text-[13px] text-neutral-400">
            Copy the database to <span className="font-mono text-neutral-200">{confirm}</span> and restart Oceanic. The old file stays where it is as a backup.
          </p>
          {error && <p className="mt-2 text-[12.5px] text-red-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <ModalButton onClick={() => (setConfirm(null), setError(null))}>Cancel</ModalButton>
            <ModalButton variant="primary" onClick={() => api.moveStorage(confirm).catch((e) => setError(String(e)))}>Move & restart</ModalButton>
          </div>
        </Modal>
      )}
    </>
  );
}

/* Folders and files picked in Open / Save windows stay usable without asking again
 * (files for 90 days after their last use). This clears them. */
const scopeChanged = new EventTarget();
function FolderAccessInfo() {
  const [info, setInfo] = useState<{ folders: string[]; files: number } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const load = () => void invoke<{ folders: string[]; files: number }>("scope_info").then(setInfo).catch(() => {});
    load();
    scopeChanged.addEventListener("change", load);
    return () => scopeChanged.removeEventListener("change", load);
  }, []);
  if (!info) return <>Folders and files you've opened in Oceanic.</>;
  return (
    <>
      Oceanic remembers {info.folders.length} folder{info.folders.length === 1 ? "" : "s"} and {info.files} file{info.files === 1 ? "" : "s"} you've opened. Files are forgotten after 90 days unused.
    </>
  );
}
function ForgetFolders() {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <span data-tip={isTauri() ? undefined : "Needs the desktop app"}><Btn onClick={() => setConfirm(true)} disabled={!isTauri()}>Forget…</Btn></span>
      {confirm && (
        <Modal glass onClose={() => setConfirm(false)} className="w-[420px] p-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">Forget folder access?</h2>
          <p className="mt-1 text-[13px] text-neutral-400">
            Oceanic forgets every folder and file you've opened through it. Your files aren't touched. You'll pick a folder or file again the next time you use it (Oceanic's own Docs and Sketch folders keep working).
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <ModalButton onClick={() => setConfirm(false)}>Cancel</ModalButton>
            <ModalButton variant="primary" onClick={() => void invoke("scope_forget").then(() => (scopeChanged.dispatchEvent(new Event("change")), setConfirm(false)))}>Forget</ModalButton>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ My account */
/** Initial on an accent tint, an emoji, or a photo. */
export function Avatar({ name, avatar, size = 22 }: { name: string; avatar?: string; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.48 };
  if (avatar?.startsWith("data:")) return <img src={avatar} alt="" className="shrink-0 rounded-full object-cover" style={style} />;
  return (
    <span className="oc-keep grid shrink-0 place-items-center rounded-full bg-neutral-700 font-medium text-neutral-100" style={{ ...style, ...(avatar ? { background: "rgba(255,255,255,0.08)", fontSize: size * 0.6 } : {}) }}>
      {avatar || (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function AccountPage({ settings, onChange }: Ctx) {
  const [name, setName] = useState(settings.userName);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [viewing, setViewing] = useState(false);
  const kind = settings.avatar.startsWith("data:") ? "photo" : settings.avatar ? "emoji" : "initial";
  return (
    <>
      <Card>
        <div className="flex items-center gap-4 px-4 py-3.5">
          {kind === "photo" ? (
            <button type="button" title="View photo" className="cursor-zoom-in rounded-full" onClick={() => setViewing(true)}>
              <Avatar name={settings.userName} avatar={settings.avatar} size={64} />
            </button>
          ) : (
            <Avatar name={settings.userName} avatar={settings.avatar} size={64} />
          )}
          <input
            value={name}
            placeholder="Add your name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && onChange({ userName: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Preferred name"
            className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[18px] font-semibold text-neutral-100 outline-none placeholder:font-normal placeholder:text-neutral-500 hover:bg-white/[0.04] focus:bg-white/[0.06]"
          />
        </div>
        <SettingRow ctx={{ settings, onChange }} row={{ title: "Profile picture", description: "Shown in the sidebar. Photos are cropped to a circle and kept inside Oceanic.", control: () => (
          <div className="flex gap-1.5">
            <AvatarChoice on={kind === "initial"} onClick={() => onChange({ avatar: "" })}><span className="text-[12px] font-semibold">Aa</span> Initial</AvatarChoice>
            <AvatarChoice on={kind === "emoji"} onClick={(e) => setPicker(e.currentTarget)}><Smile className="size-3.5" /> Emoji</AvatarChoice>
            <AvatarChoice on={kind === "photo"} onClick={() => file.current?.click()}><Upload className="size-3.5" /> Photo</AvatarChoice>
          </div>
        ) }} />
      </Card>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setCrop(f);
        }}
      />
      {crop && <AvatarCropper file={crop} onDone={(avatar) => (onChange({ avatar }), setCrop(null))} onCancel={() => setCrop(null)} />}
      {viewing && <AvatarViewer src={settings.avatar} onClose={() => setViewing(false)} />}
      {picker && <EmojiPicker anchor={picker} onSelect={(em) => (onChange({ avatar: em }), setPicker(null))} onClose={() => setPicker(null)} />}
    </>
  );
}
export const AvatarChoice = ({ on, onClick, children }: { on: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors ${on ? "border-[color:var(--color-sky-500)]/60 bg-[color:var(--color-sky-500)]/15 text-neutral-100" : "border-white/[0.1] text-neutral-300 hover:bg-white/[0.06]"}`}
  >
    {children}
  </button>
);

/* ------------------------------------------------------------------ About */
function AboutPage() {
  const up = useUpdates();
  const status: Partial<Record<typeof up.phase, string>> = {
    checking: "Checking for updates…",
    uptodate: "Oceanic is up to date.",
    available: `Version ${up.version} is available.`,
    downloading: `Downloading ${up.version}… ${Math.round(up.progress * 100)}%`,
    installing: "Installing…",
    restarting: "Restarting…",
    error: up.errorText,
  };
  return (
    <>
      <div className="flex flex-col items-center pt-4 text-center">
        <img src={logo} alt="Oceanic" className="size-[88px] drop-shadow-lg" />
        <p className="mt-3 text-[22px] font-bold tracking-tight text-neutral-100">Oceanic</p>
        <p className="text-[13px] text-neutral-500">Version {APP_VERSION}</p>
        <p className="mt-2 max-w-sm text-[13px] text-neutral-400">Notes, Docs, Sketch and Mindmap in one calm, offline-first workspace.</p>
        <button type="button" onClick={() => void checkForUpdates(true)} className="mt-4 h-8 cursor-pointer rounded-full bg-[var(--color-sky-500)] px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
          Check for updates
        </button>
        <p aria-live="polite" className={`mt-2 min-h-[18px] text-[12px] ${up.phase === "error" ? "text-red-400" : "text-neutral-500"}`}>{status[up.phase] ?? "Oceanic checks at startup and every few hours."}</p>
      </div>
      <Card>
        <SettingRow ctx={ABOUT_CTX} row={{ title: "Replay tour", description: "A quick walk through the main screens.", control: () => <Btn onClick={startTour}>Replay</Btn> }} />
        <SettingRow ctx={ABOUT_CTX} row={{ title: "Run setup again", description: "Name, theme and starting apps.", control: () => <Btn onClick={startSetup}>Run</Btn> }} />
      </Card>
      <Card>
        <SettingRow ctx={ABOUT_CTX} row={{ title: "Runs offline", description: "Your data stays on this PC.", control: () => <AppWindow className="size-4 text-neutral-500" /> }} />
        <SettingRow ctx={ABOUT_CTX} row={{ title: "One database file", description: "Move it under Settings → Storage.", control: () => <Database className="size-4 text-neutral-500" /> }} />
      </Card>
      <Card>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-700 text-[16px] font-bold text-white">M</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Made by</p>
            <p className="text-[14px] font-semibold text-neutral-100">MystiTheDev <span className="font-normal text-neutral-500">· Ishan Kumar</span></p>
          </div>
          <Btn onClick={() => void openUrl("https://github.com/MystiTheDev").catch(() => window.open("https://github.com/MystiTheDev", "_blank"))}>GitHub ↗</Btn>
        </div>
      </Card>
    </>
  );
}
/** About rows take no settings; SettingRow just needs a Ctx shape. */
const ABOUT_CTX = { settings: {} as AppSettings, onChange: () => {} };

/** Settings → Spelling: switches, my dictionary (+ learned words), replacements, subject packs. */
function SpellingPage() {
  const sp = useSpell();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [word, setWord] = useState("");
  const learned = Object.entries(sp.learned).filter(([, n]) => n >= 3).map(([w]) => w);
  const chip = "group flex items-center gap-1 rounded-full bg-white/[0.07] py-0.5 pl-2.5 pr-1 text-[12px] text-neutral-200";
  const input = "h-8 rounded-md bg-white/[0.06] px-2.5 text-[13px] text-neutral-100 outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-[color:var(--color-sky-500)]/50";
  const Row = ({ title, desc, children }: { title: string; desc: string; children: ReactNode }) => (
    <div className="flex min-h-[var(--st-row)] items-center gap-4 px-4 py-[var(--st-pad)]">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-neutral-100">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-neutral-500">{desc}</p>
      </div>
      {children}
    </div>
  );
  const Chips = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-1.5 px-4 pb-3 pt-0.5">{children}</div>;
  const toggle = (k: "autocorrect" | "underline" | "complete") => <Switch on={sp.settings[k]} onChange={(v) => setSpellSettings({ [k]: v })} />;
  const x = (onClick: () => void) => (
    <button type="button" aria-label="Remove" onClick={onClick} className="grid size-4 cursor-pointer place-items-center rounded-full text-neutral-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100">
      <X className="size-3" />
    </button>
  );
  const head = (t: string) => <h3 className="mb-1.5 ml-4 mt-[var(--st-gap)] text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500">{t}</h3>;
  return (
    <>
      {head(`Checking${sp.ready ? " · works offline" : " · loading word list…"}`)}
      <div className="oc-st-card divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-white/[0.045] shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
        <Row title="English spelling" desc="The other spelling is underlined and autocorrected (colour ↔ color).">
          <Select value={sp.settings.dialect} onChange={(dialect) => setSpellSettings({ dialect })} options={[["both", "UK + US"], ["uk", "UK English"], ["us", "US English"]] as [Dialect, string][]} />
        </Row>
        <Row title="Autocorrect" desc="Fix common typos as you finish a word (teh → the). Backspace right after undoes it.">{toggle("autocorrect")}</Row>
        <Row title="Underline misspellings" desc="Click an underlined word for suggestions.">{toggle("underline")}</Row>
        <Row title="Word completion" desc="Grey suggestion while typing; press Tab to accept.">{toggle("complete")}</Row>
      </div>

      {head("My words")}
      <div className="oc-st-card divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-white/[0.045] shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
        <div>
          <Row title="My dictionary" desc="Words that are never flagged. Sparkled words were learned after you used them 3 times.">
            <form onSubmit={(e) => (e.preventDefault(), word.trim() && (addToDictionary(word.trim()), setWord("")))}>
              <input value={word} onChange={(e) => setWord(e.target.value)} data-no-spell placeholder="Add a word" className={`${input} w-36`} />
            </form>
          </Row>
          <Chips>
            {sp.user.map((w) => <span key={w} className={chip}>{w}{x(() => removeFromDictionary(w))}</span>)}
            {learned.map((w) => <span key={w} className={chip}><Sparkles className="size-3 text-teal-300" /> {w}{x(() => forgetLearned(w))}</span>)}
            {!sp.user.length && !learned.length && <span className="text-[12px] text-neutral-500">No words yet.</span>}
          </Chips>
        </div>
        <div>
          <Row title="Custom replacements" desc="Type the left side and it becomes the right side.">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (from.trim() && to.trim()) setReplacements({ ...sp.replacements, [from.trim().toLowerCase()]: to.trim() });
                setFrom("");
                setTo("");
              }}
              className="flex items-center gap-1.5"
            >
              <input value={from} onChange={(e) => setFrom(e.target.value)} data-no-spell placeholder="pls" className={`${input} w-20`} />
              <span className="text-neutral-500">→</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} data-no-spell placeholder="please" className={`${input} w-28`} />
              <button type="submit" className="h-8 cursor-pointer rounded-md bg-white/[0.06] px-3 text-[13px] text-neutral-200 hover:bg-white/[0.1]">Add</button>
            </form>
          </Row>
          {Object.keys(sp.replacements).length > 0 && (
            <Chips>
              {Object.entries(sp.replacements).map(([a, b]) => (
                <span key={a} className={chip}>{a} → {b}{x(() => { const r = { ...sp.replacements }; delete r[a]; setReplacements(r); })}</span>
              ))}
            </Chips>
          )}
        </div>
      </div>

      {head("Word packs")}
      <div className="oc-st-card rounded-xl border border-white/[0.07] bg-white/[0.045] shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
        <Row title="Subject word packs" desc="Extra subject terms that are never flagged.">
          <div className="flex gap-1.5">
            {Object.entries(PACKS).map(([id, p]) => {
              const on = sp.packs.includes(id);
              return (
                <button key={id} type="button" aria-pressed={on} onClick={() => setPacks(on ? sp.packs.filter((v) => v !== id) : [...sp.packs, id])} className={`flex h-7 cursor-pointer items-center gap-1 rounded-full px-3 text-[12px] transition-colors ${on ? "bg-[color:var(--color-sky-500)]/20 text-neutral-100 ring-1 ring-[color:var(--color-sky-500)]/50" : "bg-white/[0.06] text-neutral-400 hover:text-neutral-200"}`}>
                  {on && <Check className="size-3" />}{p.label}
                </button>
              );
            })}
          </div>
        </Row>
      </div>
    </>
  );
}

/** Lives in the flashcard store, not AppSettings. */
function NewPerDay() {
  const { newPerDay } = useSrs();
  return (
    <input
      type="number"
      min={0}
      max={999}
      value={newPerDay}
      onChange={(e) => setSrs("newPerDay", Math.max(0, Math.min(999, Number(e.target.value) || 0)))}
      className="w-20 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-right text-[13px] tabular-nums text-neutral-200 outline-none focus:border-white/20"
    />
  );
}
