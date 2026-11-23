import { useMemo, useState } from "react";
import type { PageMeta } from "../data/workspace";
import { isoDate } from "../lib/colors";
import { findDate } from "../lib/neridaTask";
import { studyKind } from "../lib/study";
import { savePlan, schedule, writeNotes, writeTips, type Exam, type Plan } from "../lib/studyPlan";
import { agentHost } from "../lib/neridaAgent";
import { NeridaAskBox, type AskAnswers, type AskQuestion } from "./NeridaAskBox";

/* /plan: two rounds of questions (what, when, how long → how confident per exam, reminder time),
 * then the app builds the schedule and Nerida writes a tip per subject. */

const HOURS: [string, number[], string][] = [
  ["1 hour a day", [60, 60, 60, 60, 60, 60, 60], "Light: good when exams are far off."],
  ["2 hours a day", [120, 120, 120, 120, 120, 120, 120], "Steady for most students."],
  ["3 hours a day", [180, 180, 180, 180, 180, 180, 180], "Exam season."],
  ["Weekdays 1.5h, weekends 3h", [180, 90, 90, 90, 90, 90, 180], "Lighter on school days."],
];
const TIMES = [["Morning", "morning", "From 9:00."], ["Afternoon", "afternoon", "From 14:00."], ["Evening", "evening", "From 18:00."]] as const;
const LENGTHS: [string, number, number, string][] = [
  ["25 min + 5 min break", 25, 5, "Pomodoro: short and focused."],
  ["45 min + 10 min break", 45, 10, "Longer focus blocks."],
  ["60 min + 10 min break", 60, 10, "Deep work."],
];
const CONF = ["1 · Very weak", "2 · Weak", "3 · Okay", "4 · Good", "5 · Strong"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const weekPreview = (mins: number[]) => (
  <div className="flex flex-col gap-1">
    <div className="text-[10.5px] uppercase tracking-wide text-neutral-500">Your week</div>
    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
      <div key={d} className="flex items-center gap-2">
        <span className="w-7 text-neutral-500">{DAY[d]}</span>
        <span className="h-1.5 rounded-full bg-[color:var(--oc-brand)]" style={{ width: `${(mins[d] / 180) * 60}%` }} />
        <span className="text-neutral-400">{mins[d] / 60}h</span>
      </div>
    ))}
  </div>
);
const dayPreview = (start: string, len: number, brk: number) => {
  const [h, m] = start.split(":").map(Number);
  let t = h * 60 + m + 10 + brk;
  const rows = ["Flashcard review · 10 min"];
  for (let i = 0; i < 3; i++, t += len + brk) rows.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")} · study ${len} min`);
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10.5px] uppercase tracking-wide text-neutral-500">A study day</div>
      <div className="text-neutral-400">{start} · {rows[0]}</div>
      {rows.slice(1).map((r) => <div key={r}>{r}</div>)}
    </div>
  );
};

/** "Maths exam Dec 5, Bio Friday" → exams, using the app's own date reading. */
function typedExams(text: string): Exam[] {
  return text
    .split(/[;,\n]+/)
    .map((part) => {
      const hit = findDate(part);
      const title = (hit ? part.replace(new RegExp(hit.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "") : part).replace(/\b(on|by|due|is|exam|test)\b\s*$/i, "").replace(/\s+/g, " ").trim();
      return hit && title ? { id: Math.random().toString(36).slice(2, 10), title, date: isoDate(hit.date), confidence: 3 } : null;
    })
    .filter((e): e is Exam => !!e);
}

export function StudyPlanWizard({ pages, typed = "", onClose, onMade }: { pages: PageMeta[]; typed?: string; onClose: () => void; onMade: (msg: string) => void }) {
  /** Exams typed after "/plan": the exams question is skipped. */
  const given = useMemo(() => typedExams(typed), [typed]);
  const today = isoDate(new Date());
  const upcoming = useMemo(() => pages.filter((p) => !p.trashedAt && p.dueDate && p.dueDate > today && (studyKind(p) || p.status !== "done")).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 8), [pages, today]);
  const [first, setFirst] = useState<AskAnswers | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [busy, setBusy] = useState("");

  const round1: AskQuestion[] = [
    ...(given.length ? [] : [{
      id: "exams", header: "Exams", multi: true, question: "Which exams or deadlines should the plan cover?",
      options: upcoming.map((p) => ({ label: p.title || "Untitled", description: `${studyKind(p) === "exam" ? "Exam" : "Due"} ${new Date(p.dueDate! + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` })),
      otherPlaceholder: "e.g. Maths Dec 5, Biology next Friday",
    } satisfies AskQuestion]),
    { id: "hours", header: "Hours", question: "How much time can you study each day?", options: HOURS.map(([label, mins, description], i) => ({ label, description, recommended: i === 1, preview: weekPreview(mins) })), otherPlaceholder: "Hours a day, e.g. 2.5" },
    { id: "time", header: "Time", question: "When do you like to study?", options: TIMES.map(([label, , description], i) => ({ label, description, recommended: i === 2 })), other: false },
    {
      id: "length", header: "Sessions", question: "How long should each study session be?", other: false,
      options: LENGTHS.map(([label, len, brk, description], i) => ({ label, description, recommended: i === 0, preview: dayPreview("18:00", len, brk) })),
    },
  ];
  const round2: AskQuestion[] = [
    ...exams.map((e) => ({
      id: `c:${e.id}`, header: e.title.slice(0, 14), other: false, skipTo: [CONF[2]],
      question: `How confident are you in ${e.title}? Weaker subjects get more sessions.`,
      options: CONF.map((label, i) => ({ label, recommended: i === 2 })),
    })),
    {
      id: "notify", header: "Reminder", question: "When should Nerida remind you each day?",
      options: [["07:30", "Before school"], ["16:00", "After school"], ["18:00", "Evening"]].map(([label, description], i) => ({ label, description, recommended: i === 1 })),
      otherPlaceholder: "Time, e.g. 17:15",
    },
  ];

  const afterFirst = (a: AskAnswers) => {
    a = { ...a, exams: a.exams ?? [] };
    const chosen = upcoming.filter((p) => a.exams.includes(p.title || "Untitled")).map((p): Exam => ({ id: p.id, title: p.title || "Untitled", date: p.dueDate!, confidence: 3, pageId: p.id }));
    const typed = a.exams.filter((x) => !upcoming.some((p) => (p.title || "Untitled") === x)).flatMap(typedExams);
    const all = [...given, ...chosen, ...typed];
    const text = a.exams.filter((x) => !upcoming.some((p) => (p.title || "Untitled") === x)).join(", ");
    if (!all.length) return onMade(`I need at least one exam or deadline with a date to plan for${text ? `, and I couldn't find a date in "${text}"` : ""}. Try again, like \`/plan Maths Dec 5, Biology next Friday\`.`);
    setExams(all);
    setFirst(a);
  };

  const build = async (b: AskAnswers) => {
    const a = first!;
    const hours = HOURS.find(([l]) => l === a.hours[0])?.[1] ?? Array(7).fill(Math.round((parseFloat(a.hours[0]) || 2) * 60));
    const len = LENGTHS.find(([l]) => l === a.length[0]) ?? LENGTHS[0];
    const time = TIMES.find(([l]) => l === a.time[0])?.[1] ?? "evening";
    const at = /^\d{1,2}:\d{2}$/.test(b.notify[0] ?? "") ? b.notify[0].padStart(5, "0") : "16:00";
    const ex = exams.map((e) => ({ ...e, confidence: Math.max(1, CONF.indexOf(b[`c:${e.id}`]?.[0] ?? "") + 1) || 3 }));
    let plan: Plan = { exams: ex, daily: hours, time, session: len[1], breakMin: len[2], notifyAt: at, sessions: [], tips: {}, dayNotes: {}, checked: today };
    plan.sessions = schedule(plan, today);
    if (!plan.sessions.length) return onMade("Those dates are today or already past, so there are no days left to plan.");
    setBusy("Nerida is writing study tips…");
    plan.tips = await writeTips(plan, (s) => setBusy(`Nerida is writing a tip for ${s}…`));
    setBusy("Making your Study plan note and calendar days…");
    plan = await writeNotes(plan);
    savePlan(plan);
    if (plan.noteId) agentHost()?.open(plan.noteId);
    const n = plan.sessions.filter((s) => !s.review).length;
    onMade(`Done: ${n} study sessions over ${new Set(plan.sessions.map((s) => s.date)).size} days, in your **Study plan** note and on the Calendar. I'll remind you every day at ${at}, and missed sessions move to the next free days.`);
  };

  return first ? (
    <NeridaAskBox key="r2" title="Study plan · 2 of 2" questions={round2} busy={busy} onCancel={onClose} onDone={(b) => void build(b).finally(onClose)} />
  ) : (
    <NeridaAskBox key="r1" title="Study plan · 1 of 2" questions={round1} onCancel={onClose} onDone={afterFirst} />
  );
}
