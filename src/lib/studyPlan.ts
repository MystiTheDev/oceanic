import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../data/api";
import { isoDate, parseIsoDate } from "./colors";
import { engine, nerida } from "./nerida";
import { agentHost } from "./neridaAgent";
import { dueCards, getSrs } from "./srs";

/* Study plan: the app spreads study sessions over the days before each exam (exact code, so a small
 * model can't miscount days or hours); Nerida only writes a one-line tip per subject. The plan lives in
 * settings, as a "Study plan" note, and as one dated sub-note per study day (so days show on the Calendar).
 * Missed sessions move to the next free days; a reminder fires once a day. */

export type Exam = { id: string; title: string; date: string; /** 1 = weak … 5 = strong. */ confidence: number; pageId?: string };
export type Session = { id: string; date: string; start: string; minutes: number; examId: string; subject: string; done: boolean; review?: boolean };
export type Plan = {
  exams: Exam[];
  /** Minutes a day, Sunday first. */
  daily: number[];
  time: "morning" | "afternoon" | "evening";
  /** Focus minutes per session, and the break after each. */
  session: number;
  breakMin: number;
  /** Daily reminder, "HH:MM". */
  notifyAt: string;
  sessions: Session[];
  tips: Record<string, string>;
  noteId?: string;
  /** Study day → its dated sub-note. */
  dayNotes: Record<string, string>;
  /** Last day the reminder fired and the missed sessions were moved. */
  notified?: string;
  checked?: string;
};

const KEY = "studyPlan";
let plan: Plan | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const usePlan = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => plan);
export const getPlan = () => plan;
export function savePlan(p: Plan | null) {
  plan = p;
  emit();
  void api.setSetting(KEY, p ? JSON.stringify(p) : "").catch(() => {});
}
export async function loadPlan() {
  try {
    const s = (await api.getSettings())[KEY];
    plan = s ? (JSON.parse(s) as Plan) : null;
  } catch {
    plan = null;
  }
  emit();
}

const uid = () => Math.random().toString(36).slice(2, 10);
const addDays = (d: string, n: number) => {
  const x = parseIsoDate(d);
  x.setDate(x.getDate() + n);
  return isoDate(x);
};
const days = (a: string, b: string) => Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 864e5);
const START = { morning: 9 * 60, afternoon: 14 * 60, evening: 18 * 60 } as const;
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const REVIEW_MIN = 10;

/** Sessions from `from` until each exam. Weak subjects and close exams get more; done sessions count as studied. */
export function schedule(p: Omit<Plan, "sessions">, from = isoDate(new Date()), done: Session[] = []): Session[] {
  const exams = p.exams.filter((e) => e.date > from);
  if (!exams.length) return [];
  const last = exams.reduce((m, e) => (e.date > m ? e.date : m), from);
  const studied = new Map<string, number>(exams.map((e) => [e.id, done.filter((s) => s.examId === e.id && !s.review).length]));
  const out: Session[] = [];
  for (let d = from; d < last; d = addDays(d, 1)) {
    let budget = p.daily[parseIsoDate(d).getDay()] ?? 0;
    if (budget <= 0) continue;
    let clock = START[p.time];
    // A short slot for the day's due flashcards first.
    out.push({ id: uid(), date: d, start: hhmm(clock), minutes: REVIEW_MIN, examId: "", subject: "Flashcard review", done: false, review: true });
    budget -= REVIEW_MIN;
    clock += REVIEW_MIN + p.breakMin;
    let prev = "";
    while (budget >= Math.min(p.session, 20)) {
      const open = exams.filter((e) => e.date > d);
      if (!open.length) break;
      // Need: weakness × closeness ÷ (sessions so far + 1); the same subject twice in a row only when it's the only one.
      const need = (e: Exam) => ((6 - e.confidence) * (1 + 5 / Math.max(1, days(d, e.date)))) / (studied.get(e.id)! + 1) * (e.id === prev && open.length > 1 ? 0.3 : 1);
      const e = open.reduce((a, b) => (need(b) > need(a) ? b : a));
      const minutes = Math.min(p.session, budget);
      out.push({ id: uid(), date: d, start: hhmm(clock), minutes, examId: e.id, subject: e.title, done: false });
      studied.set(e.id, studied.get(e.id)! + 1);
      prev = e.id;
      budget -= minutes + p.breakMin;
      clock += minutes + p.breakMin;
    }
  }
  return out;
}

/** Past sessions left unchecked move to the next free days: the future is planned again around what's done. */
export function reschedule(p: Plan, today = isoDate(new Date())): Plan {
  const done = p.sessions.filter((s) => s.done);
  const kept = p.sessions.filter((s) => s.date < today && s.done);
  const todays = p.sessions.filter((s) => s.date === today);
  const future = schedule(p, addDays(today, 1), [...done]);
  // Today stays as it was (the student may be mid-way), unless today had nothing planned.
  const now = todays.length ? todays : schedule(p, today, [...done]).filter((s) => s.date === today);
  return { ...p, sessions: [...kept, ...now, ...future], checked: today };
}

/** Markdown for one study day. */
const dayMd = (p: Plan, day: string) =>
  p.sessions
    .filter((s) => s.date === day)
    .map((s) => `- [${s.done ? "x" : " "}] **${s.start}** ${s.subject} · ${s.minutes} min${!s.review && p.tips[s.subject] ? ` — ${p.tips[s.subject]}` : ""}`)
    .join("\n");
const dayTitle = (d: string) => parseIsoDate(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export function planMarkdown(p: Plan): string {
  const exams = [...p.exams].sort((a, b) => a.date.localeCompare(b.date)).map((e) => `- **${e.title}**: ${dayTitle(e.date)} (confidence ${e.confidence}/5)`);
  const daysList = [...new Set(p.sessions.map((s) => s.date))].sort();
  return [
    "Made by Nerida. Missed sessions move to the next free days automatically.",
    "## Exams",
    ...exams,
    ...daysList.flatMap((d) => [`## ${dayTitle(d)}`, dayMd(p, d)]),
  ].join("\n\n");
}

/** One short tip per subject from the model; skipped quietly if it fails. */
export async function writeTips(p: Plan, onProgress?: (subject: string) => void): Promise<Record<string, string>> {
  const tips: Record<string, string> = { ...p.tips };
  for (const e of p.exams) {
    if (tips[e.title]) continue;
    onProgress?.(e.title);
    let out = "";
    try {
      await engine.chat(
        nerida.get().model,
        [
          { role: "system", content: "You are Nerida, a study coach. Reply with one short sentence only, no intro." },
          { role: "user", content: `I have "${e.title}" on ${e.date}. My confidence is ${e.confidence}/5. Give one specific tip for how to study for it.` },
        ],
        (t) => {
          out += t;
          if (out.length > 220) void engine.stop();
        },
      );
    } catch {
      /* no model: plan without tips */
    }
    const tip = out.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
    if (tip) tips[e.title] = tip.slice(0, 200);
  }
  return tips;
}

/** Writes the plan note and one dated sub-note per study day (Calendar). Day notes are updated in place;
 *  only a future day left with no sessions goes to Trash. */
export async function writeNotes(p: Plan): Promise<Plan> {
  const host = agentHost();
  if (!host) return p;
  const live = new Set(host.pages().filter((x) => !x.trashedAt).map((x) => x.id));
  let noteId = p.noteId && live.has(p.noteId) ? p.noteId : undefined;
  const body = host.markdown(planMarkdown(p));
  if (noteId) host.setDoc(noteId, body);
  else noteId = await host.createNote("Study plan", null, body);
  if (!noteId) return p;
  const dayNotes: Record<string, string> = {};
  const today = isoDate(new Date());
  const studyDays = new Set(p.sessions.map((s) => s.date));
  for (const [d, id] of Object.entries(p.dayNotes ?? {})) {
    if (!live.has(id)) continue;
    if (d < today || studyDays.has(d)) dayNotes[d] = id; // past days stay as a record
    else host.trash(id); // no sessions left that day
  }
  for (const d of [...studyDays].sort()) {
    if (d < today) continue;
    const body = host.markdown(dayMd(p, d));
    if (dayNotes[d]) host.setDoc(dayNotes[d], body);
    else {
      const id = await host.createNote(`Study: ${dayTitle(d)}`, noteId, body, d);
      if (id) dayNotes[d] = id;
    }
  }
  return { ...p, noteId, dayNotes };
}

export const todaySessions = (p: Plan | null, today = isoDate(new Date())) => (p ? p.sessions.filter((s) => s.date === today) : []);

export function toggleSession(id: string) {
  if (!plan) return;
  savePlan({ ...plan, sessions: plan.sessions.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
}

/** The reminder text: today's sessions and due cards. */
export function reminder(p: Plan): { title: string; body: string } | null {
  const left = todaySessions(p).filter((s) => !s.done && !s.review);
  const cards = dueCards(getSrs().cards).length;
  if (!left.length && !cards) return null;
  const mins = left.reduce((n, s) => n + s.minutes, 0);
  const subjects = [...new Set(left.map((s) => s.subject))].join(", ");
  return {
    title: "Today's study plan",
    body: [left.length && `${left.length} session${left.length > 1 ? "s" : ""} (${mins} min): ${subjects}`, cards && `${cards} flashcard${cards > 1 ? "s" : ""} due`].filter(Boolean).join(" · "),
  };
}

/** Every minute: once a day, move missed sessions; at the reminder time, notify once. */
export function tick(now = new Date()) {
  const p = plan;
  if (!p) return;
  const today = isoDate(now);
  if (p.checked !== today) {
    const missed = p.sessions.some((s) => s.date < today && !s.done && !s.review);
    const next = missed ? reschedule(p, today) : { ...p, checked: today };
    savePlan(next);
    // Notes change only when sessions moved.
    if (missed) void writeNotes(next).then((q) => q !== next && savePlan({ ...getPlan()!, noteId: q.noteId, dayNotes: q.dayNotes }));
  }
  const cur = getPlan()!;
  if (cur.notified !== today && hhmm(now.getHours() * 60 + now.getMinutes()) >= cur.notifyAt) {
    const r = reminder(cur);
    savePlan({ ...cur, notified: today });
    if (r) void invoke("notify", r).catch(() => {});
  }
}
