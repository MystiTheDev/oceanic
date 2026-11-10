import { useEffect, useRef, useState } from "react";
import { clock } from "../lib/study";
import type { Question } from "../lib/quiz";
import { Modal, ModalButton } from "./Modal";

export type TestTimer = { kind: "total" | "per"; secs: number } | null;
export type TestResult = { answers: (number | undefined)[]; leaves: number; secs: number };

/** Locked test screen: app shortcuts are blocked, no click-outside/Esc close, leaving the app is counted. */
export function TestModal({ title, questions, timer, onFinish, onQuit }: { title: string; questions: Question[]; timer: TestTimer; onFinish: (r: TestResult) => void; onQuit: () => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [leaves, setLeaves] = useState(0);
  const [left, setLeft] = useState(timer?.secs ?? 0);
  const [confirm, setConfirm] = useState<null | "submit" | "quit">(null);
  const started = useRef(Date.now());
  const q = questions[i];
  const last = i === questions.length - 1;
  const per = timer?.kind === "per";
  const finish = (a = answers) => onFinish({ answers: a, leaves, secs: Math.round((Date.now() - started.current) / 1000) });
  const pick = (n: number) => setAnswers((a) => Object.assign([...a], { [i]: n }));
  const next = () => (last ? setConfirm("submit") : (setI(i + 1), per && setLeft(timer!.secs)));

  // Countdown: whole test auto-submits; per question moves on.
  useEffect(() => {
    if (!timer || confirm) return;
    if (left <= 0) {
      if (!per || last) finish();
      else (setI(i + 1), setLeft(timer.secs));
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, confirm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swallow every key in capture phase so no app shortcut runs; handle only the test's own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Escape" || e.key === "Tab" || /^F\d+$/.test(e.key)) return e.preventDefault();
      if (confirm) return;
      const k = e.key.toLowerCase();
      if (q.type === "mcq" && ["1", "2", "3", "4"].includes(k)) pick(Number(k) - 1);
      else if (q.type === "tf" && (k === "t" || k === "f")) pick(k === "t" ? 1 : 0);
      else if (k === "arrowright" || k === "enter") next();
      else if (k === "arrowleft" && !per && i > 0) setI(i - 1);
      else return;
      e.preventDefault();
    };
    const onBlur = () => setLeaves((n) => n + 1); // window lost focus (Alt+Tab, minimise, other app)
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => (window.removeEventListener("keydown", onKey, true), window.removeEventListener("blur", onBlur));
  });
  useEffect(() => (document.activeElement as HTMLElement | null)?.blur(), []);

  const opt = (on: boolean) => `oc-row-in flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-[14.5px] transition-all ${on ? "border-sky-400/70 bg-sky-500/15 text-white" : "border-white/[0.08] bg-white/[0.03] text-neutral-200 hover:border-white/20 hover:bg-white/[0.06]"}`;
  const answered = answers.filter((a) => a !== undefined).length;
  return (
    <Modal className="w-[640px]">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3 text-[12.5px] text-neutral-400">
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-200">{title}</span>
        {leaves > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">Left app {leaves}×</span>}
        {timer && <span className={`tabular-nums ${left <= 10 ? "text-red-400" : ""}`}>⏱ {clock(left)}</span>}
        <span className="tabular-nums">{i + 1} / {questions.length}</span>
      </div>
      <div className="h-1 bg-white/[0.05]"><div className="h-full bg-sky-500 transition-all" style={{ width: `${((i + 1) / questions.length) * 100}%` }} /></div>

      <div key={q.id} className="px-6 py-6">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">{q.type === "mcq" ? "Multiple choice" : "True or false"}</p>
        <p className="mb-5 whitespace-pre-wrap text-[18px] text-neutral-100">{q.prompt}</p>
        {q.type === "mcq" ? (
          <div className="flex flex-col gap-2">
            {q.options.map((o, n) => (
              <button key={n} type="button" onClick={() => pick(n)} className={opt(answers[i] === n)} style={{ animationDelay: `${n * 40}ms` }}>
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/[0.07] text-[12px] text-neutral-400">{n + 1}</span>
                {o}
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Nerida true/false questions are a statement in the prompt, with no shown answer. */}
            {q.options[0] && <p className="mb-4 rounded-xl bg-white/[0.04] px-4 py-3 text-[15px] text-neutral-200">Answer: <b>{q.options[0]}</b></p>}
            <div className="grid grid-cols-2 gap-2">
              {[1, 0].map((n) => (
                <button key={n} type="button" onClick={() => pick(n)} className={`${opt(answers[i] === n)} justify-center`}>{n ? "True (T)" : "False (F)"}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3">
        <ModalButton variant="danger" onClick={() => setConfirm("quit")}>Quit test</ModalButton>
        <span className="flex-1 text-center text-[12px] text-neutral-500">{answered} of {questions.length} answered</span>
        {!per && <ModalButton disabled={i === 0} onClick={() => setI(i - 1)}>Previous</ModalButton>}
        <ModalButton variant="primary" onClick={next}>{last ? "Submit" : "Next"}</ModalButton>
      </div>

      {confirm && (
        <Modal className="w-[360px] p-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">{confirm === "quit" ? "Quit this test?" : "Submit test?"}</h2>
          <p className="mt-1 text-[13px] text-neutral-400">
            {confirm === "quit" ? "Your answers won't be saved." : answered < questions.length ? `${questions.length - answered} question(s) unanswered.` : "All questions answered."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <ModalButton onClick={() => setConfirm(null)}>Back</ModalButton>
            <ModalButton variant={confirm === "quit" ? "danger" : "primary"} onClick={confirm === "quit" ? onQuit : () => finish()}>{confirm === "quit" ? "Quit" : "Submit"}</ModalButton>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
