import { useEffect, useState } from "react";
import { ThinkingStatus } from "./NeridaEffort";
import { nerida } from "../lib/nerida";
import { createPortal } from "react-dom";
import { Check, CornerDownLeft, Replace, RotateCcw, Sparkles, SpellCheck, Square, Wand2, X } from "lucide-react";
import { BetaPill, NeridaMark } from "./NeridaOrb";
import { NERIDA_EDIT, fixSpelling, isShort, runContinue, runEdit, stopEdit, synonyms, type EditAction, type NeridaEditDetail } from "../lib/neridaEdit";

/** Nerida's selection popup: pick Improve / Fix grammar / your own instruction, preview, then Replace or Insert below. */
export function NeridaEditUI() {
  const [pop, setPop] = useState<NeridaEditDetail | null>(null);
  const [custom, setCustom] = useState("");
  const [out, setOut] = useState("");
  const [phase, setPhase] = useState<"pick" | "run" | "done" | "syn">("pick");
  const [syn, setSyn] = useState<string[]>([]);
  const [last, setLast] = useState<EditAction>("improve");
  const [err, setErr] = useState("");

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<NeridaEditDetail>).detail;
      setPop(d);
      nerida.set({ think: null }); // no thinking left over from an earlier chat
      setPhase(d.continue ? "run" : "pick");
      setOut("");
      setErr("");
      setCustom("");
      if (d.continue)
        runContinue(d.text, setOut)
          .then((r) => (setOut(r), setPhase("done")))
          .catch((e) => (setErr(String(e).replace(/^Error: /, "")), setPhase("done")));
    };
    window.addEventListener(NERIDA_EDIT, open);
    return () => window.removeEventListener(NERIDA_EDIT, open);
  }, []);

  if (!pop) return null;
  const close = () => (phase === "run" && stopEdit(), setPop(null));
  const go = async (action: EditAction) => {
    if (action === "custom" && !custom.trim()) return;
    setLast(action);
    setPhase("run");
    setOut("");
    setErr("");
    try {
      const r = await runEdit(action, pop.text, custom, setOut);
      setOut(r);
      setPhase("done");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
      setPhase("pick");
    }
  };
  // Short selections: spelling comes from the offline spellchecker (instant), synonyms from the model.
  const spell = () => {
    const r = fixSpelling(pop.text);
    if (r === pop.text) return setErr("No spelling mistakes found.");
    setOut(r);
    setPhase("done");
  };
  const findSyn = async () => {
    setPhase("run");
    setOut("");
    setErr("");
    try {
      const list = await synonyms(pop.text);
      if (!list.length) throw new Error("Nerida couldn't find synonyms. Try again.");
      setSyn(list);
      setPhase("syn");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
      setPhase("pick");
    }
  };
  const short = !pop.continue && isShort(pop.text);
  const apply = (fn: (t: string) => void) => (fn(out), setPop(null));
  const btn = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-200 hover:bg-white/[0.07]";
  const act = "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] hover:bg-white/[0.08]";

  return createPortal(
    <>
      <div className="fixed inset-0 z-[85]" onMouseDown={close} />
      <div
        className="oc-docs-pop fixed z-[86] w-80 overflow-hidden rounded-xl border border-white/[0.1] bg-[var(--oc-surface)] shadow-[0_14px_36px_rgba(0,0,0,0.5)]"
        style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - 330)), top: Math.max(8, Math.min(pop.y, window.innerHeight - 340)) }}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <NeridaMark size={15} />
          <span className="flex-1 text-[12.5px] text-neutral-400">{pop.continue ? "Continue writing" : "Edit with Nerida"}<BetaPill /></span>
          <button type="button" onClick={close} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
        </div>

        {phase === "pick" ? (
          <div className="p-1">
            {short ? (
              <>
                <button type="button" className={btn} onClick={spell}><SpellCheck className="size-4 text-emerald-300" /> Fix spelling</button>
                <button type="button" className={btn} onClick={findSyn}><Replace className="size-4 text-sky-300" /> Synonyms</button>
              </>
            ) : (
              <>
                <button type="button" className={btn} onClick={() => go("improve")}><Wand2 className="size-4 text-sky-300" /> Improve writing</button>
                <button type="button" className={btn} onClick={() => go("grammar")}><SpellCheck className="size-4 text-emerald-300" /> Fix grammar</button>
              </>
            )}
            <form className="flex items-center gap-1 px-1 pt-1" onSubmit={(e) => (e.preventDefault(), void go("custom"))}>
              <Sparkles className="ml-1 size-4 shrink-0 text-amber-300" />
              <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or tell Nerida what to do…" data-no-spell
                className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 py-1.5 text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
              <button type="submit" disabled={!custom.trim()} className="cursor-pointer rounded-md p-1.5 text-neutral-300 hover:bg-white/[0.08] disabled:opacity-40"><CornerDownLeft className="size-3.5" /></button>
            </form>
            {err && <p className="px-2 pt-2 pb-1 text-[12px] text-red-300">{err}</p>}
          </div>
        ) : phase === "syn" ? (
          <div className="p-1">
            <p className="px-2 pt-1 pb-1.5 text-[12px] text-neutral-500">Pick one to replace “{pop.text.trim()}”</p>
            {syn.map((w) => (
              <button key={w} type="button" className={btn} onClick={() => (pop.replace(w), setPop(null))}>{w}</button>
            ))}
            <button type="button" className={`${btn} text-neutral-400`} onClick={findSyn}><RotateCcw className="size-3.5" /> More</button>
          </div>
        ) : (
          <div className="p-2">
            <ThinkingStatus />
            <div className="max-h-56 overflow-auto rounded-lg bg-white/[0.04] px-2.5 py-2 text-[13px] whitespace-pre-wrap text-neutral-100">
              {err && pop.continue && <span className="text-red-300">{err}</span>}
              {out || err || <span className="text-neutral-500">{short ? "Thinking…" : "Writing…"}</span>}
            </div>
            <div className="mt-2 flex items-center gap-1">
              {phase === "run" ? (
                <button type="button" className={`${act} text-neutral-300`} onClick={stopEdit}><Square className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} /> Stop</button>
              ) : (
                <>
                  <button type="button" disabled={!out} className={`${act} bg-sky-500/20 text-sky-200 disabled:opacity-40`} onClick={() => apply(pop.replace)}><Check className="size-3.5" /> {pop.continue ? "Insert" : "Replace"}</button>
                  {pop.insertBelow && <button type="button" disabled={!out} className={`${act} text-neutral-300 disabled:opacity-40`} onClick={() => apply(pop.insertBelow!)}>Insert below</button>}
                  <span className="flex-1" />
                  {!short && <button type="button" title="Try again" className={`${act} text-neutral-400`} onClick={() => (pop.continue ? window.dispatchEvent(new CustomEvent(NERIDA_EDIT, { detail: pop })) : go(last))}><RotateCcw className="size-3.5" /></button>}
                  <button type="button" className={`${act} text-neutral-400`} onClick={() => setPop(null)}>Discard</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
