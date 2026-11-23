import { useEffect, useState } from "react";
import { CalendarCheck, Check, Layers, X } from "lucide-react";
import { isoDate } from "../lib/colors";
import { dueCards, openReview, useSrs } from "../lib/srs";
import { loadPlan, tick, todaySessions, toggleSession, usePlan } from "../lib/studyPlan";
import { agentHost } from "../lib/neridaAgent";

/* Runs the study plan in the background (missed sessions move, the daily reminder fires) and shows
 * "Today's plan" once a day when Oceanic opens. */
const SEEN = "oc-plan-card-seen";

export function StudyPlanHost() {
  const plan = usePlan();
  const { cards } = useSrs();
  const today = isoDate(new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    void loadPlan().then(() => {
      // Wait for the notes to load before the first tick writes day notes.
      setTimeout(() => tick(), 5000);
      timer = setInterval(() => tick(), 60_000);
    });
    return () => clearInterval(timer);
  }, []);

  const sessions = todaySessions(plan, today);
  const due = dueCards(cards).length;
  useEffect(() => {
    if (!sessions.length) return;
    let seen = "";
    try { seen = localStorage.getItem(SEEN) ?? ""; } catch { /* no storage: show it */ }
    if (seen !== today) setOpen(true);
  }, [sessions.length, today]);

  if (!open || !plan || !sessions.length) return null;
  const close = () => {
    setOpen(false);
    try { localStorage.setItem(SEEN, today); } catch { /* ignore */ }
  };
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[300px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[rgba(24,26,32,0.8)] shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <CalendarCheck className="size-4 text-[color:var(--oc-brand-light)]" />
        <span className="flex-1 text-[13px] font-semibold text-neutral-100">Today's plan</span>
        {plan.noteId && <button type="button" onClick={() => agentHost()?.open(plan.noteId!)} className="cursor-pointer text-[11.5px] text-neutral-400 hover:text-neutral-200">Open plan</button>}
        <button type="button" onClick={close} title="Hide until tomorrow" className="cursor-pointer rounded p-0.5 text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
      </div>
      <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto p-2">
        {sessions.map((s) => (
          <button key={s.id} type="button" onClick={() => (s.review && !s.done && due ? openReview() : toggleSession(s.id))}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.05]">
            <span onClick={(e) => (e.stopPropagation(), toggleSession(s.id))} className={`grid size-4 shrink-0 place-items-center rounded border ${s.done ? "border-emerald-400 bg-emerald-400" : "border-white/25"}`}>
              {s.done && <Check className="size-3 text-black" />}
            </span>
            <span className="w-10 shrink-0 text-[11.5px] text-neutral-500">{s.start}</span>
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${s.done ? "text-neutral-500 line-through" : "text-neutral-200"}`}>
              {s.review ? <><Layers className="mr-1 inline size-3" />{due ? `Review ${due} card${due > 1 ? "s" : ""}` : "No cards due"}</> : s.subject}
            </span>
            <span className="text-[11px] text-neutral-500">{s.minutes}m</span>
          </button>
        ))}
      </div>
    </div>
  );
}
