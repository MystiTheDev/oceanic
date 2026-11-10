import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Square, X } from "lucide-react";
import { BetaPill, NeridaMark } from "./NeridaOrb";
import { runOutline, stopEdit, type EssayType } from "../lib/neridaEdit";

/** Outline generator (Docs + Notes): your topic, type, length and own ideas first, then a preview to insert. */
export const NERIDA_OUTLINE = "oc-nerida-outline";
export type OutlineDetail = { topic: string; insert: (markdown: string) => void };
export const openNeridaOutline = (d: OutlineDetail) => window.dispatchEvent(new CustomEvent(NERIDA_OUTLINE, { detail: d }));

const TYPES: [EssayType, string][] = [
  ["argumentative", "Argumentative"],
  ["explanatory", "Explanatory"],
  ["compare and contrast", "Compare & contrast"],
  ["narrative", "Narrative"],
  ["report", "Report"],
];

export function NeridaOutlineUI() {
  const [d, setD] = useState<OutlineDetail | null>(null);
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<EssayType>("argumentative");
  const [paragraphs, setParagraphs] = useState(3);
  const [points, setPoints] = useState("");
  const [out, setOut] = useState("");
  const [phase, setPhase] = useState<"ask" | "run" | "done">("ask");
  const [err, setErr] = useState("");

  useEffect(() => {
    const open = (e: Event) => {
      const det = (e as CustomEvent<OutlineDetail>).detail;
      setD(det);
      setTopic(det.topic);
      setPhase("ask");
      setOut("");
      setErr("");
    };
    window.addEventListener(NERIDA_OUTLINE, open);
    return () => window.removeEventListener(NERIDA_OUTLINE, open);
  }, []);
  if (!d) return null;

  const close = () => (phase === "run" && stopEdit(), setD(null));
  const go = async () => {
    if (!topic.trim()) return;
    setPhase("run");
    setOut("");
    setErr("");
    try {
      setOut(await runOutline({ topic, type, paragraphs, points }, setOut));
      setPhase("done");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
      setPhase("ask");
    }
  };
  const field = "w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[13px] text-neutral-100 outline-none focus:border-sky-400/50";
  const chip = (on: boolean) => `cursor-pointer rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-sky-400/50 bg-sky-500/20 text-sky-100" : "border-white/[0.08] text-neutral-300 hover:bg-white/[0.06]"}`;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50" onMouseDown={close}>
      <div className="w-[440px] max-w-[calc(100vw-32px)] rounded-2xl border border-white/[0.1] bg-[var(--oc-surface)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.55)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <NeridaMark size={18} />
          <span className="flex-1 text-[14px] font-medium text-neutral-100">Outline with Nerida<BetaPill /></span>
          <button type="button" onClick={close} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-4" /></button>
        </div>

        {phase === "ask" ? (
          <form onSubmit={(e) => (e.preventDefault(), void go())} className="space-y-3">
            <label className="block text-[12px] text-neutral-400">Topic or essay question
              <input autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Should homework be banned?" className={`${field} mt-1`} />
            </label>
            <div className="text-[12px] text-neutral-400">Essay type
              <div className="mt-1 flex flex-wrap gap-1.5">{TYPES.map(([v, l]) => <button key={v} type="button" className={chip(type === v)} onClick={() => setType(v)}>{l}</button>)}</div>
            </div>
            <div className="text-[12px] text-neutral-400">Body paragraphs
              <div className="mt-1 flex gap-1.5">{[3, 4, 5].map((n) => <button key={n} type="button" className={chip(paragraphs === n)} onClick={() => setParagraphs(n)}>{n}</button>)}</div>
            </div>
            <label className="block text-[12px] text-neutral-400">Your own points (optional)
              <textarea value={points} onChange={(e) => setPoints(e.target.value)} rows={3} placeholder="Ideas you already have; Nerida builds the outline around them" className={`${field} mt-1 resize-none`} />
            </label>
            {err && <p className="text-[12px] text-red-300">{err}</p>}
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={close} className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Cancel</button>
              <button type="submit" disabled={!topic.trim()} className="cursor-pointer rounded-md bg-sky-500/25 px-3 py-1.5 text-[12.5px] text-sky-100 hover:bg-sky-500/35 disabled:opacity-40">Write outline</button>
            </div>
          </form>
        ) : (
          <>
            <div className="scrollbar-thin max-h-[50vh] overflow-auto rounded-lg bg-white/[0.04] px-3 py-2 text-[13px] whitespace-pre-wrap text-neutral-100">
              {out || <span className="text-neutral-500">Writing outline…</span>}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {phase === "run" ? (
                <button type="button" onClick={stopEdit} className="flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]"><Square className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} /> Stop</button>
              ) : (
                <>
                  <button type="button" onClick={() => setPhase("ask")} className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Back</button>
                  <button type="button" title="Try again" onClick={() => void go()} className="cursor-pointer rounded-md p-1.5 text-neutral-400 hover:bg-white/[0.06]"><RotateCcw className="size-3.5" /></button>
                  <span className="flex-1" />
                  <button type="button" disabled={!out} onClick={() => (d.insert(out), setD(null))} className="cursor-pointer rounded-md bg-sky-500/25 px-3 py-1.5 text-[12.5px] text-sky-100 hover:bg-sky-500/35 disabled:opacity-40">Insert</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
