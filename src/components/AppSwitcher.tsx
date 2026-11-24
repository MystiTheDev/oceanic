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
export function AppSwitcher({ current, onSwitch }: { current: AppId; onSwitch: (app: AppId, from?: DOMRect) => void }) {
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
              <button key={a} type="button" title={APPS[a].tagline} onClick={(e) => onSwitch(a, e.currentTarget.querySelector("img")?.getBoundingClientRect())} style={{ "--tone": APPS[a].tone } as React.CSSProperties}
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

/** Per-app "opening" art drawn around the centred icon (viewBox centred on the icon). */
function OpeningArt({ app }: { app: AppId }) {
  const draw = (d: number) => ({ animationDelay: `${d}ms` });
  if (app === "mindmap") {
    // A tiny map: four topic cards, then sub-topics, joined by curves (level by level).
    const topics = [[-150, -62, "#a78bfa"], [150, -62, "#38bdf8"], [-150, 42, "#34d399"], [150, 42, "#fbbf24"]] as const;
    const subs = [[-262, -96, 0], [-262, -30, 0], [262, -96, 1], [262, 8, 3], [262, 76, 3]] as const;
    const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
    return (
      <>
        {topics.map(([x, y, c], i) => (
          <g key={i} style={{ stroke: c }}>
            <path className="oc-ld-draw oc-ld-edge" pathLength={1} style={draw(650 + i * 90)} d={curve(Math.sign(x) * 46, 0, x - Math.sign(x) * 44, y)} />
            <g className="oc-ld-pop" style={draw(950 + i * 90)}>
              <rect x={x - 44} y={y - 13} width={88} height={26} rx={13} style={{ fill: `color-mix(in srgb, ${c} 22%, #171717)`, stroke: c }} strokeWidth={1.5} />
              <rect x={x - 26} y={y - 2.5} width={52} height={5} rx={2.5} style={{ fill: c, stroke: "none", opacity: 0.85 }} />
            </g>
          </g>
        ))}
        {subs.map(([x, y, t], i) => {
          const [tx, ty, c] = topics[t];
          return (
            <g key={i} style={{ stroke: c }}>
              <path className="oc-ld-draw oc-ld-edge" pathLength={1} style={draw(1350 + i * 80)} d={curve(tx + Math.sign(tx) * 44, ty, x - Math.sign(x) * 30, y)} />
              <g className="oc-ld-pop" style={draw(1600 + i * 80)}>
                <rect x={x - 30} y={y - 10} width={60} height={20} rx={10} style={{ fill: `color-mix(in srgb, ${c} 14%, #171717)`, stroke: c }} strokeWidth={1.2} />
                <rect x={x - 16} y={y - 2} width={32} height={4} rx={2} style={{ fill: c, stroke: "none", opacity: 0.6 }} />
              </g>
            </g>
          );
        })}
      </>
    );
  }
  if (app === "docs")
    return (
      <g className="oc-ld-unfold" style={draw(650)}>
        <rect x={-90} y={-100} width={180} height={190} rx={14} className="oc-ld-paper" />
        {[-80, -66, 62, 76].map((y, i) => (
          <rect key={y} x={-72} y={y} height={6} rx={3} width={i % 2 ? 84 : 140} className="oc-ld-line" style={draw(1000 + i * 140)} />
        ))}
      </g>
    );
  if (app === "sketch")
    return (
      <>
        <path className="oc-ld-draw oc-ld-brush" pathLength={1} style={draw(700)} d="M-210 70 C -140 20, -90 110, -20 70 S 110 20, 210 60" />
        {[[-150, -90, 7], [140, -100, 5], [170, -40, 9], [-180, -20, 5]].map(([x, y, r], i) => (
          <circle key={i} className="oc-ld-pop" style={draw(1300 + i * 120)} cx={x} cy={y} r={r} />
        ))}
      </>
    );
  return (
    <>
      <path className="oc-ld-draw" pathLength={1} style={draw(700)} d="M-220 80 q 27 -22 55 0 t 55 0 t 55 0 t 55 0 t 55 0 t 55 0 t 55 0 t 55 0" />
      {[[-60, 20, 6], [40, 0, 4], [80, 30, 5], [-110, 40, 3]].map(([x, y, r], i) => (
        <circle key={i} className="oc-ld-bubble" style={draw(1000 + i * 180)} cx={x} cy={y} r={r} />
      ))}
    </>
  );
}

/**
 * First open of an app after launch: its icon flies from where it was clicked
 * to the centre, a short themed animation plays around it, then a ripple
 * spreads out and the app shows through. `onLeave` fires as the ripple starts.
 */
export function AppLoader({ app, from, onLeave, onDone }: { app: AppId; from?: DOMRect | null; onLeave?: () => void; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const out = window.setTimeout(() => (setLeaving(true), onLeave?.()), APP_LOADER_MS - 700);
    const done = window.setTimeout(onDone, APP_LOADER_MS);
    return () => (window.clearTimeout(out), window.clearTimeout(done));
  }, [app]);
  const a = APPS[app];
  const fly = from
    ? { "--dx": `${from.left + from.width / 2 - innerWidth / 2}px`, "--dy": `${from.top + from.height / 2 - innerHeight / 2 + 40}px`, "--s": from.width / 88 }
    : { "--dx": "0px", "--dy": "60px", "--s": 0.6 };
  return (
    <div data-app-loader className="fixed inset-0 z-[90] grid place-items-center overflow-hidden" style={{ "--tone": a.tone, ...fly } as React.CSSProperties}>
      <div
        className={`oc-ld-bg absolute inset-0 transition-opacity duration-700 ease-out ${leaving ? "opacity-0" : ""}`}
        style={{ background: `radial-gradient(ellipse at 50% 45%, color-mix(in srgb, ${a.tone} 20%, transparent), transparent 62%), var(--color-neutral-900)` }}
      />
      {leaving && [0, 1, 2].map((n) => <span key={n} className="oc-ld-ripple" style={{ animationDelay: `${n * 110}ms` }} />)}
      <div className={`relative flex -translate-y-10 flex-col items-center transition-[opacity,transform] duration-500 ${leaving ? "scale-105 opacity-0" : ""}`}>
        <div className="relative grid size-[88px] place-items-center">
          <svg className="oc-ld-art pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 overflow-visible" viewBox="-300 -150 600 300" aria-hidden>
            <OpeningArt app={app} />
          </svg>
          <img src={a.logo} alt="" className="oc-ld-fly relative size-[88px] object-contain" />
        </div>
        <div className="oc-loader-text mt-14 text-center">
          <p className="text-[26px] font-bold tracking-[-0.02em] text-neutral-100">{a.name}</p>
          <p className="mt-1 text-[13.5px] text-neutral-400">{a.tagline}</p>
        </div>
      </div>
    </div>
  );
}
