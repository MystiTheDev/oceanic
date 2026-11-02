import { useSyncExternalStore } from "react";
import type { PageMeta } from "../data/workspace";
import { api } from "../data/api";
import { isoDate } from "./colors";

/** Student tags: pages tagged these show in Home's widgets and on the Calendar. */
export const ASSIGNMENT = "Assignment";
export const EXAM = "Exam";
export const studyKind = (p: PageMeta): "assignment" | "exam" | null =>
  p.tags?.includes(EXAM) ? "exam" : p.tags?.includes(ASSIGNMENT) ? "assignment" : null;

/* ------------------------------------------------------------------ state */
export type ClassSlot = { id: string; day: number; subject: string; start: string; end: string; room: string; color: string };
export type Todo = { id: string; text: string; done: boolean };
export type TimerPreset = { id: string; name: string; minutes: number; breakMinutes?: number };
export type RunningTimer = { name: string; phase: "focus" | "break"; total: number; endsAt: number | null; remaining: number; preset: TimerPreset };

type Study = {
  timetable: ClassSlot[];
  todos: Todo[];
  /** "list" = typed on Home; "page" = checklist of a note. */
  todoSource: { mode: "list" | "page"; pageId: string | null };
  subjects: string[];
  timers: TimerPreset[];
  /** Focus minutes per day (YYYY-MM-DD). */
  focusLog: Record<string, number>;
  sessions: number;
  timer: RunningTimer | null;
  /** Class details per subject tag. */
  classes: Record<string, ClassInfo>;
  links: QuickLink[];
  /** Dashboard cards in order; `wide` spans both columns. */
  layout: GridCard[];
};
/** A dashboard card on the 12-column grid (x/w in columns, y/h in rows). */
export type GridCard = { id: string; x: number; y: number; w: number; h: number };
const g = (id: string, x: number, y: number, w: number, h: number): GridCard => ({ id, x, y, w, h });
/** Student OS look: narrow left column, classes + planner on the right, widgets below. */
export const DEFAULT_LAYOUT: GridCard[] = [
  g("quick", 0, 0, 3, 6), g("nav", 0, 6, 3, 6), g("links", 0, 12, 3, 5),
  g("classes", 3, 0, 9, 6), g("planner", 3, 6, 9, 11),
  g("today", 0, 17, 6, 8), g("focus", 6, 17, 6, 8), g("exams", 0, 25, 6, 8), g("todo", 6, 25, 6, 8),
  g("timetable", 0, 33, 12, 8), g("stats", 0, 41, 6, 7), g("recent", 0, 48, 12, 7),
];
export type ClassInfo = { teacher: string; room: string; art: string };
export type QuickLink = { id: string; label: string; url: string };
const KEYS = { timetable: "studyTimetable", todos: "studyTodos", todoSource: "studyTodoSource", subjects: "studySubjects", timers: "studyTimers", focusLog: "studyFocusLog", classes: "studyClasses", links: "studyLinks", layout: "studyLayout" } as const;
const POMODORO: TimerPreset = { id: "pomodoro", name: "Pomodoro", minutes: 25, breakMinutes: 5 };

let state: Study = { timetable: [], todos: [], todoSource: { mode: "list", pageId: null }, subjects: [], timers: [POMODORO], focusLog: {}, sessions: 0, timer: null, classes: {}, links: [], layout: DEFAULT_LAYOUT };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const useStudy = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

export function loadStudy(stored: Record<string, string>) {
  const read = <T,>(k: string, fallback: T): T => {
    try {
      return stored[k] ? (JSON.parse(stored[k]) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  state = {
    ...state,
    timetable: read(KEYS.timetable, []),
    todos: read(KEYS.todos, []),
    todoSource: read(KEYS.todoSource, { mode: "list", pageId: null }),
    subjects: read(KEYS.subjects, []),
    timers: read(KEYS.timers, [POMODORO]),
    focusLog: read(KEYS.focusLog, {}),
    classes: read(KEYS.classes, {}),
    links: read(KEYS.links, []),
    // Older saves (order + wide only) fall back to the default positions.
    layout: ((l: GridCard[]) => (l.every((c) => typeof c.x === "number") ? l : DEFAULT_LAYOUT))(read(KEYS.layout, DEFAULT_LAYOUT)),
  };
  emit();
}

/** Update and persist the saved parts of the study state. */
export function setStudy<K extends keyof typeof KEYS>(key: K, value: Study[K]) {
  state = { ...state, [key]: value };
  emit();
  api.setSetting(KEYS[key], JSON.stringify(value)).catch(() => {});
}
export const uid = () => Math.random().toString(36).slice(2, 9);

/* ------------------------------------------------------------------ focus timer (survives navigation) */
let tick = 0;
const setTimer = (timer: RunningTimer | null) => {
  state = { ...state, timer };
  emit();
};
export function startPreset(p: TimerPreset, phase: "focus" | "break" = "focus") {
  const mins = phase === "focus" ? p.minutes : (p.breakMinutes ?? 5);
  setTimer({ name: phase === "focus" ? p.name : "Break", phase, total: mins * 60, endsAt: Date.now() + mins * 60_000, remaining: mins * 60, preset: p });
  run();
}
export function pauseTimer() {
  const t = state.timer;
  if (!t?.endsAt) return;
  setTimer({ ...t, endsAt: null, remaining: Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) });
}
export function resumeTimer() {
  const t = state.timer;
  if (!t || t.endsAt) return;
  setTimer({ ...t, endsAt: Date.now() + t.remaining * 1000 });
  run();
}
export const stopTimer = () => setTimer(null);
function run() {
  window.clearInterval(tick);
  tick = window.setInterval(() => {
    const t = state.timer;
    if (!t?.endsAt) return window.clearInterval(tick);
    const remaining = Math.max(0, Math.round((t.endsAt - Date.now()) / 1000));
    if (remaining > 0) return setTimer({ ...t, remaining });
    window.clearInterval(tick);
    finished(t);
  }, 500);
}
function finished(t: RunningTimer) {
  chime();
  if (t.phase === "focus") {
    const day = isoDate(new Date());
    state = { ...state, sessions: state.sessions + 1 };
    setStudy("focusLog", { ...state.focusLog, [day]: (state.focusLog[day] ?? 0) + Math.round(t.total / 60) });
    // Presets with a break roll straight into it (Pomodoro).
    if (t.preset.breakMinutes) return startPreset(t.preset, "break");
  }
  setTimer(null);
}
/** Soft two-note chime (no sound files). */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.65);
    });
  } catch {}
}

/** Consecutive study days ending today (or yesterday, if today hasn't started). */
export function streak(log: Record<string, number>) {
  let n = 0;
  const d = new Date();
  if (!log[isoDate(d)]) d.setDate(d.getDate() - 1);
  while (log[isoDate(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
