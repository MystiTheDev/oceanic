import { checkForUpdates } from "../lib/updates";
import { pickSketchFolder, setSketchLayout, useSketch, type SketchLayout } from "../sketch/store";
import { pickFolder, setUiStyle, useDocs, type DocsUiStyle } from "../docs/store";
import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AppWindow, Check, Brush, Database, FileText, Palette, User, X } from "lucide-react";
import { api } from "../data/api";
import { APP_VERSION } from "./SidebarFooter";
import { Modal, ModalButton } from "./Modal";

export const ACCENTS = ["#2383e2", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#d946ef"];

export type AppSettings = {
  userName: string;
  theme: "dark" | "light" | "system";
  accent: string;
  closeToTray: boolean;
  /** What's in front at launch. Saved tabs are restored either way. */
  startup: "home" | "last";
  /** Home page look: the classic Oceanic Home or the student dashboard. */
  homeStyle: "classic" | "student";
};

type Section = "account" | "appearance" | "storage" | "window" | "docs" | "sketch";
const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "account", label: "Account", icon: <User className="size-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="size-4" /> },
  { id: "storage", label: "Storage", icon: <Database className="size-4" /> },
  { id: "window", label: "Window", icon: <AppWindow className="size-4" /> },
  { id: "docs", label: "Oceanic Docs", icon: <FileText className="size-4" /> },
  { id: "sketch", label: "Oceanic Sketch", icon: <Brush className="size-4" /> },
];

/** Notion-style settings: section list on the left, content on the right. */
export function SettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>("account");

  return (
    <Modal onClose={onClose} className="flex h-[560px] w-[min(860px,92vw)]">
      <nav className="flex w-52 shrink-0 flex-col gap-px border-r border-white/[0.06] bg-white/[0.02] p-2">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-neutral-500">Settings</p>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
              section === s.id ? "bg-white/[0.08] text-neutral-100" : "text-neutral-400 hover:bg-white/[0.04]"
            }`}
          >
            <span className="text-neutral-500">{s.icon}</span>
            {s.label}
          </button>
        ))}
        <p className="mt-auto px-2 pb-1 text-[11px] text-neutral-600">Oceanic v{APP_VERSION}</p>
      </nav>

      <div className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto px-10 py-8">
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-7 cursor-pointer place-items-center rounded-md text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200"
        >
          <X className="size-4" />
        </button>
        <h2 className="mb-5 border-b border-white/[0.06] pb-3 text-[15px] font-semibold text-neutral-100">
          {SECTIONS.find((s) => s.id === section)!.label}
        </h2>
        {section === "account" && <AccountSection settings={settings} onChange={onChange} />}
        {section === "appearance" && <AppearanceSection settings={settings} onChange={onChange} />}
        {section === "storage" && <StorageSection />}
        {section === "docs" && <DocsSection />}
        {section === "sketch" && <SketchSection />}
        {section === "window" && (
          <>
          <Setting
            title="Open on startup"
            description="Your previously open tabs and notes are always restored. This only picks which one is in front when Oceanic starts."
          >
            <select
              value={settings.startup}
              onChange={(e) => onChange({ startup: e.target.value as AppSettings["startup"] })}
              className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none"
            >
              <option value="home">Home</option>
              <option value="last">Last opened page</option>
            </select>
          </Setting>
          <Setting
            title="Close to system tray"
            description="Clicking × hides Oceanic to the tray so it keeps running. Quit from the tray menu."
          >
            <Switch on={settings.closeToTray} onChange={(closeToTray) => onChange({ closeToTray })} />
          </Setting>
          </>
        )}
      </div>
    </Modal>
  );
}

type SectionProps = { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void };

function SketchSection() {
  const { layout, folder } = useSketch();
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
    <>
      <Setting title="Layout" description="How Oceanic Sketch arranges its tools.">
        <div className="flex w-80 gap-2">
          {card("paint", "Paint", "One toolbar row on top")}
          {card("photoshop", "Photoshop", "Tool rail on the left, panels on the right")}
        </div>
      </Setting>
      <Setting title="Sketch folder" description={folder ?? "Documents\\Oceanic Sketch"}>
        <button type="button" onClick={pickSketchFolder} className="h-8 cursor-pointer rounded-md border border-white/[0.08] px-3 text-[13px] text-neutral-200 hover:bg-white/[0.06]">
          Change…
        </button>
      </Setting>
    </>
  );
}

function DocsSection() {
  const { uiStyle, folder } = useDocs();
  return (
    <>
      <Setting title="Toolbar style" description="Word-style ribbon, a single Google Docs-style toolbar, or a minimal floating bar.">
        <select
          value={uiStyle}
          onChange={(e) => setUiStyle(e.target.value as DocsUiStyle)}
          className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none"
        >
          <option value="ribbon">Ribbon (Word)</option>
          <option value="docs">Toolbar (Google Docs)</option>
          <option value="minimal">Minimal (Oceanic)</option>
        </select>
      </Setting>
      <Setting title="Docs folder" description={folder ?? "Not chosen yet"}>
        <button type="button" onClick={pickFolder} className="h-8 cursor-pointer rounded-md border border-white/[0.08] px-3 text-[13px] text-neutral-200 hover:bg-white/[0.06]">
          Change…
        </button>
      </Setting>
    </>
  );
}

function AccountSection({ settings, onChange }: SectionProps) {
  const [name, setName] = useState(settings.userName);
  return (
    <Setting title="Preferred name" description="Shown at the bottom of the sidebar.">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && onChange({ userName: name.trim() })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-8 w-52 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 outline-none focus:border-sky-500/60"
      />
    </Setting>
  );
}

function AppearanceSection({ settings, onChange }: SectionProps) {
  return (
    <>
      <Setting title="Home style" description="Classic Oceanic Home, or a student dashboard with timetable, assignments, exams and a focus timer.">
        <select
          value={settings.homeStyle}
          onChange={(e) => onChange({ homeStyle: e.target.value as AppSettings["homeStyle"] })}
          className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none"
        >
          <option value="classic">Classic</option>
          <option value="student">Student dashboard</option>
        </select>
      </Setting>
      <Setting title="Theme" description="Use system setting follows Windows' light or dark mode.">
        <select
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value as AppSettings["theme"] })}
          className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none"
        >
          <option value="system">Use system setting</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Setting>
      <Setting title="Accent color" description="Selections, focus rings, links and primary buttons.">
        <div className="flex items-center gap-1.5">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onChange({ accent: c })}
              className="grid size-6 cursor-pointer place-items-center rounded-full transition-transform hover:scale-110"
              style={{ backgroundColor: c }}
            >
              {settings.accent.toLowerCase() === c && <Check className="size-3.5 text-[#fff]" />}
            </button>
          ))}
          <label
            title="Custom color"
            className="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full border border-white/20"
            style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
          >
            <input
              type="color"
              value={settings.accent}
              onChange={(e) => onChange({ accent: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            value={settings.accent}
            onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange({ accent: e.target.value })}
            spellCheck={false}
            className="ml-1 h-7 w-20 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 font-mono text-[12px] text-neutral-300 outline-none focus:border-sky-500/60"
          />
        </div>
      </Setting>
    </>
  );
}

function StorageSection() {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    api.getStoragePath().then(setPath).catch(() => setPath("Unknown"));
  }, []);

  const pick = async () => {
    const dir = await open({ directory: true, title: "Choose a folder for Oceanic's database" });
    if (typeof dir === "string") setConfirm(dir);
  };

  return (
    <>
      <Setting title="Updates" description="Oceanic checks at startup and every few hours.">
        <button type="button" onClick={() => void checkForUpdates(true)} className="h-8 cursor-pointer rounded-md border border-white/[0.08] px-3 text-[13px] text-neutral-200 hover:bg-white/[0.06]">
          Check for updates
        </button>
      </Setting>
      <Setting title="Database location" description={path}>
        <ModalButton onClick={pick} disabled={!isTauri()}>
          Change…
        </ModalButton>
      </Setting>
      {!isTauri() && <p className="text-[12px] text-neutral-500">Changing the location needs the desktop app.</p>}
      {confirm && (
        <div className="oc-fade-in mt-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-[13px] text-neutral-300">
          <p className="mb-2">
            Copy the database to <span className="font-mono text-neutral-100">{confirm}</span> and restart Oceanic?
            The old file stays where it is as a backup.
          </p>
          {error && <p className="mb-2 text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <ModalButton onClick={() => (setConfirm(null), setError(null))}>Cancel</ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => api.moveStorage(confirm).catch((e) => setError(String(e)))}
            >
              Move & restart
            </ModalButton>
          </div>
        </div>
      )}
    </>
  );
}

function Setting({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-neutral-100">{title}</p>
        {description && <p className="mt-0.5 break-words text-[12px] text-neutral-500">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-8 cursor-pointer rounded-full transition-colors ${on ? "bg-sky-500" : "bg-white/[0.15]"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 size-3.5 rounded-full bg-[#fff] shadow transition-transform duration-150 ${on ? "translate-x-3.5" : "translate-x-0"}`}
      />
    </button>
  );
}
