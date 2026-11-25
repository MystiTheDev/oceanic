import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlarmClock, ChevronDown, Flag, GripVertical, Hourglass, Pause, Play, Timer as TimerIcon, X } from "lucide-react";
import * as T from "./store";
import { subjectOf, useStudy } from "./study";

const KIND_ICON = { countdown: Hourglass, pomodoro: TimerIcon, stopwatch: Flag, alarm: AlarmClock };
const W = 272;
const PILL = 132;
const ACCENT = "#38bdf8";
const COLLAPSE_KEY = "oceanic:timers-collapsed";
const act = "oc-tw-act relative grid size-7 cursor-pointer place-items-center rounded-full text-neutral-300 hover:bg-white/[0.1] hover:text-neutral-100";

/** Time text where each digit rolls in when it changes. */
function Digits({ text }: { text: string }) {
  return <>{[...text].map((c, i) => <span key={`${i}${c}`} className={/\d/.test(c) ? "oc-digit" : undefined}>{c}</span>)}</>;
}
/** Icon inside a circular progress ring. */
function Ring({ pct, color, children }: { pct: number; color: string; children: React.ReactNode }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-9 shrink-0 place-items-center">
      <svg className="oc-tw-ring absolute inset-0 -rotate-90" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      {children}
    </span>
  );
}

/**
 * Floating stack of active timers plus ringing cards. Drag the header to move; on drop it
 * glides to the nearest corner (remembered). Collapses to a small pill.
 */
export function TimerWidget({ onOpen }: { onOpen: () => void }) {
  const s = T.useTimers();
  useStudy();
  const box = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  void drag;
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  const [small, setSmall] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } });
  useEffect(() => {
    const on = () => setVp({ w: innerWidth, h: innerHeight });
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  const collapse = (v: boolean) => { setSmall(v); try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch {} };

  const active = s.timers.filter((t) => t.kind !== "alarm" && (t.running || T.valueOf(t) > 0));
  if (!active.length && !s.rings.length) return null;
  const pill = small && !s.rings.length;
  const w = pill ? PILL : W;

  // Default bottom-right; a saved spot is clamped so the stack never leaves the window.
  const h = box.current?.offsetHeight ?? 60;
  // At rest it sits in the corner nearest its saved spot (so width changes keep it anchored).
  const px = s.pos?.x ?? vp.w, py = s.pos?.y ?? vp.h;
  const x = drag ? Math.max(8, Math.min(vp.w - w - 8, px)) : px + W / 2 > vp.w / 2 ? vp.w - w - 20 : 20;
  const y = drag ? Math.max(8, Math.min(vp.h - h - 8, py)) : py + h / 2 > vp.h / 2 ? vp.h - h - 24 : 20;

  /** Drag with window listeners (works for the pill too); a move under 4 px still counts as a click. */
  const down = (e: React.PointerEvent) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (btn && btn !== e.currentTarget) return;
    const sx = e.clientX, sy = e.clientY, dx = sx - x, dy = sy - y;
    moved.current = false;
    let last = { x, y };
    const mv = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved.current) (moved.current = true), setDrag({ dx, dy });
      last = { x: Math.max(8, Math.min(innerWidth - w - 8, ev.clientX - dx)), y: Math.max(8, Math.min(innerHeight - h - 8, ev.clientY - dy)) };
      T.setPos(last);
    };
    const end = () => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      if (!moved.current) return;
      setDrag(null);
      // Snap: the render picks the nearest corner from this spot.
      T.setPos({ x: last.x + w / 2 - W / 2, y: last.y });
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  };
  const loud = s.rings.some((r) => T.isLoud(r, s.now));
  const first = active[0];
  const colorOf = (t: T.Timer) => (t.track && subjectOf(t.track)?.color) || (t.kind === "pomodoro" && t.phase !== "work" ? "#34d399" : ACCENT);
  const pctOf = (t: T.Timer, v: number) => (t.kind === "stopwatch" ? (v % 60e3) / 60e3 : t.total ? 1 - v / t.total : 0);

  return createPortal(
    <div ref={box} role="region" aria-label="Timers" style={{ left: x, top: y, width: w }}
      className={`oc-timer-widget fixed z-[80] flex flex-col gap-1.5 ${drag ? "select-none" : "oc-tw-glide"} ${loud ? "oc-tw-shake" : ""}`}>
      {s.rings.map((r) => {
        const kind = s.timers.find((t) => t.id === r.timerId)?.kind;
        return (
          <div key={r.id} role="alert" className={`oc-timer-ring oc-tw-card rounded-2xl border-sky-400/40 p-3 ${T.isLoud(r, s.now) ? "oc-ringing" : ""}`}>
            <div className="flex items-start gap-2">
              <AlarmClock className="mt-0.5 size-4 shrink-0 text-sky-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-neutral-100">{r.label}</p>
                <p className="text-[12px] text-neutral-400">{r.body}</p>
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => T.dismiss(r.id)} className="grid size-6 cursor-pointer place-items-center rounded-full text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100"><X className="size-3.5" /></button>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={() => T.dismiss(r.id)} className="h-7 flex-1 cursor-pointer rounded-full bg-[color:var(--color-sky-500)] text-[12px] font-medium text-white hover:brightness-110">Dismiss</button>
              <button type="button" onClick={() => T.snooze(r.id, 5)} className="h-7 flex-1 cursor-pointer rounded-full bg-white/[0.08] text-[12px] font-medium text-neutral-200 hover:bg-white/[0.12]">Snooze 5 min</button>
              {kind === "countdown" && (
                <button type="button" onClick={() => (T.dismiss(r.id), T.addMinute(r.timerId), T.toggle(r.timerId))} className="h-7 cursor-pointer rounded-full bg-white/[0.08] px-2.5 text-[12px] font-medium text-neutral-200 hover:bg-white/[0.12]">+1 min</button>
              )}
            </div>
          </div>
        );
      })}
      {pill && first ? (
        <button type="button" onPointerDown={down} onClick={() => !moved.current && collapse(false)}
          title="Expand timers" style={{ ["--tw-accent" as string]: colorOf(first) }}
          className="oc-tw-card oc-tw-in flex h-10 cursor-pointer touch-none items-center gap-2 rounded-full pl-3 pr-3.5">
          <span className="size-2 rounded-full" style={{ background: colorOf(first) }} />
          <span className="flex-1 font-mono text-[14px] font-semibold tabular-nums text-neutral-100"><Digits text={T.fmt(T.valueOf(first, s.now))} /></span>
          {active.length > 1 && <span className="text-[11px] text-neutral-400">+{active.length - 1}</span>}
        </button>
      ) : active.length > 0 && (
        <div className="oc-tw-card oc-tw-in flex flex-col overflow-hidden rounded-2xl">
          <div onPointerDown={down}
            className="flex h-7 cursor-grab touch-none items-center gap-1 px-2 text-[11px] text-neutral-500 active:cursor-grabbing">
            <GripVertical className="size-3.5" />
            <span className="flex-1">{active.length === 1 ? "Timer" : `${active.length} timers`}</span>
            <button type="button" aria-label="Collapse" title="Collapse" onClick={() => collapse(true)} className="grid size-6 cursor-pointer place-items-center rounded-full hover:bg-white/[0.08] hover:text-neutral-100"><ChevronDown className="size-3.5" /></button>
          </div>
          {active.map((t) => {
            const Ic = KIND_ICON[t.kind];
            const v = T.valueOf(t, s.now);
            const color = colorOf(t);
            const sub = t.track ? subjectOf(t.track)?.name : null;
            return (
              <div key={t.id} style={{ ["--tw-accent" as string]: color }} className="oc-tw-row oc-tw-in relative flex items-center gap-2.5 border-t border-white/[0.06] py-2 pl-3 pr-2">
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: color }} />
                <Ring pct={pctOf(t, v)} color={color}><Ic className="size-3.5" style={{ color: t.running ? color : "#737373" }} /></Ring>
                <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer flex-col text-left">
                  <span className="truncate text-[11.5px] text-neutral-400">
                    {t.kind === "pomodoro" ? `${T.phaseName[t.phase]} · ${t.round}` : t.label}
                    {sub && <span style={{ color }}> · {sub}</span>}
                  </span>
                  <span className={`font-mono text-[19px] font-semibold leading-tight tabular-nums ${t.running ? "text-neutral-50" : "text-neutral-500"}`}><Digits text={T.fmt(v)} /></span>
                </button>
                {t.kind === "countdown" && <button type="button" title="Add 1 minute" onClick={() => T.addMinute(t.id)} className={`${act} w-auto px-1.5 text-[11px] font-medium`}>+1</button>}
                <button type="button" aria-label={t.running ? "Pause" : "Resume"} onClick={() => T.toggle(t.id)} className={`${act} !opacity-100 !transform-none bg-white/[0.06]`}>
                  {t.running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <button type="button" aria-label="Remove" onClick={() => T.remove(t.id)} className={act}><X className="size-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
