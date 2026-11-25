import { useSyncExternalStore } from "react";
import type { PageMeta } from "../data/workspace";
import { api } from "../data/api";
import { isoDate } from "./colors";
import * as Timers from "../timers/store";

/** Student tags: pages tagged these show in Home's widgets and on the Calendar. */
export const ASSIGNMENT = "Assignment";
export const EXAM = "Exam";
export const studyKind = (p: PageMeta): "assignment" | "exam" | null =>
  p.tags?.includes(EXAM) ? "exam" : p.tags?.includes(ASSIGNMENT) ? "assignment" : null;

/* ------------------------------------------------------------------ state */
export type ClassSlot = { id: string; day: number; subject: string; start: string; end: string; room: string; color: string };
export type Todo = { id: string; text: string; done: boolean };
/** 3725 → "1:02:05", 90 → "1:30". */
export const clock = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

type Study = {
  timetable: ClassSlot[];
  todos: Todo[];
  /** "list" = typed on Home; "page" = checklist of a note. */
  todoSource: { mode: "list" | "page"; pageId: string | null };
  subjects: string[];
  /** Focus minutes per day (YYYY-MM-DD), from finished Timers focus runs. */
  focusLog: Record<string, number>;
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
  g("links", 0, 0, 12, 6), g("planner", 0, 6, 12, 11),
  g("today", 0, 17, 6, 8), g("focus", 6, 17, 6, 8), g("exams", 0, 25, 6, 8), g("todo", 6, 25, 6, 8),
  g("timetable", 0, 33, 12, 8), g("tests", 0, 41, 6, 7), g("recent", 6, 41, 6, 7),
];
export type ClassInfo = { teacher: string; room: string; art: string };
/** `icon`: "favicon" (site's /favicon.ico) or an emoji. `color`: a COLORS id. */
export type QuickLink = { id: string; label: string; url: string; icon?: string; color?: string };
const KEYS = { timetable: "studyTimetable", todos: "studyTodos", todoSource: "studyTodoSource", subjects: "studySubjects", focusLog: "studyFocusLog", classes: "studyClasses", links: "studyLinks", layout: "studyLayout" } as const;

// Dev hot reload re-runs this module; keep loaded state so a drag can't save defaults over the real layout.
let state: Study = import.meta.hot?.data.state ?? { timetable: [], todos: [], todoSource: { mode: "list", pageId: null }, subjects: [], focusLog: {}, classes: {}, links: [], layout: DEFAULT_LAYOUT };
import.meta.hot?.dispose((d) => (d.state = state));
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
    focusLog: read(KEYS.focusLog, {}),
    classes: read(KEYS.classes, {}),
    links: read(KEYS.links, []),
    // Older saves (order + wide only) fall back to the default positions.
    layout: ((l: GridCard[]) => (l.every((c) => typeof c.x === "number") ? l : DEFAULT_LAYOUT))(read(KEYS.layout, DEFAULT_LAYOUT)),
  };
  // One-time cleanup: drop cards no longer in the default layout (they stay addable).
  if (!localStorage.getItem("studyLayoutTrim1")) {
    localStorage.setItem("studyLayoutTrim1", "1");
    const gone = ["quick", "nav", "stats", "flashcards"];
    if (state.layout.some((c) => gone.includes(c.id))) setStudy("layout", state.layout.filter((c) => !gone.includes(c.id)));
  }
  emit();
}

/** Update and persist the saved parts of the study state. */
export function setStudy<K extends keyof typeof KEYS>(key: K, value: Study[K]) {
  state = { ...state, [key]: value };
  emit();
  api.setSetting(KEYS[key], JSON.stringify(value)).catch(() => {});
}
export const uid = () => Math.random().toString(36).slice(2, 9);

/* ------------------------------------------------------------------ focus log (from Timers) */
/** Finished Pomodoro focus phases and finished countdowns add their minutes to today's study log. */
let seen = new Map<string, Timers.Timer>();
Timers.subscribe(() => {
  const now = Timers.getTimers().timers;
  let mins = 0;
  for (const t of now) {
    const was = seen.get(t.id);
    if (!was || !was.track) continue; // "Don't track" timers stay out of the streak
    if (t.kind === "pomodoro" && was.phase === "work" && t.phase !== "work" && t.round === was.round && Date.now() >= was.at - 1500) mins += was.total / 60e3;
    if (t.kind === "countdown" && was.running && !t.running && t.left === 0) mins += was.total / 60e3;
  }
  seen = new Map(now.map((t) => [t.id, t]));
  if (mins > 0) {
    const day = isoDate(new Date());
    setStudy("focusLog", { ...state.focusLog, [day]: (state.focusLog[day] ?? 0) + Math.round(mins) });
  }
});


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
