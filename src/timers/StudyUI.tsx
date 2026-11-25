import { useState } from "react";
import { BookOpen, Flame, GraduationCap, Plus, X } from "lucide-react";
import { Modal } from "../components/Modal";
import * as S from "./study";

const field = "h-8 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none focus:border-sky-500/60";
const chip = "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors";

/** Before a timer starts: General or Subject study (or don't track). After a session: a short note. */
export function StudyPrompts() {
  const s = S.useStudy();
  const [subject, setSubject] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  if (s.review)
    return (
      <Modal glass label="Session note" onClose={() => S.saveReview("")} className="w-[min(420px,92vw)] p-5">
        <h2 className="text-[16px] font-bold text-neutral-100">Nice session!</h2>
        <p className="mt-1 text-[12.5px] text-neutral-400">{Math.round(s.review.ms / 60e3)} min of {S.subjectOf(s.review.track)?.name ?? "study"}. What did you cover? It's saved as a note.</p>
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="e.g. Chapter 3, kinematics problems 1–12" className={`${field} mt-3 h-auto w-full resize-none py-2`} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => (S.saveReview(""), setNote(""))} className={`${chip} bg-white/[0.06] text-neutral-200 hover:bg-white/[0.1]`}>Skip</button>
          <button type="button" onClick={() => (S.saveReview(note), setNote(""))} className={`${chip} bg-sky-500 text-white hover:brightness-110`}>Save note</button>
        </div>
      </Modal>
    );
  if (!s.ask) return null;
  const pick = (t: string) => (setSubject(false), setName(""), S.answer(t));
  const close = () => (setSubject(false), S.cancelAsk());
  return (
    <Modal glass label="What are you studying?" onClose={close} className="w-[min(440px,92vw)] p-5">
      <h2 className="text-[16px] font-bold text-neutral-100">What is this timer for?</h2>
      {!subject ? (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" autoFocus onClick={() => pick("general")} className="flex cursor-pointer gap-3 rounded-xl bg-white/[0.04] p-3 text-left hover:bg-white/[0.08]">
            <BookOpen className="mt-0.5 size-5 shrink-0 text-slate-400" />
            <span><b className="text-[13.5px] text-neutral-100">General study</b><br /><span className="text-[12px] text-neutral-400">Reading, revision or homework across topics. Counts toward your daily goal.</span></span>
          </button>
          <button type="button" onClick={() => setSubject(true)} className="flex cursor-pointer gap-3 rounded-xl bg-white/[0.04] p-3 text-left hover:bg-white/[0.08]">
            <GraduationCap className="mt-0.5 size-5 shrink-0 text-sky-400" />
            <span><b className="text-[13.5px] text-neutral-100">Subject study</b><br /><span className="text-[12px] text-neutral-400">Focus on one subject. Time is tracked per subject in Study stats.</span></span>
          </button>
          <button type="button" onClick={() => pick("")} className="mt-1 cursor-pointer self-center text-[12px] text-neutral-500 hover:text-neutral-200">Don't track, just start</button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {s.subjects.map((x) => (
              <button key={x.id} type="button" onClick={() => pick(x.id)} className={`${chip} bg-white/[0.06] text-neutral-100 hover:bg-white/[0.12]`}>
                <span className="size-2.5 rounded-full" style={{ background: x.color }} />{x.name}
              </button>
            ))}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const id = S.addSubject(name); if (id) pick(id); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add your own subject" className={`${field} min-w-0 flex-1`} />
            <button type="submit" disabled={!name.trim()} className={`${chip} bg-sky-500 text-white disabled:opacity-40`}><Plus className="size-3.5" />Add & start</button>
          </form>
          <button type="button" onClick={() => setSubject(false)} className="mt-3 cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-200">Back</button>
        </div>
      )}
    </Modal>
  );
}

/** Timers panel tab: goal, streak, last 7 days chart, per-subject totals, subject editing. */
export function StudyTab() {
  const s = S.useStudy();
  const [name, setName] = useState("");
  const week = S.days(7);
  const max = Math.max(s.goal, ...week.map((d) => d.total));
  const tracks = [S.GENERAL, ...s.subjects];
  const today = week[6].total;
  const totals = tracks.map((t) => [t, week.reduce((a, d) => a + (d.by[t.id] ?? 0), 0)] as const).filter(([, m]) => m > 0);
  const m = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${Math.round(n)}m`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-3">
        <div className="flex-1">
          <p className="text-[12px] text-neutral-500">Today</p>
          <p className="text-[20px] font-semibold text-neutral-100">{m(today)} <span className="text-[13px] font-normal text-neutral-500">/ {m(s.goal)}</span></p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (today / s.goal) * 100)}%` }} /></div>
        </div>
        <div className="flex items-center gap-1 text-[13px] text-amber-300"><Flame className="size-4" />{S.streak()} day streak</div>
        <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">Daily goal (min)
          <input type="number" min={5} max={1440} value={s.goal} onChange={(e) => S.setGoal(Math.floor(+e.target.value || 5))} className={`${field} w-20`} />
        </label>
      </div>
      <div>
        <p className="mb-2 text-[12px] text-neutral-500">Last 7 days</p>
        <div className="flex h-32 items-end gap-2">
          {week.map((d) => (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${m(d.total)}`}>
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-md" style={{ height: `${(d.total / max) * 100}%` }}>
                {tracks.map((t) => d.by[t.id] ? <div key={t.id} style={{ height: `${(d.by[t.id] / d.total) * 100}%`, background: t.color }} /> : null)}
              </div>
              <span className="text-[10.5px] text-neutral-500">{new Date(d.day + "T00:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
            </div>
          ))}
        </div>
        {totals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-neutral-300">
            {totals.map(([t, n]) => <span key={t.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: t.color }} />{t.name} {m(n)}</span>)}
          </div>
        )}
      </div>
      <div>
        <p className="mb-2 text-[12px] text-neutral-500">Subjects</p>
        <div className="flex flex-col gap-1.5">
          {s.subjects.map((x) => (
            <div key={x.id} className="flex items-center gap-2">
              <input type="color" aria-label={`${x.name} color`} value={x.color} onChange={(e) => S.patchSubject(x.id, { color: e.target.value })} className="size-7 cursor-pointer rounded-full border-0 bg-transparent" />
              <input aria-label="Subject name" value={x.name} onChange={(e) => S.patchSubject(x.id, { name: e.target.value })} className={`${field} min-w-0 flex-1`} />
              <button type="button" aria-label={`Remove ${x.name}`} onClick={() => S.removeSubject(x.id)} className="grid size-8 cursor-pointer place-items-center rounded-full text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-100"><X className="size-4" /></button>
            </div>
          ))}
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), S.addSubject(name), setName(""))}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add your own subject" className={`${field} min-w-0 flex-1`} />
            <button type="submit" disabled={!name.trim()} className={`${chip} bg-white/[0.06] text-neutral-200 disabled:opacity-40`}><Plus className="size-3.5" />Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}
