import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { builtin, EFFORTS, nerida, useNerida } from "../lib/nerida";

/* Effort picker for Nerida's chat box (design after React Bits "Prompt Bar"):
 * a ✦ button opens a Faster ↔ Smarter slider. Deep makes the box sparkle. */

const NERIDA_GRADIENT = "linear-gradient(90deg, #38d6ff, #7c3aed)";

/** `compact`: narrow side chat, thinking shows as a brain icon instead of text. */
export function EffortButton({ disabled, compact }: { disabled?: boolean; compact?: boolean }) {
  const { effort, model, thinking, agent, autoApply } = useNerida();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const brain = useRef<HTMLSpanElement>(null);
  const i = EFFORTS.findIndex((e) => e.id === effort);
  const deep = effort === "high";

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const set = (n: number) => nerida.setEffort(EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, n))].id);
  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set(Math.round(((e.clientX - r.left) / r.width) * (EFFORTS.length - 1)));
  };
  const pct = (i / (EFFORTS.length - 1)) * 100;

  return (
    <div ref={root} className="relative">
      <button type="button" disabled={disabled} title="Effort" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`flex h-7 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-[12px] hover:bg-white/[0.06] disabled:cursor-default ${deep ? "text-violet-200" : "text-neutral-400 hover:text-neutral-200"}`}>
        <Sparkles className="size-3.5" style={deep ? { color: "#a78bfa" } : undefined} />
        {EFFORTS[i].label}
        {thinking && builtin(model) && (compact
          ? <Brain aria-label="Thinking on" className="oc-think-icon size-3.5 shrink-0 text-violet-300" />
          : <span className="oc-think-label inline-block whitespace-nowrap">· Thinking</span>)}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="oc-menu-pop oc-glass-menu absolute bottom-full right-0 z-30 mb-2 w-72 rounded-2xl p-3.5">
          <div className="flex h-5 items-center justify-between">
            <p className="text-[11.5px] font-medium text-neutral-500">Response effort</p>
            {deep && <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-px text-[10.5px] text-amber-300"><TriangleAlert className="size-3" />Slower</span>}
          </div>
          <div role="slider" tabIndex={0} aria-label="Effort" aria-valuemin={0} aria-valuemax={EFFORTS.length - 1} aria-valuenow={i} aria-valuetext={EFFORTS[i].label}
            className="relative mx-2 mt-2 h-6 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal-300/40"
            onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), fromPointer(e))}
            onPointerMove={(e) => e.buttons & 1 && fromPointer(e)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
              if (step) (e.preventDefault(), set(i + step));
              else if (e.key === "Escape") setOpen(false);
            }}>
            <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]" />
            <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full shadow-[0_0_10px_rgba(56,214,255,0.45)] transition-[width] duration-200" style={{ width: `${pct}%`, background: NERIDA_GRADIENT }} />
            {EFFORTS.map((e, n) => (
              <i key={e.id} className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" style={{ left: `${(n / (EFFORTS.length - 1)) * 100}%` }} />
            ))}
            <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#5eead4] shadow-[0_0_0_4px_rgba(94,234,212,0.18),0_2px_6px_rgba(0,0,0,0.4)] transition-[left] duration-200" style={{ left: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between">
            {EFFORTS.map((e, n) => (
              <button key={e.id} type="button" onClick={() => set(n)} className={`cursor-pointer rounded-md px-1 text-[11.5px] transition-colors ${n === i ? "font-medium text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>{e.label}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-neutral-500">Higher effort gives fuller answers but takes longer.</p>
          <div className="oc-glass-inset mt-3 overflow-hidden rounded-xl">
            <button type="button" role="switch" disabled={!builtin(model)} aria-checked={thinking}
              onClick={() => {
                if (!thinking && !matchMedia("(prefers-reduced-motion: reduce)").matches) brain.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
                nerida.setThinking(!thinking);
              }}
              className="oc-menu-row flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left disabled:cursor-default disabled:opacity-40">
              <span ref={brain} className={`grid size-6 shrink-0 place-items-center rounded-md ${thinking ? "bg-violet-400/15 text-violet-300" : "bg-white/[0.06] text-neutral-400"}`}><Brain className="size-3.5" /></span>
              <span className="flex-1 text-[12.5px] font-medium text-neutral-200">Thinking{thinking && <span className="ml-1 font-normal text-violet-300/70">· slower</span>}</span>
              <Switch on={thinking} grad />
            </button>
            {!builtin(model) && <p className="px-3 pb-2 text-[11px] text-neutral-500">Thinking needs Nerida AI.</p>}
            {agent && (
              <button type="button" role="switch" aria-checked={autoApply} onClick={() => nerida.setAutoApply(!autoApply)}
                className="oc-menu-row block w-full cursor-pointer border-t border-white/[0.06] px-3 py-2.5 text-left">
                <span className="flex items-center gap-2.5">
                  <span className={`grid size-6 shrink-0 place-items-center rounded-md ${autoApply ? "bg-teal-400/15 text-teal-300" : "bg-white/[0.06] text-neutral-400"}`}><Wand2 className="size-3.5" /></span>
                  <span className="flex-1 text-[12.5px] font-medium text-neutral-200">Agent auto-apply</span>
                  <Switch on={autoApply} />
                </span>
                <span className="mt-1.5 block pl-[34px] text-[11px] leading-snug text-neutral-500">Creates notes, folders, events and study sets without asking. Edits, moves and Trash still ask.</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Gradient sparkles drifting up inside the chat box while Deep is selected; typing speeds them up. */
export function DeepSparkles({ typing }: { typing: string }) {
  const { effort } = useNerida();
  const canvas = useRef<HTMLCanvasElement>(null);
  const energy = useRef(0);
  useEffect(() => void (energy.current = Math.min(1.5, energy.current + 0.25)), [typing]);
  const on = effort === "high" && !matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!on || !c || !ctx) return;
    const parts: { x: number; y: number; r: number; v: number; hue: number; life: number }[] = [];
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { width: w, height: h } = c.getBoundingClientRect();
      if (c.width !== Math.round(w)) [c.width, c.height] = [Math.round(w), Math.round(h)];
      energy.current *= Math.exp(-dt / 0.8);
      if (parts.length < 28 && Math.random() < dt * 8) parts.push({ x: Math.random() * w, y: h + 2, r: 0.8 + Math.random(), v: 8 + Math.random() * 10, hue: Math.random(), life: 0 });
      ctx.clearRect(0, 0, w, h);
      for (let n = parts.length - 1; n >= 0; n--) {
        const p = parts[n];
        p.life += dt;
        p.y -= p.v * dt * (1 + energy.current * 4);
        if (p.y < -3) { parts.splice(n, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life * 2, p.y / 12) * 0.8;
        ctx.fillStyle = p.hue < 0.5 ? "#38d6ff" : "#a78bfa"; // Nerida cyan / violet
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(now / 900 + p.hue * 6) * 4, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => (cancelAnimationFrame(raf), ctx.clearRect(0, 0, c.width, c.height));
  }, [on]);

  return on ? <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full rounded-2xl" /> : null;
}

/** Deep's thinking: collapsed "Thought for Xs" line; click to read it. */
export function ThoughtLine({ thought, secs }: { thought: string; secs: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-300">
        <Brain className="size-3.5" /> Thought for {secs}s
        <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <p className="mt-1 ml-[7px] whitespace-pre-wrap border-l border-white/[0.08] pl-3 text-[12px] leading-relaxed text-neutral-500">{thought}</p>}
    </div>
  );
}

/** For popups, quizzes and flashcards: shimmering "Thinking…" while Deep thinks, then "Thought for Xs". */
export function ThinkingStatus() {
  const { think } = useNerida();
  if (!think) return null;
  return think.live ? <p className="oc-nerida-shimmer mb-1.5 text-[12px]">Thinking…</p> : <ThoughtLine thought={think.text} secs={think.secs} />;
}

/** Shared toggle switch: teal, or Nerida's gradient (`grad`). */
function Switch({ on, grad }: { on: boolean; grad?: boolean }) {
  return (
    <span className={`relative h-[18px] w-8 shrink-0 overflow-hidden rounded-full bg-white/[0.12] transition-shadow duration-200 ${on ? (grad ? "shadow-[0_0_10px_rgba(124,58,237,0.45)]" : "shadow-[0_0_10px_rgba(45,212,191,0.45)]") : ""}`}>
      <span className={`absolute inset-0 transition-opacity duration-200 ${grad ? "bg-gradient-to-r from-[#38d6ff] to-[#7c3aed]" : "bg-teal-400/90"} ${on ? "opacity-100" : "opacity-0"}`} />
      <span className={`absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none ${on ? "translate-x-3.5" : ""}`} />
    </span>
  );
}
