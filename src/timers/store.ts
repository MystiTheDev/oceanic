/**
 * Timers: countdowns, Pomodoro, stopwatches and clock alarms.
 * Running timers live in memory only (closing the app stops them); presets,
 * alarms, settings and the widget's position are saved.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { play, tick as tickSound, type SoundId } from "./sound";
import { askTrack, credit } from "./study";

export type Kind = "countdown" | "pomodoro" | "stopwatch" | "alarm";
export type Phase = "work" | "short" | "long";
export type Timer = {
  id: string;
  kind: Kind;
  label: string;
  running: boolean;
  /** Countdown / Pomodoro: full length of the current run, and ms left while paused. */
  total: number;
  left: number;
  /** Running countdown / Pomodoro: when it ends. Running stopwatch: when it (re)started. */
  at: number;
  /** Stopwatch: ms counted before the current run. */
  elapsed: number;
  laps: number[];
  phase: Phase;
  round: number;
  /** Alarm: clock time, repeat days (0 = Sunday; empty = once), on/off, next ring. */
  hh: number;
  mm: number;
  days: number[];
  next: number;
  /** Study track ("general" or a subject id; "" = not tracked) and when the current run began. */
  track: string;
  seg: number;
};
export type Ring = { id: string; timerId: string; label: string; body: string; at: number };
export type Preset = { id: string; label: string; ms: number };
export type Settings = {
  sound: SoundId;
  volume: number;
  notify: boolean;
  work: number;
  short: number;
  long: number;
  rounds: number;
  /** Ring for this many seconds unless dismissed. */
  ringFor: number;
};

const K = { settings: "oceanic:timers-settings", presets: "oceanic:timers-presets", alarms: "oceanic:timers-alarms", pos: "oceanic:timers-pos" };
const load = <T,>(k: string, d: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "null");
    return v && typeof v === "object" ? { ...d, ...v } : d;
  } catch {
    return d;
  }
};
const loadArr = <T,>(k: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

export const DEFAULTS: Settings = { sound: "chime", volume: 0.7, notify: true, work: 25, short: 5, long: 15, rounds: 4, ringFor: 30 };
const DEFAULT_PRESETS: Preset[] = [
  { id: "p1", label: "Tea", ms: 3 * 60e3 },
  { id: "p2", label: "Focus", ms: 25 * 60e3 },
  { id: "p3", label: "Break", ms: 10 * 60e3 },
];

type State = { timers: Timer[]; rings: Ring[]; settings: Settings; presets: Preset[]; pos: { x: number; y: number } | null; now: number };
let state: State = {
  timers: loadArr<Timer>(K.alarms).filter((t) => t.kind === "alarm").map((t) => ({ ...t, next: t.running ? nextAlarm(t.hh, t.mm, t.days) : 0 })),
  rings: [],
  settings: load(K.settings, DEFAULTS),
  presets: localStorage.getItem(K.presets) ? loadArr<Preset>(K.presets) : DEFAULT_PRESETS,
  pos: (() => { try { return JSON.parse(localStorage.getItem(K.pos) ?? "null"); } catch { return null; } })(),
  now: Date.now(),
};
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (patch.timers) save(K.alarms, state.timers.filter((t) => t.kind === "alarm"));
  if (patch.settings) save(K.settings, state.settings);
  if (patch.presets) save(K.presets, state.presets);
  if (patch.pos !== undefined) save(K.pos, state.pos);
  subs.forEach((f) => f());
  ensureTick();
}
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const useTimers = () => useSyncExternalStore(subscribe, () => state);
export const getTimers = () => state;

const uid = () => Math.random().toString(36).slice(2, 10);
const blank = (kind: Kind, label: string): Timer => ({ id: uid(), kind, label, running: false, total: 0, left: 0, at: 0, elapsed: 0, laps: [], phase: "work", round: 1, hh: 7, mm: 0, days: [], next: 0, track: "", seg: 0 });
const patchTimer = (id: string, p: Partial<Timer> | ((t: Timer) => Partial<Timer>)) =>
  set({ timers: state.timers.map((t) => (t.id === id ? { ...t, ...(typeof p === "function" ? p(t) : p) } : t)) });

/** Next ring time for an alarm at hh:mm on `days` (empty = the next hh:mm). */
export function nextAlarm(hh: number, mm: number, days: number[], from = Date.now()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > from && (!days.length || days.includes(d.getDay()))) return d.getTime();
  }
  return 0;
}

/* ---------------------------------------------------------------- display helpers */
/** Ms left (countdown/Pomodoro), ms elapsed (stopwatch) or ms until ring (alarm). */
export function valueOf(t: Timer, now = state.now) {
  if (t.kind === "stopwatch") return t.elapsed + (t.running ? now - t.at : 0);
  if (t.kind === "alarm") return t.running ? Math.max(0, t.next - now) : 0;
  return t.running ? Math.max(0, t.at - now) : t.left;
}
export function fmt(ms: number, cs = false) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h ? `${h}:${p(m)}` : p(m)}:${p(r)}${cs ? `.${p(Math.floor((ms % 1000) / 10))}` : ""}`;
}
export const phaseName: Record<Phase, string> = { work: "Focus", short: "Short break", long: "Long break" };
const phaseMs = (p: Phase) => state.settings[p] * 60e3;

/* ---------------------------------------------------------------- actions */
/** Credit the current run's focus time to the study log. */
function creditRun(t: Timer, now: number, done = false) {
  if (!t.running || !t.track || t.kind === "alarm" || (t.kind === "pomodoro" && t.phase !== "work")) return;
  credit(t.track, (t.kind === "stopwatch" ? now : Math.min(now, t.at)) - t.seg, done);
}
const push = (t: Timer) => set({ timers: [...state.timers, t] });
/** `ask`: ask General / Subject study first (snoozes skip it). */
export function addCountdown(ms: number, label = "Timer", ask = true) {
  if (!(ms > 0)) return;
  const go = (track: string) => { const now = Date.now(); push({ ...blank("countdown", label), total: ms, left: ms, running: true, at: now + ms, track, seg: now }); };
  if (ask) askTrack(go);
  else go("");
}
export function addPomodoro() {
  askTrack((track) => { const ms = phaseMs("work"), now = Date.now(); push({ ...blank("pomodoro", "Pomodoro"), total: ms, left: ms, running: true, at: now + ms, track, seg: now }); });
}
export function addStopwatch() {
  askTrack((track) => { const now = Date.now(); push({ ...blank("stopwatch", "Stopwatch"), running: true, at: now, track, seg: now }); });
}
export function addAlarm(hh: number, mm: number, days: number[], label = "Alarm") {
  set({ timers: [...state.timers, { ...blank("alarm", label), hh, mm, days, running: true, next: nextAlarm(hh, mm, days) }] });
}
export function updateAlarm(id: string, p: Partial<Pick<Timer, "hh" | "mm" | "days" | "label" | "running">>) {
  patchTimer(id, (t) => {
    const n = { ...t, ...p };
    return { ...p, next: n.running ? nextAlarm(n.hh, n.mm, n.days) : 0 };
  });
}
export function toggle(id: string) {
  const now = Date.now();
  const was = state.timers.find((x) => x.id === id);
  patchTimer(id, (t) => {
    creditRun(t, now);
    if (t.kind === "alarm") return { running: !t.running, next: t.running ? 0 : nextAlarm(t.hh, t.mm, t.days) };
    if (t.kind === "stopwatch") return t.running ? { running: false, elapsed: t.elapsed + now - t.at } : { running: true, at: now, seg: now };
    if (t.running) return { running: false, left: Math.max(0, t.at - now) };
    // Restart a finished one from the top.
    const left = t.left > 0 ? t.left : t.total;
    return { running: true, left, at: now + left, seg: now };
  });
  if (was?.running) stopNotice(was.label, "Stopped early.");
}
export function addMinute(id: string, ms = 60e3) {
  patchTimer(id, (t) => (t.running ? { at: t.at + ms, total: t.total + ms } : { left: t.left + ms, total: t.total + ms }));
}
export function reset(id: string) {
  const was = state.timers.find((x) => x.id === id);
  patchTimer(id, (t) => (creditRun(t, Date.now()), t.kind === "stopwatch" ? { running: false, elapsed: 0, laps: [] } : t.kind === "pomodoro" ? { running: false, phase: "work", round: 1, total: phaseMs("work"), left: phaseMs("work") } : { running: false, left: t.total }));
  if (was && (was.running || was.left !== was.total || was.elapsed)) stopNotice(was.label, "Reset.");
}
export function lap(id: string) {
  patchTimer(id, (t) => ({ laps: [...t.laps, valueOf(t, Date.now())] }));
}
export function skipPhase(id: string) {
  patchTimer(id, (t) => (creditRun(t, Date.now()), advance(t, Date.now())));
}
export function rename(id: string, label: string) {
  patchTimer(id, { label });
}
export function remove(id: string) {
  const t = state.timers.find((x) => x.id === id);
  if (t) creditRun(t, Date.now());
  set({ timers: state.timers.filter((t) => t.id !== id), rings: state.rings.filter((r) => r.timerId !== id) });
}
export function dismiss(ringId: string, quiet = false) {
  const r = state.rings.find((x) => x.id === ringId);
  set({ rings: state.rings.filter((x) => x.id !== ringId) });
  if (r && !quiet) stopNotice(r.label, "Dismissed.");
}
export function snooze(ringId: string, min = 5) {
  const r = state.rings.find((x) => x.id === ringId);
  dismiss(ringId, true); // the snoozed countdown will ring again; don't double-notify
  if (r) addCountdown(min * 60e3, `${r.label} (snoozed)`, false);
}
export const setSettings = (p: Partial<Settings>) => set({ settings: { ...state.settings, ...p } });
export const addPreset = (label: string, ms: number) => ms > 0 && set({ presets: [...state.presets, { id: uid(), label: label.trim() || fmt(ms), ms }] });
export const removePreset = (id: string) => set({ presets: state.presets.filter((p) => p.id !== id) });
export const setPos = (pos: { x: number; y: number } | null) => set({ pos });

/** Pomodoro: move to the next phase and keep running. */
function advance(t: Timer, now: number): Partial<Timer> {
  const longNext = t.phase === "work" && t.round % state.settings.rounds === 0;
  const phase: Phase = t.phase === "work" ? (longNext ? "long" : "short") : "work";
  const round = t.phase === "work" ? t.round : t.round + 1;
  const ms = phaseMs(phase);
  return { phase, round, total: ms, left: ms, at: now + ms, running: true, seg: now };
}

/* ---------------------------------------------------------------- ringing */
function notify(title: string, body: string) {
  if (!state.settings.notify) return;
  if ("__TAURI_INTERNALS__" in window) return void invoke("notify", { title, body }).catch(() => {});
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification(title, { body });
  else if (Notification.permission !== "denied") void Notification.requestPermission();
}
/** Manual stop / reset / dismiss: notify, a short tick, and a brief vibration on phones. */
function stopNotice(label: string, body: string) {
  if (!state.settings.notify) return;
  notify(label, body);
  tickSound();
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12);
}
/** Ask for browser notification permission (call from a click). */
export const askNotifyPermission = () => "Notification" in window && !("__TAURI_INTERNALS__" in window) && Notification.permission === "default" && void Notification.requestPermission();

function ring(t: Timer, body: string, now: number): Ring {
  play(state.settings.sound, state.settings.volume);
  notify(t.label, body);
  return { id: uid(), timerId: t.id, label: t.label, body, at: now };
}

let tick = 0;
let lastChime = 0;
function step() {
  const now = Date.now();
  const rings: Ring[] = [];
  const timers = state.timers.map((t) => {
    if (!t.running) return t;
    if ((t.kind === "countdown" || t.kind === "pomodoro") && t.at <= now) creditRun(t, now, true);
    if (t.kind === "countdown" && t.at <= now) return rings.push(ring(t, "Time's up.", now)), { ...t, running: false, left: 0 };
    if (t.kind === "pomodoro" && t.at <= now) {
      const n = { ...t, ...advance(t, now) };
      rings.push(ring(t, `${phaseName[t.phase]} done. ${phaseName[n.phase!]} starts now.`, now));
      return n;
    }
    if (t.kind === "alarm" && t.next && t.next <= now) {
      rings.push(ring(t, `It's ${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}.`, now));
      return t.days.length ? { ...t, next: nextAlarm(t.hh, t.mm, t.days, now) } : { ...t, running: false, next: 0 };
    }
    return t;
  });
  // Keep chiming every 3 s while something rings, up to `ringFor` seconds.
  const all = [...state.rings, ...rings].filter((r) => now - r.at < state.settings.ringFor * 1000 || rings.includes(r));
  if (!rings.length && all.length && now - lastChime > 3000) play(state.settings.sound, state.settings.volume);
  if (rings.length || (all.length && now - lastChime > 3000)) lastChime = now;
  const changed = rings.length > 0;
  state = { ...state, now, ...(changed ? { timers, rings: [...state.rings, ...rings] } : {}) };
  if (changed) save(K.alarms, timers.filter((t) => t.kind === "alarm"));
  subs.forEach((f) => f());
  ensureTick();
}
function ensureTick() {
  const busy = state.timers.some((t) => t.running) || state.rings.length > 0;
  if (busy && !tick) tick = window.setInterval(step, 200);
  else if (!busy && tick) (clearInterval(tick), (tick = 0));
}
/** True while a ring is still inside its sound window (the card stays until dismissed). */
export const isLoud = (r: Ring, now = state.now) => now - r.at < state.settings.ringFor * 1000;
ensureTick();
