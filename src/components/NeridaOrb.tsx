import { useId, useState } from "react";

/* Nerida's logo, rebuilt as light layered SVG so each part animates:
 * halo · glossy orb · waves · nautilus shell · glowing core · sparkles · ripple ring.
 * Idle: waves drift, sparkles twinkle. Busy: halo pulses, core shimmers, a ripple ring
 * goes out every 1.6s. Below 24px only the halo pulses. Respects "reduce motion". */

// Nautilus: a logarithmic spiral (outer wall) with chamber walls, computed once.
const C = { x: 36, y: 31 };
const T = 4 * Math.PI;
const spiral = (t: number) => {
  const r = 2.25 * Math.exp(0.156 * t);
  return [C.x - r * Math.cos(t), C.y - r * Math.sin(t)] as const;
};
const pt = (t: number) => spiral(t).map((v) => v.toFixed(2)).join(" ");
const SHELL = (() => {
  const out: string[] = [];
  for (let t = T; t >= 0; t -= 0.12) out.push(pt(t));
  return "M" + out.join(" L");
})();
/** Outer whorl filled (between the last two turns). */
const WHORL = (() => {
  const a: string[] = [], b: string[] = [];
  for (let t = T - 2 * Math.PI; t <= T; t += 0.12) a.push(pt(t));
  for (let t = T; t >= T - 2 * Math.PI; t -= 0.12) b.push(pt(t - 2 * Math.PI));
  return "M" + a.join(" L") + " L" + b.join(" L") + "Z";
})();
const CHAMBERS = Array.from({ length: 12 }, (_, i) => {
  const t = T - i * 0.52;
  return `M${pt(t)} Q${pt(t - Math.PI * 1.15)} ${pt(t - 2 * Math.PI)}`;
}).join(" ");

export function NeridaMark({ busy = false, size = 18 }: { busy?: boolean; size?: number }) {
  const id = useId().replace(/:/g, "");
  const small = size < 24;
  const u = (n: string) => `url(#${id}${n})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={`oc-orb ${busy ? "oc-orb-busy" : ""} ${small ? "oc-orb-small" : ""}`} style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={`${id}body`} cx=".42" cy=".38" r=".75">
          <stop offset="0" stopColor="#5fd4ff" /><stop offset=".35" stopColor="#2f7bff" /><stop offset=".7" stopColor="#5b2fd6" /><stop offset="1" stopColor="#1a0b4d" />
        </radialGradient>
        <radialGradient id={`${id}halo`}>
          <stop offset=".55" stopColor="#4f6bff" stopOpacity=".55" /><stop offset=".8" stopColor="#7c3aed" stopOpacity=".2" /><stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}core`}>
          <stop offset="0" stopColor="#fff" /><stop offset=".3" stopColor="#bff4ff" /><stop offset=".65" stopColor="#38d6ff" stopOpacity=".45" /><stop offset="1" stopColor="#38d6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}shine`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bff4ff" /><stop offset=".5" stopColor="#6d8bff" stopOpacity=".3" /><stop offset="1" stopColor="#d8b4fe" /></linearGradient>
        <linearGradient id={`${id}ring`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5fe3ff" /><stop offset="1" stopColor="#a78bfa" /></linearGradient>
        <clipPath id={`${id}clip`}><circle cx="32" cy="32" r="21" /></clipPath>
      </defs>

      <circle className="oc-orb-halo" cx="32" cy="32" r="31" fill={u("halo")} />
      {!small && <circle className="oc-orb-ring" cx="32" cy="32" r="21" fill="none" stroke={u("ring")} strokeWidth="1.6" />}

      <circle cx="32" cy="32" r="21" fill={u("body")} />
      <g clipPath={u("clip")}>
        <g className="oc-orb-waves" fill="none" stroke="#a5b4fc" strokeOpacity=".35" strokeWidth="1.1">
          <path d="M0 43 q8 -4 16 0 t16 0 t16 0 t16 0 t16 0" />
          <path d="M-4 48 q8 -3 16 0 t16 0 t16 0 t16 0 t16 0" strokeOpacity=".25" />
        </g>
        {!small && (
          <g fill="none" stroke="#bff4ff" strokeLinecap="round" strokeLinejoin="round">
            <path d={WHORL} fill="#7dd3fc" fillOpacity=".16" stroke="none" />
            <path d={CHAMBERS} strokeWidth=".55" strokeOpacity=".5" />
            <path d={SHELL} strokeWidth="1.1" strokeOpacity=".85" />
          </g>
        )}
        <circle className="oc-orb-core" cx={C.x} cy={C.y} r={small ? 9 : 7} fill={u("core")} />
        <ellipse cx="27" cy="18" rx="12" ry="5.5" fill={u("shine")} transform="rotate(-18 27 18)" opacity=".55" />
      </g>
      <circle cx="32" cy="32" r="21" fill="none" stroke={u("rim")} strokeWidth="1" />

      {!small && (
        <g fill="#e0f2fe">
          <path className="oc-orb-spark" d="M54 9 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1z" />
          <path className="oc-orb-spark oc-orb-spark2" d="M9 52 l.7 1.8 1.8 .7 -1.8 .7 -.7 1.8 -.7 -1.8 -1.8 -.7 1.8 -.7z" />
          <circle cx="20" cy="27" r="1" opacity=".9" />
        </g>
      )}
    </svg>
  );
}

/** "Beta" tag shown next to Nerida's name while it's in beta. */
export const BetaPill = () => (
  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-1.5 py-px align-middle text-[9.5px] font-bold uppercase leading-[14px] tracking-[0.06em] text-white">Beta</span>
);

/* Beta notice: shown the first time Nerida is opened in each app launch. */
let betaSeen = false;
export function NeridaBetaCard() {
  const [open, setOpen] = useState(() => !betaSeen && (betaSeen = true));
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="w-[380px] max-w-[92vw] rounded-xl border border-white/[0.1] bg-neutral-900 p-5 text-center shadow-2xl">
        <div className="mb-3 flex justify-center"><NeridaMark size={36} /></div>
        <p className="text-[16px] font-semibold text-neutral-100">Meet Nerida<BetaPill /></p>
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">Your offline study assistant. Chat about your notes and PDFs, make flashcards, outlines and mindmaps, and get feedback on your writing.</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-500">Nerida is in beta: answers can be wrong, and features you see now may change or be removed later.</p>
        <button type="button" autoFocus className="mt-4 cursor-pointer rounded-md bg-sky-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-sky-500" onClick={() => setOpen(false)}>Got it</button>
      </div>
    </div>
  );
}
