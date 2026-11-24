import { useEffect, useState } from "react";
import { ChevronRight, LayoutGrid } from "lucide-react";
import oceanicLogo from "../assets/logo-raw.png";
import docsLogo from "../assets/docs-logo.png";
import sketchLogo from "../assets/sketch-logo.png";
import mindmapLogo from "../assets/mindmap-logo.png";

export type AppId = "notes" | "docs" | "sketch" | "mindmap";
export const APPS: Record<AppId, { name: string; logo: string; tone: string; tagline: string }> = {
  notes: { name: "Oceanic", logo: oceanicLogo, tone: "var(--oc-brand)", tagline: "Notes, pages and planning" },
  mindmap: { name: "Oceanic Mindmap", logo: mindmapLogo, tone: "var(--oc-mm-violet)", tagline: "Map your ideas" },
  docs: { name: "Oceanic Docs", logo: docsLogo, tone: "var(--oc-docs)", tagline: "Write and edit Word documents" },
  sketch: { name: "Oceanic Sketch", logo: sketchLogo, tone: "var(--oc-sketch)", tagline: "Draw, paint and edit images" },
};
const ORDER: AppId[] = ["notes", "mindmap", "docs", "sketch"];
const KEY = "oceanic.appsOpen";

/** Sidebar "More apps": every other app; inside an app, its own row becomes "Oceanic". */
export function AppSwitcher({ current, onSwitch }: { current: AppId; onSwitch: (app: AppId) => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  }, [open]);
  return (
    <div data-tour="apps" className="oc-rail-hide flex flex-col gap-px px-2 pb-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer mt-0.5 h-7 items-center gap-2 rounded-md px-2 text-[14px] text-neutral-400 transition-colors duration-100 hover:bg-white/5 hover:text-neutral-300">
        <LayoutGrid className="size-3.5" />
        <span className="flex-1 text-left">More apps</span>
        {!open && ORDER.filter((a) => a !== current).map((a) => <img key={a} src={APPS[a].logo} alt="" className="size-4 object-contain opacity-80" />)}
        <ChevronRight className={`size-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {ORDER.filter((a) => a !== current).map((a) => (
              <button key={a} type="button" title={APPS[a].tagline} onClick={() => onSwitch(a)} style={{ "--tone": APPS[a].tone } as React.CSSProperties}
                className="oc-app-tile flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-1 py-2 text-[11.5px] text-neutral-400">
                <img src={APPS[a].logo} alt="" className="size-6 object-contain" />
                <span className="w-full truncate text-center">{APPS[a].name.replace(/^Oceanic /, "")}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const APP_LOADER_MS = 3000;

/** One random tip per switch, per app. */
const TIPS: Record<AppId, string[]> = {
  notes: ["Ctrl+K opens quick search from anywhere.", "Type / in a page for blocks.", "Drag a page in the sidebar to nest it."],
  mindmap: ["Tab adds a child, Enter adds a sibling.", "Arrow keys move between topics.", "Ctrl+F finds a topic; F focuses its branch.", "N adds a note to the selected topic."],
  docs: ["Ctrl+S saves the Word file in place.", "Paste images straight into a document.", "Headings build the outline on the left."],
  sketch: ["S select, Q lasso, B brush, E eraser, T text.", "Hold Space to pan, Ctrl+wheel to zoom.", "Text stays editable: click it with the Text tool.", "Ctrl+D duplicates a selection."],
};

/** Full-window splash while switching apps: the target's logo lifts in, its name and a progress bar fill. */
/** `onLeave` fires as the fade-out starts, so whatever is underneath can start its intro then. */
export function AppLoader({ app, onLeave, onDone }: { app: AppId; onLeave?: () => void; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const out = window.setTimeout(() => (setLeaving(true), onLeave?.()), APP_LOADER_MS - 500);
    const done = window.setTimeout(onDone, APP_LOADER_MS);
    return () => (window.clearTimeout(out), window.clearTimeout(done));
  }, [app]);
  const a = APPS[app];
  const [tip] = useState(() => TIPS[app][Math.floor(Math.random() * TIPS[app].length)]);
  return (
    <div
      data-app-loader
      className={`fixed inset-0 z-[90] grid place-items-center overflow-hidden transition-[opacity,transform,filter] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${leaving ? "pointer-events-none scale-[1.04] opacity-0 blur-[6px]" : "oc-fade-in opacity-100"}`}
      style={{ "--tone": a.tone, background: `radial-gradient(ellipse at 50% 40%, color-mix(in srgb, ${a.tone} 18%, transparent), transparent 60%), var(--color-neutral-900)` } as React.CSSProperties}
    >
      <svg className="oc-loader-waves pointer-events-none absolute bottom-0 left-0 h-[38%] w-[200%]" viewBox="0 0 2400 300" preserveAspectRatio="none" aria-hidden>
        {[0.22, 0.13, 0.07].map((o, i) => {
          const y = 120 + i * 45;
          return <path key={i} style={{ animationDuration: `${8 + i * 4}s` }} fill={a.tone} fillOpacity={o} d={`M0 ${y} Q150 ${y - 50 + i * 15} 300 ${y} T600 ${y} T900 ${y} T1200 ${y} T1500 ${y} T1800 ${y} T2100 ${y} T2400 ${y} V300 H0Z`} />;
        })}
      </svg>
      <div className="relative flex flex-col items-center gap-4">
        <img src={a.logo} alt="" className="oc-loader-logo size-24 object-contain" />
        <div className="oc-loader-text text-center">
          <p className="text-[26px] font-extrabold tracking-[-0.02em] text-neutral-100">{a.name}</p>
          <p className="mt-1 text-[13px] text-neutral-400">{a.tagline}</p>
        </div>
        <div className="mt-3 h-1 w-48 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="oc-loader-bar h-full rounded-full" style={{ background: a.tone, animationDuration: `${APP_LOADER_MS - 400}ms` }} />
        </div>
        <p className="oc-loader-text mt-4 max-w-xs rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-1.5 text-center text-[12.5px] text-neutral-300 backdrop-blur-md" style={{ animationDelay: "500ms" }}>
          <span className="mr-1.5 font-semibold" style={{ color: a.tone }}>Tip</span>
          {tip}
        </p>
      </div>
    </div>
  );
}
