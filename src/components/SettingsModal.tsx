import { DELETE_APPS, setAskBeforeDelete, useConfirmDelete } from "../lib/confirmDelete";
import { checkForUpdates } from "../lib/updates";
import { pickSketchFolder, setSketchLayout, useSketch, type SketchLayout } from "../sketch/store";
import { pickFolder, setUiStyle, useDocs, type DocsUiStyle } from "../docs/store";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AppWindow, Brush, Check, ChevronDown, Database, FileText, GraduationCap, Info, Keyboard, Network, Palette, Search, Settings2, Smile, Trash2, Upload, User, X,
} from "lucide-react";
import { api } from "../data/api";
import { APP_VERSION } from "./SidebarFooter";
import { Modal, ModalButton } from "./Modal";
import { EmojiPicker } from "./EmojiPicker";
import logo from "../assets/logo-raw.png";

export const ACCENTS = ["#2383e2", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#d946ef"];

export type AppSettings = {
  userName: string;
  /** "" = coloured initial, an emoji, or a data: URL photo (128px). */
  avatar: string;
  theme: "dark" | "light" | "system";
  accent: string;
  closeToTray: boolean;
  /** What's in front at launch. Saved tabs are restored either way. */
  startup: "home" | "last";
  /** Home page look: the classic Oceanic Home or the student dashboard. */
  homeStyle: "classic" | "student";
  weekStart: "sunday" | "monday";
  /** Notes editor text size. */
  editorSize: "small" | "default" | "large";
  /** Focus timer's two-note chime when a session ends. */
  studyChime: boolean;
  /** Short splash when switching apps from the sidebar. */
  appLoader: boolean;
};

/* ------------------------------------------------------------------ registry
   Every row is data, so search can show matches from all pages at once. */
type Ctx = { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void };
type Row = { title: string; description?: ReactNode; keywords?: string; control: (c: Ctx) => ReactNode; wide?: boolean };
type Group = { heading?: string; rows: Row[] };
type PageId = "account" | "preferences" | "general" | "storage" | "deleting" | "shortcuts" | "about" | "docs" | "sketch" | "mindmap" | "study";
type Page = { id: PageId; label: string; icon: ReactNode; groups?: Group[]; custom?: (c: Ctx) => ReactNode };

const NAV: { heading: string; pages: PageId[] }[] = [
  { heading: "Account", pages: ["account", "preferences"] },
  { heading: "Oceanic", pages: ["general", "storage", "deleting", "shortcuts", "about"] },
  { heading: "Apps", pages: ["docs", "sketch", "mindmap", "study"] },
];

const kbd = (...keys: string[]) => (
  <span className="flex items-center gap-1">
    {keys.map((k) => (
      <kbd key={k} className="rounded-[5px] border border-white/[0.1] bg-white/[0.05] px-1.5 py-0.5 font-sans text-[11.5px] text-neutral-300 shadow-[0_1px_0_rgba(255,255,255,0.06)]">{k}</kbd>
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

const PAGES: Page[] = [
  { id: "account", label: "My account", icon: <User />, custom: (c) => <AccountPage {...c} /> },
  {
    id: "preferences",
    label: "Preferences",
    icon: <Palette />,
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
    groups: [
      {
        heading: "Home",
        rows: [
          {
            title: "Home style",
            description: "Classic Oceanic Home, or a student dashboard with timetable, assignments, exams and a focus timer.",
            keywords: "dashboard student",
            control: ({ settings, onChange }) => (
              <Select value={settings.homeStyle} onChange={(homeStyle) => onChange({ homeStyle })} options={[["classic", "Classic"], ["student", "Student dashboard"]]} />
            ),
          },
        ],
      },
      {
        heading: "Window",
        rows: [
          {
            title: "Open on startup",
            description: "Your open tabs are always restored. This picks which one is in front when Oceanic starts.",
            keywords: "launch",
            control: ({ settings, onChange }) => (
              <Select value={settings.startup} onChange={(startup) => onChange({ startup })} options={[["home", "Home"], ["last", "Last opened page"]]} />
            ),
          },
          {
            title: "Close to system tray",
            description: "Clicking × hides Oceanic to the tray so it keeps running. Quit from the tray menu.",
            keywords: "background",
            control: ({ settings, onChange }) => <Switch on={settings.closeToTray} onChange={(closeToTray) => onChange({ closeToTray })} />,
          },
          {
            title: "Loading screen when switching apps",
            description: "A short splash with the app's logo when you switch apps from the sidebar's More apps.",
            keywords: "splash animation intro",
            control: ({ settings, onChange }) => <Switch on={settings.appLoader} onChange={(appLoader) => onChange({ appLoader })} />,
          },
        ],
      },
    ],
  },
  {
    id: "storage",
    label: "Storage & updates",
    icon: <Database />,
    groups: [
      { heading: "Updates", rows: [{ title: "Check for updates", description: "Oceanic checks at startup and every few hours.", keywords: "version upgrade", control: () => <Btn onClick={() => void checkForUpdates(true)}>Check now</Btn> }] },
      { heading: "Data", rows: [{ title: "Database location", description: <StoragePath />, keywords: "folder move backup", control: () => <MoveStorage /> }] },
    ],
  },
  {
    id: "deleting",
    label: "Deleting",
    icon: <Trash2 />,
    groups: [
      {
        heading: "Ask before deleting",
        rows: DELETE_APPS.map((a) => ({
          title: a.label,
          description: "Confirm before a file is deleted or removed. Open files always need closing first.",
          keywords: "confirm delete trash",
          control: () => <DeleteSwitch app={a.id} />,
        })),
      },
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: <Keyboard />,
    groups: [
      {
        heading: "Oceanic",
        rows: [
          sc("Search", "Ctrl", "K"), sc("New page", "Ctrl", "N"), sc("New tab", "Ctrl", "T"), sc("Close tab", "Ctrl", "W"),
          sc("Next tab", "Ctrl", "Tab"), sc("Previous tab", "Ctrl", "Shift", "Tab"), sc("Go to tab 1–8 / last", "Ctrl", "1–9"),
          sc("Show / hide sidebar", "Ctrl", "\\"), sc("Back", "Alt", "←"), sc("Forward", "Alt", "→"),
        ],
      },
      { heading: "Notes editor", rows: [sc("Commands menu", "/"), sc("Link to a page", "[["), sc("Bold", "Ctrl", "B"), sc("Italic", "Ctrl", "I"), sc("Underline", "Ctrl", "U")] },
      { heading: "Oceanic Docs", rows: [sc("Save", "Ctrl", "S"), sc("Collapse / pin the ribbon", "Ctrl", "F1")] },
      {
        heading: "Oceanic Sketch",
        rows: [sc("New canvas", "Ctrl", "N"), sc("Open image", "Ctrl", "O"), sc("Save", "Ctrl", "S"), sc("Undo", "Ctrl", "Z"), sc("Redo", "Ctrl", "Y"), sc("Zoom in", "Ctrl", "+"), sc("Zoom out", "Ctrl", "−"), sc("Fit to window", "Ctrl", "0")],
      },
      { heading: "Oceanic Mindmap", rows: [sc("Add child topic", "Tab"), sc("Add sibling topic", "Enter"), sc("Edit topic", "F2"), sc("Delete topic", "Del")] },
    ],
  },
  { id: "about", label: "About", icon: <Info />, custom: () => <AboutPage /> },
  {
    id: "docs",
    label: "Oceanic Docs",
    icon: <FileText />,
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
    groups: [
      {
        heading: "Focus timer",
        rows: [{ title: "Play a chime", description: "A soft two-note chime when a focus session or break ends.", keywords: "sound timer pomodoro", control: ({ settings, onChange }) => <Switch on={settings.studyChime} onChange={(studyChime) => onChange({ studyChime })} /> }],
      },
    ],
  },
];
const pageOf = (id: PageId) => PAGES.find((p) => p.id === id)!;

/** Notion-style settings: profile + search + grouped pages on the left, rows on the right. */
export function SettingsModal({ settings, onChange, onClose }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void; onClose: () => void }) {
  const [page, setPage] = useState<PageId>("account");
  const [query, setQuery] = useState("");
  const ctx = { settings, onChange };
  const q = query.trim().toLowerCase();

  /** Search: every matching row, grouped by its page. */
  const results = useMemo(() => {
    if (!q) return [];
    const text = (r: Row) => `${r.title} ${typeof r.description === "string" ? r.description : ""} ${r.keywords ?? ""}`.toLowerCase();
    return PAGES.flatMap((p) => {
      const rows = (p.groups ?? []).flatMap((g) => g.rows).filter((r) => text(r).includes(q) || p.label.toLowerCase().includes(q));
      return rows.length ? [{ page: p, rows }] : [];
    });
  }, [q]);

  return (
    <Modal onClose={onClose} className="flex h-[min(720px,88vh)] w-[min(1150px,94vw)]">
      <nav className="scrollbar-thin flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.06] bg-white/[0.025] px-2 pb-2 pt-3">
        {/* Profile header (Notion: avatar, name, workspace) */}
        <button type="button" onClick={() => (setQuery(""), setPage("account"))} className="mb-2 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.04]">
          <Avatar name={settings.userName} avatar={settings.avatar} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-neutral-100">{settings.userName || "You"}</span>
            <span className="block truncate text-[11.5px] text-neutral-500">Oceanic v{APP_VERSION}</span>
          </span>
        </button>
        <label className="mb-2 flex h-7 items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 focus-within:border-[color:var(--color-sky-500)]/60">
          <Search className="size-3.5 shrink-0 text-neutral-500" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
          )}
        </label>
        {NAV.map((g) => (
          <div key={g.heading} className="mt-2">
            <p className="px-2 pb-1 text-[11.5px] font-medium text-neutral-500">{g.heading}</p>
            {g.pages.map((id) => {
              const p = pageOf(id);
              const on = !q && page === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => (setQuery(""), setPage(id))}
                  className={`flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors [&_svg]:size-4 ${on ? "bg-white/[0.08] font-medium text-neutral-100" : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"}`}
                >
                  <span className={on ? "text-neutral-200" : "text-neutral-500"}>{p.icon}</span>
                  <span className="truncate">{p.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto">
        <button type="button" data-tip="Close (Esc)" onClick={onClose} className="absolute right-3 top-3 z-10 grid size-7 cursor-pointer place-items-center rounded-md text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200">
          <X className="size-4" />
        </button>
        <div key={q ? "search" : page} className="oc-fade-in mx-auto max-w-[760px] px-14 pb-16 pt-9">
          {q ? (
            <>
              <PageTitle>Results for “{query.trim()}”</PageTitle>
              {!results.length && <p className="py-10 text-center text-[13px] text-neutral-500">No settings match.</p>}
              {results.map(({ page: p, rows }) => (
                <section key={p.id}>
                  <button type="button" onClick={() => (setQuery(""), setPage(p.id))} className="mt-7 flex cursor-pointer items-center gap-1.5 border-b border-white/[0.06] pb-2 text-[13px] font-semibold text-neutral-300 hover:text-neutral-100 [&_svg]:size-3.5">
                    {p.icon} {p.label}
                  </button>
                  {rows.map((r) => <SettingRow key={r.title} row={r} ctx={ctx} />)}
                </section>
              ))}
            </>
          ) : (
            <>
              <PageTitle>{pageOf(page).label}</PageTitle>
              {pageOf(page).custom?.(ctx)}
              {pageOf(page).groups?.map((g, i) => (
                <section key={g.heading ?? i}>
                  {g.heading && <h3 className="mb-1 mt-8 border-b border-white/[0.06] pb-2 text-[14px] font-semibold text-neutral-200">{g.heading}</h3>}
                  {g.rows.map((r) => <SettingRow key={r.title} row={r} ctx={ctx} />)}
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
const PageTitle = ({ children }: { children: ReactNode }) => <h2 className="border-b border-white/[0.06] pb-3 text-[16px] font-semibold text-neutral-100">{children}</h2>;

function SettingRow({ row, ctx }: { row: Row; ctx: Ctx }) {
  return (
    <div className={`flex gap-6 border-b border-white/[0.04] py-3.5 last:border-b-0 ${row.wide ? "flex-col gap-2.5" : "items-center"}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-neutral-100">{row.title}</p>
        {row.description && <div className="mt-0.5 break-words text-[12.5px] leading-snug text-neutral-500">{row.description}</div>}
      </div>
      <div className="shrink-0">{row.control(ctx)}</div>
    </div>
  );
}

const Btn = ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="h-8 cursor-pointer rounded-md border border-white/[0.1] px-3 text-[13px] text-neutral-200 transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40">
    {children}
  </button>
);

/** Notion-style dropdown: a quiet button showing the value; a popover list with a check. */
function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  const [openUp, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0, up: false });
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    const up = r.bottom + 40 * options.length + 16 > window.innerHeight;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, right: window.innerWidth - r.right, up });
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} type="button" onClick={show} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13.5px] text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-neutral-100">
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

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
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
  return <span className="font-mono text-[11.5px]">{path}</span>;
}
function MoveStorage() {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const dir = await open({ directory: true, title: "Choose a folder for Oceanic's database" });
    if (typeof dir === "string") setConfirm(dir);
  };
  return (
    <>
      <span data-tip={isTauri() ? undefined : "Needs the desktop app"}><Btn onClick={() => void pick()} disabled={!isTauri()}>Change…</Btn></span>
      {confirm && (
        <Modal onClose={() => setConfirm(null)} className="w-[420px] p-5">
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

/* ------------------------------------------------------------------ My account */
/** Initial on an accent tint, an emoji, or a photo. */
export function Avatar({ name, avatar, size = 22 }: { name: string; avatar?: string; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.48 };
  if (avatar?.startsWith("data:")) return <img src={avatar} alt="" className="shrink-0 rounded-full object-cover" style={style} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-neutral-700 font-medium text-neutral-100" style={{ ...style, ...(avatar ? { background: "rgba(255,255,255,0.08)", fontSize: size * 0.6 } : {}) }}>
      {avatar || (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Square-crops and shrinks a picked image to a 128px JPEG data URL. */
async function toAvatar(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
  return c.toDataURL("image/jpeg", 0.85);
}

function AccountPage({ settings, onChange }: Ctx) {
  const [name, setName] = useState(settings.userName);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const kind = settings.avatar.startsWith("data:") ? "photo" : settings.avatar ? "emoji" : "initial";
  return (
    <>
      <div className="mt-6 flex items-center gap-5">
        <Avatar name={settings.userName} avatar={settings.avatar} size={64} />
        <div className="min-w-0 flex-1">
          <label className="text-[12px] text-neutral-500">
            Preferred name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && onChange({ userName: name.trim() })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="mt-1 block h-8 w-64 rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 text-[14px] text-neutral-100 outline-none focus:border-[color:var(--color-sky-500)]/60"
            />
          </label>
        </div>
      </div>
      <h3 className="mb-1 mt-8 border-b border-white/[0.06] pb-2 text-[14px] font-semibold text-neutral-200">Profile picture</h3>
      <div className="flex items-center gap-6 border-b border-white/[0.04] py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Avatar</p>
          <p className="mt-0.5 text-[12.5px] text-neutral-500">Shown in the sidebar and here. Photos are shrunk to 128 px and kept inside Oceanic.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <AvatarChoice on={kind === "initial"} onClick={() => onChange({ avatar: "" })}><span className="text-[12px] font-semibold">Aa</span> Initial</AvatarChoice>
          <AvatarChoice on={kind === "emoji"} onClick={(e) => setPicker(e.currentTarget)}><Smile className="size-3.5" /> Emoji</AvatarChoice>
          <AvatarChoice on={kind === "photo"} onClick={() => file.current?.click()}><Upload className="size-3.5" /> Photo</AvatarChoice>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onChange({ avatar: await toAvatar(f) });
        }}
      />
      {picker && <EmojiPicker anchor={picker} onSelect={(em) => (onChange({ avatar: em }), setPicker(null))} onClose={() => setPicker(null)} />}
    </>
  );
}
const AvatarChoice = ({ on, onClick, children }: { on: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) => (
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
  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      <img src={logo} alt="Oceanic" className="size-20" />
      <div>
        <p className="text-[20px] font-bold tracking-tight text-neutral-100">Oceanic</p>
        <p className="text-[13px] text-neutral-500">Version {APP_VERSION}</p>
      </div>
      <p className="max-w-sm text-[13px] text-neutral-400">Notes, Docs, Sketch and Mindmap in one calm, offline-first workspace.</p>
      <div className="mt-2 flex gap-2">
        <Btn onClick={() => void checkForUpdates(true)}>Check for updates</Btn>
      </div>
      <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2 text-left">
        {[
          [<AppWindow key="a" className="size-4" />, "Runs offline", "Your data stays on this PC."],
          [<Database key="b" className="size-4" />, "One database file", "Move it under Storage & updates."],
        ].map(([icon, t, d]) => (
          <div key={t as string} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-200">{icon} {t}</p>
            <p className="mt-0.5 text-[12px] text-neutral-500">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
