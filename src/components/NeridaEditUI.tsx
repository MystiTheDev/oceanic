import { useEffect, useState } from "react";
import { ThinkingStatus } from "./NeridaEffort";
import { nerida } from "../lib/nerida";
import { createPortal } from "react-dom";
import {
  ArrowRightToLine, ChevronLeft, ChevronRight, CornerDownLeft, Languages, Maximize2, Minimize2, Mic2, PenLine, Replace, RotateCcw, Sparkles, SpellCheck, Square, Wand2, X, Feather,
} from "lucide-react";
import { NeridaMark } from "./NeridaOrb";
import {
  LANGUAGES, NERIDA_EDIT, TONES, fixSpelling, isShort, runContinue, runEdit, runPrompt, stopEdit, synonyms, warnMode, type EditAction, type NeridaEditDetail,
} from "../lib/neridaEdit";
import { useEscape } from "../lib/overlay";
import { editWarning } from "../lib/neridaGuard";
import { DiffCard, confirmCloud } from "./NeridaDiff";

type Phase = "pick" | "tone" | "lang" | "run" | "done" | "syn";
/** What produced the result: an edit of the selection (shown as a diff) or new text to insert. */
type Kind = { edit: EditAction; arg: string } | { write: "continue" | "prompt"; arg: string };

/** Nerida's AI menu for selected text (and `/ai`): pick an action, preview the word diff, then Accept or Reject.
 *  Accepting goes through the editor's own commands, so normal undo reverts it. */
export function NeridaEditUI() {
  const [pop, setPop] = useState<NeridaEditDetail | null>(null);
  const [custom, setCustom] = useState("");
  const [lang, setLang] = useState("");
  const [out, setOut] = useState("");
  const [phase, setPhase] = useState<Phase>("pick");
  const [syn, setSyn] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>({ edit: "improve", arg: "" });
  const [err, setErr] = useState("");

  const run = async (k: Kind, d: NeridaEditDetail) => {
    if (!(await confirmCloud())) return;
    setKind(k);
    setPhase("run");
    setOut("");
    setErr("");
    try {
      const r = "edit" in k ? await runEdit(k.edit, d.text, k.arg, setOut)
        : k.write === "continue" ? await runContinue(d.text, setOut)
        : await runPrompt(k.arg, d.text, setOut);
      setOut(r);
      setPhase("done");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
      setPhase(d.continue ? "done" : "pick");
    }
  };

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<NeridaEditDetail>).detail;
      setPop(d);
      nerida.set({ think: null }); // no thinking left over from an earlier chat
      setPhase("pick");
      setOut("");
      setErr("");
      setCustom("");
      setLang("");
      if (d.continue) void run({ write: "continue", arg: "" }, d);
    };
    window.addEventListener(NERIDA_EDIT, open);
    return () => window.removeEventListener(NERIDA_EDIT, open);
  }, []);

  useEscape(() => (phase === "run" && stopEdit(), setPop(null)), !!pop);
  if (!pop) return null;
  const close = () => (phase === "run" && stopEdit(), setPop(null));
  const go = (action: EditAction, arg = "") => {
    if ((action === "custom" || action === "translate") && !arg.trim()) return;
    void run({ edit: action, arg }, pop);
  };
  // Short selections: spelling comes from the offline spellchecker (instant), synonyms from the model.
  const spell = () => {
    const r = fixSpelling(pop.text);
    if (r === pop.text) return setErr("No spelling mistakes found.");
    setKind({ edit: "grammar", arg: "" });
    setOut(r);
    setPhase("done");
  };
  const findSyn = async () => {
    if (!(await confirmCloud())) return;
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
  const writing = pop.prompt || pop.continue;
  const short = !writing && isShort(pop.text);
  const isEdit = "edit" in kind;
  // Steered or off-task results: flagged, but Accept still works.
  const warn = phase === "done" && out && !short ? editWarning(isEdit ? pop.text : "", out, isEdit ? warnMode(kind.edit) : "free") : "";
  const apply = (fn: (t: string) => void) => (fn(out), setPop(null));
  const retry = () => void run(kind, pop);
  // Continue from a selection: the new paragraph goes below it.
  const insertTarget = isEdit || pop.prompt || pop.continue ? pop.replace : pop.insertBelow ?? pop.replace;
  const btn = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-200 hover:bg-white/[0.07]";
  const act = "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] hover:bg-white/[0.08] disabled:opacity-40";
  const title = pop.continue ? "Continue writing" : pop.prompt ? "Ask Nerida to write" : "Edit with Nerida";

  const back = (
    <button type="button" className={`${btn} text-neutral-400`} onClick={() => setPhase("pick")}><ChevronLeft className="size-4" /> Back</button>
  );
  const customBox = (
    <form className="flex items-center gap-1 px-1 pt-1" onSubmit={(e) => (e.preventDefault(), pop.prompt ? custom.trim() && void run({ write: "prompt", arg: custom }, pop) : go("custom", custom))}>
      <Sparkles className="ml-1 size-4 shrink-0 text-amber-300" />
      <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={pop.prompt ? "Tell Nerida what to write…" : "Or tell Nerida what to do…"} data-no-spell
        className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 py-1.5 text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
      <button type="submit" aria-label="Send" disabled={!custom.trim()} className="cursor-pointer rounded-md p-1.5 text-neutral-300 hover:bg-white/[0.08] disabled:opacity-40"><CornerDownLeft className="size-3.5" /></button>
    </form>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[85]" onMouseDown={close} />
      <div
        role="dialog"
        aria-label={title}
        className="oc-docs-pop fixed z-[86] w-80 overflow-hidden rounded-xl border border-white/[0.1] bg-[var(--oc-surface)] shadow-[0_14px_36px_rgba(0,0,0,0.5)]"
        style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - 330)), top: Math.max(8, Math.min(pop.y, window.innerHeight - 420)) }}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <NeridaMark size={15} />
          <span className="flex-1 text-[12.5px] text-neutral-400">{title}</span>
          <button type="button" aria-label="Close" onClick={close} className="cursor-pointer rounded text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
        </div>

        {phase === "pick" ? (
          <div className="p-1">
            {pop.prompt ? (
              pop.text.trim() && <button type="button" className={btn} onClick={() => void run({ write: "continue", arg: "" }, pop)}><ArrowRightToLine className="size-4 text-violet-300" /> Continue writing</button>
            ) : short ? (
              <>
                <button type="button" className={btn} onClick={spell}><SpellCheck className="size-4 text-emerald-300" /> Fix spelling</button>
                <button type="button" className={btn} onClick={findSyn}><Replace className="size-4 text-sky-300" /> Synonyms</button>
                <button type="button" className={btn} onClick={() => setPhase("lang")}><Languages className="size-4 text-teal-300" /> Translate <ChevronRight className="ml-auto size-3.5 text-neutral-500" /></button>
              </>
            ) : (
              <>
                <button type="button" className={btn} onClick={() => go("improve")}><Wand2 className="size-4 text-sky-300" /> Rewrite</button>
                <button type="button" className={btn} onClick={() => go("grammar")}><SpellCheck className="size-4 text-emerald-300" /> Fix grammar</button>
                <button type="button" className={btn} onClick={() => go("shorten")}><Minimize2 className="size-4 text-orange-300" /> Shorten</button>
                <button type="button" className={btn} onClick={() => go("expand")}><Maximize2 className="size-4 text-pink-300" /> Expand</button>
                <button type="button" className={btn} onClick={() => go("simplify")}><Feather className="size-4 text-lime-300" /> Simplify</button>
                <button type="button" className={btn} onClick={() => setPhase("tone")}><Mic2 className="size-4 text-amber-300" /> Change tone <ChevronRight className="ml-auto size-3.5 text-neutral-500" /></button>
                <button type="button" className={btn} onClick={() => setPhase("lang")}><Languages className="size-4 text-teal-300" /> Translate <ChevronRight className="ml-auto size-3.5 text-neutral-500" /></button>
                {pop.insertBelow && <button type="button" className={btn} onClick={() => void run({ write: "continue", arg: "" }, pop)}><PenLine className="size-4 text-violet-300" /> Continue writing</button>}
              </>
            )}
            {customBox}
            {err && <p className="px-2 pt-2 pb-1 text-[12px] text-red-300">{err}</p>}
          </div>
        ) : phase === "tone" ? (
          <div className="p-1">
            {back}
            {TONES.map((t) => <button key={t} type="button" className={btn} onClick={() => go("tone", t)}>{t}</button>)}
          </div>
        ) : phase === "lang" ? (
          <div className="p-1">
            {back}
            <div className="grid max-h-60 grid-cols-2 overflow-auto">
              {LANGUAGES.map((l) => <button key={l} type="button" className={btn} onClick={() => go("translate", l)}>{l}</button>)}
            </div>
            <form className="flex items-center gap-1 px-1 pt-1" onSubmit={(e) => (e.preventDefault(), go("translate", lang))}>
              <input autoFocus value={lang} onChange={(e) => setLang(e.target.value)} placeholder="Another language…" data-no-spell
                className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 py-1.5 text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
              <button type="submit" aria-label="Translate" disabled={!lang.trim()} className="cursor-pointer rounded-md p-1.5 text-neutral-300 hover:bg-white/[0.08] disabled:opacity-40"><CornerDownLeft className="size-3.5" /></button>
            </form>
          </div>
        ) : phase === "syn" ? (
          <div className="p-1">
            <p className="px-2 pt-1 pb-1.5 text-[12px] text-neutral-500">Pick one to replace “{pop.text.trim()}”</p>
            {syn.map((w) => (
              <button key={w} type="button" className={btn} onClick={() => (pop.replace(w), setPop(null))}>{w}</button>
            ))}
            <button type="button" className={`${btn} text-neutral-400`} onClick={findSyn}><RotateCcw className="size-3.5" /> More</button>
          </div>
        ) : phase === "done" && out && isEdit ? (
          <div className="p-2">
            <ThinkingStatus />
            <DiffCard before={pop.text} after={out} warning={warn} acceptLabel="Accept" onAccept={() => apply(pop.replace)} onReject={() => setPop(null)}
              extra={<>
                {pop.insertBelow && <button type="button" className={`${act} text-neutral-300`} onClick={() => apply(pop.insertBelow!)}>Insert below</button>}
                {!short && <button type="button" title="Try again" aria-label="Try again" className={`${act} text-neutral-400`} onClick={retry}><RotateCcw className="size-3.5" /></button>}
              </>} />
          </div>
        ) : (
          <div className="p-2">
            <ThinkingStatus />
            <div className="max-h-56 overflow-auto rounded-lg bg-white/[0.04] px-2.5 py-2 text-[13px] whitespace-pre-wrap text-neutral-100">
              {err && <span className="text-red-300">{err}</span>}
              {out || (!err && <span className="text-neutral-500">{short ? "Thinking…" : "Writing…"}</span>)}
            </div>
            {warn && <p className="mt-1.5 rounded-md bg-amber-400/10 px-2 py-1 text-[12px] text-amber-200">⚠️ {warn}</p>}
            <div className="mt-2 flex items-center gap-1">
              {phase === "run" ? (
                <button type="button" className={`${act} text-neutral-300`} onClick={stopEdit}><Square className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} /> Stop</button>
              ) : (
                <>
                  <button type="button" disabled={!out} className={`${act} bg-sky-500/20 text-sky-200`} onClick={() => apply(insertTarget)}><CornerDownLeft className="size-3.5" /> Insert</button>
                  <span className="flex-1" />
                  <button type="button" title="Try again" aria-label="Try again" className={`${act} text-neutral-400`} onClick={retry}><RotateCcw className="size-3.5" /></button>
                  <button type="button" className={`${act} text-neutral-400`} onClick={() => setPop(null)}><X className="size-3.5" /> Reject</button>
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
