import { useState } from "react";
import { gatherText, generateQuestions, saveCards, stopGenerating, type AiQuestion, type Difficulty } from "../lib/neridaStudy";
import { modelLabel, useNerida } from "../lib/nerida";
import { NeridaMark } from "./NeridaOrb";
import type { PageMeta } from "../data/workspace";
import { addTestRecord, buildQuiz, type Question, type QuestionType } from "../lib/quiz";
import { getSrs, grade, useSrs } from "../lib/srs";
import { clock, useStudy } from "../lib/study";
import { Modal, ModalButton } from "./Modal";
import { TestModal, type TestResult, type TestTimer } from "./TestModal";

/** Score + every mistake with the right answer. */
function Results({ questions, result, onRetry, onClose }: { questions: Question[]; result: TestResult; onRetry: () => void; onClose: () => void }) {
  const wrong = questions.map((q, i) => ({ q, a: result.answers[i] })).filter(({ q, a }) => a !== q.correct);
  const got = questions.length - wrong.length;
  const pct = Math.round((got / questions.length) * 100);
  const shown = (q: Question, a: number | undefined) => (a === undefined ? "Skipped" : q.type === "mcq" ? q.options[a] : a ? "True" : "False");
  const aiWrong = wrong.map(({ q }) => q as AiQuestion).filter((q) => q.source);
  const [saved, setSaved] = useState(false);
  const toCards = () => {
    const byPage = new Map<string, string[]>();
    for (const q of aiWrong) {
      const card = q.type === "mcq" ? `${q.prompt} :: ${q.answer}` : `True or false: ${q.prompt} :: ${q.correct ? "True" : `False. ${q.source}`}`;
      byPage.set(q.pageId, [...(byPage.get(q.pageId) ?? []), card]);
    }
    byPage.forEach((cards, pageId) => saveCards(pageId, cards));
    setSaved(true);
  };
  return (
    <Modal onClose={onClose} className="w-[560px]">
      <div className="px-6 pt-6 text-center">
        <p className={`text-[44px] font-bold tabular-nums leading-none ${pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-300" : "text-red-400"}`}>{pct}%</p>
        <p className="mt-2 text-[13.5px] text-neutral-300">{got} / {questions.length} correct · {clock(result.secs)}</p>
        {result.leaves > 0 && <p className="mt-1 text-[12px] text-amber-300">You left the app {result.leaves}× during the test</p>}
      </div>
      <div className="scrollbar-thin mt-5 max-h-[45vh] overflow-y-auto border-t border-white/[0.06] px-5 py-4">
        {!wrong.length ? (
          <p className="py-4 text-center text-[14px] text-neutral-200">Perfect score 🎉</p>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-neutral-500">Mistakes · these cards are now due in flashcard review</p>
            {wrong.map(({ q, a }) => (
              <div key={q.id} className="oc-row-in mb-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-[13.5px]">
                <p className="text-neutral-100">{q.prompt}</p>
                {q.type === "tf" && q.options[0] && <p className="mt-1 text-[12.5px] text-neutral-500">Shown answer: {q.options[0]}</p>}
                <p className="mt-1.5 text-red-300">✗ {shown(q, a)}</p>
                <p className="text-emerald-300">✓ {q.type === "mcq" ? q.options[q.correct] : (q as AiQuestion).source ? (q.correct ? "True" : "False") : `${q.correct ? "True" : "False"} — answer is ${q.answer}`}</p>
                {(q as AiQuestion).source && <p className="mt-1.5 border-l-2 border-white/10 pl-2 text-[12px] text-neutral-400">From your note: {(q as AiQuestion).source}</p>}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
        {aiWrong.length > 0 && <ModalButton disabled={saved} onClick={toCards}>{saved ? "Added to flashcards ✓" : `Turn ${aiWrong.length} mistake${aiWrong.length > 1 ? "s" : ""} into flashcards`}</ModalButton>}
        <ModalButton onClick={onRetry}>New test, same settings</ModalButton>
        <ModalButton variant="primary" onClick={onClose}>Done</ModalButton>
      </div>
    </Modal>
  );
}

/** Setup (classes or notes, count, types, timer) → locked test. */
export function TestSetup({ pages, onClose }: { pages: PageMeta[]; onClose: () => void }) {
  const { cards } = useSrs();
  const { subjects } = useStudy();
  const all = Object.values(cards);
  const withCards = pages.filter((p) => all.some((c) => c.pageId === p.id));
  const [by, setBy] = useState<"class" | "note">(subjects.length ? "class" : "note");
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<QuestionType[]>(["mcq", "tf"]);
  const [timerKind, setTimerKind] = useState<"off" | "total" | "per">("off");
  const [mins, setMins] = useState(10);
  const [secs, setSecs] = useState(30);
  const [test, setTest] = useState<{ title: string; questions: Question[]; timer: TestTimer } | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const { model } = useNerida();
  const [source, setSource] = useState<"cards" | "nerida">(all.length ? "cards" : "nerida");
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [related, setRelated] = useState(false);
  const [level, setLevel] = useState<Difficulty>("medium");
  const [gen, setGen] = useState<{ n: number; err?: string } | null>(null);
  const ai = source === "nerida";

  const pool = all.filter((c) => {
    if (!picked.length) return true;
    if (by === "note") return picked.includes(c.pageId);
    const tags = pages.find((p) => p.id === c.pageId)?.tags ?? [];
    return picked.some((s) => tags.includes(s));
  });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean) => `cursor-pointer rounded-full border px-3 py-1 text-[12.5px] transition-colors ${on ? "border-sky-400/60 bg-sky-500/15 text-sky-200" : "border-white/[0.1] text-neutral-400 hover:text-neutral-200"}`;
  const label = "mb-1.5 mt-4 block text-[12px] text-neutral-400";

  const startAi = async () => {
    setGen({ n: 0 });
    try {
      const src = await gatherText(aiNotes, related);
      const questions = await generateQuestions(src, count, types, level, (n) => setGen({ n }));
      if (!questions.length) return setGen({ n: 0, err: "Nerida couldn't find enough facts in these notes. Try longer notes or another model." });
      const timer: TestTimer = timerKind === "total" ? { kind: "total", secs: mins * 60 } : timerKind === "per" ? { kind: "per", secs } : null;
      setGen(null);
      setTest({ title: aiNotes.map((id) => pages.find((p) => p.id === id)?.title || "Untitled").join(", "), questions, timer });
    } catch (e) {
      setGen({ n: 0, err: String(e) });
    }
  };

  const start = () => {
    if (ai) return void startAi();
    const questions = buildQuiz(pool, count, types, all);
    const timer: TestTimer = timerKind === "total" ? { kind: "total", secs: mins * 60 } : timerKind === "per" ? { kind: "per", secs } : null;
    const title = picked.length ? (by === "note" ? picked.map((id) => pages.find((p) => p.id === id)?.title || "Untitled") : picked).join(", ") : "All flashcards";
    setTest({ title, questions, timer });
  };

  if (test && result) return <Results questions={test.questions} result={result} onRetry={() => (setResult(null), setTest(null), start())} onClose={onClose} />;
  if (gen && !gen.err)
    return (
      <Modal className="w-[420px] p-6 text-center">
        <div className="mx-auto mb-3 grid place-items-center"><NeridaMark size={48} busy /></div>
        <p className="oc-nerida-shimmer text-[14px]">Nerida is writing questions… {gen.n} / {count}</p>
        <p className="mt-1 text-[12px] text-neutral-500">Each question is checked against your notes.</p>
        <div className="mt-4"><ModalButton onClick={() => (stopGenerating(), setGen(null))}>Cancel</ModalButton></div>
      </Modal>
    );
  if (test)
    return (
      <TestModal
        {...test}
        onQuit={onClose}
        onFinish={(r) => {
          const wrong = test.questions.filter((q, i) => r.answers[i] !== q.correct);
          // Missed cards become due again in flashcard review.
          new Set(wrong.map((q) => q.cardId)).forEach((id) => getSrs().cards[id] && grade(getSrs().cards[id], 1));
          addTestRecord({ id: crypto.randomUUID(), date: new Date().toISOString(), title: test.title, score: test.questions.length - wrong.length, total: test.questions.length, secs: r.secs, leaves: r.leaves });
          setResult(r);
        }}
      />
    );

  return (
    <Modal onClose={onClose} className="w-[480px] p-5">
      <h2 className="text-[15px] font-semibold text-neutral-100">📝 New test</h2>
      <span className={label}>Questions from</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setSource("cards")} className={chip(!ai)}>My flashcards</button>
        <button type="button" onClick={() => setSource("nerida")} className={chip(ai)}><span className="inline-flex items-center gap-1"><NeridaMark size={13} /> Nerida (from note text)</span></button>
      </div>
      {ai ? (
        <>
          <span className={label}>Notes · {modelLabel(model)}</span>
          <div className="scrollbar-thin flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {pages.map((p) => (
              <button key={p.id} type="button" onClick={() => setAiNotes(toggle(aiNotes, p.id))} className={chip(aiNotes.includes(p.id))}>{`${p.icon ?? ""} ${p.title || "Untitled"}`}</button>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-neutral-300">
            <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} className="accent-sky-500" /> Include sub-pages and linked notes
          </label>
          <span className={label}>Difficulty</span>
          <div className="flex gap-1.5">
            {(["easy", "medium", "hard"] as const).map((d) => <button key={d} type="button" onClick={() => setLevel(d)} className={chip(level === d)}>{d[0].toUpperCase() + d.slice(1)}</button>)}
          </div>
          {gen?.err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{gen.err}</p>}
        </>
      ) : !all.length ? (
        <p className="mt-3 text-[13px] text-neutral-400">Tests are made from flashcards. Write <code>Question :: Answer</code> in a note first, or pick Nerida above.</p>
      ) : (
        <>
          <span className={label}>Test me on</span>
          <div className="mb-2 flex gap-1.5">
            {(["class", "note"] as const).map((b) => (
              <button key={b} type="button" onClick={() => (setBy(b), setPicked([]))} className={chip(by === b)}>{b === "class" ? "Classes" : "Notes"}</button>
            ))}
          </div>
          <div className="scrollbar-thin flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {(by === "class" ? subjects.map((s) => [s, s]) : withCards.map((p) => [p.id, `${p.icon ?? ""} ${p.title || "Untitled"}`])).map(([id, name]) => (
              <button key={id} type="button" onClick={() => setPicked(toggle(picked, id))} className={chip(picked.includes(id))}>{name}</button>
            ))}
            {by === "class" && !subjects.length && <span className="text-[12px] text-neutral-500">No classes chosen on the dashboard yet.</span>}
          </div>
          <p className="mt-1.5 text-[11.5px] text-neutral-500">{picked.length ? "" : "Nothing picked = all cards · "}{pool.length} card{pool.length === 1 ? "" : "s"} available</p>
        </>
      )}
      {(ai || all.length > 0) && (
        <>

          <span className={label}>Questions</span>
          <div className="flex gap-1.5">
            {[5, 10, 20].map((n) => <button key={n} type="button" onClick={() => setCount(n)} className={chip(count === n)}>{n}</button>)}
          </div>

          <span className={label}>Question types</span>
          <div className="flex gap-1.5">
            {([["mcq", "Multiple choice"], ["tf", "True / False"]] as const).map(([t, name]) => (
              <button key={t} type="button" onClick={() => setTypes(toggle(types, t))} className={chip(types.includes(t))}>{name}</button>
            ))}
          </div>

          <span className={label}>Timer</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {([["off", "Off"], ["total", "Whole test"], ["per", "Per question"]] as const).map(([k, name]) => (
              <button key={k} type="button" onClick={() => setTimerKind(k)} className={chip(timerKind === k)}>{name}</button>
            ))}
            {timerKind !== "off" && (
              <label className="ml-2 flex items-center gap-1.5 text-[12.5px] text-neutral-400">
                <input
                  type="number" min={1} value={timerKind === "total" ? mins : secs}
                  onChange={(e) => (timerKind === "total" ? setMins : setSecs)(Math.max(1, Number(e.target.value) || 1))}
                  className="h-7 w-16 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-neutral-100 outline-none"
                />
                {timerKind === "total" ? "min" : "sec each"}
              </label>
            )}
          </div>
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">While the test runs, app shortcuts are blocked and leaving the app is counted.</p>
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={ai ? !aiNotes.length || !types.length : !pool.length || !types.length} onClick={start}>{ai ? "Generate test" : "Start test"}</ModalButton>
      </div>
    </Modal>
  );
}
