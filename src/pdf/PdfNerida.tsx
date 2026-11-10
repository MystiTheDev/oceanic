import { useState } from "react";
import { Square, X } from "lucide-react";
import { BetaPill, NeridaMark } from "../components/NeridaOrb";
import { Markdown } from "../components/NeridaPanel";
import { stopEdit } from "../lib/neridaEdit";
import { neridaNote, summarizePdf } from "../lib/neridaPdf";

/** Summarize PDF: page range + Short/Detailed, preview, then save as a new note. */
export function PdfSummaryDialog({ docId, name, pageCount, onClose }: { docId: string; name: string; pageCount: number; onClose: () => void }) {
  const [all, setAll] = useState(true);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(pageCount);
  const [detailed, setDetailed] = useState(false);
  const [phase, setPhase] = useState<"ask" | "run" | "done">("ask");
  const [label, setLabel] = useState("");
  const [out, setOut] = useState("");
  const [err, setErr] = useState("");
  const range = all ? [1, pageCount] : [Math.max(1, Math.min(from, to)), Math.min(pageCount, Math.max(from, to))];
  const title = `${name.replace(/\.pdf$/i, "")} summary${all ? "" : ` (pp. ${range[0]}–${range[1]})`}`;

  const go = async () => {
    setPhase("run");
    setErr("");
    setOut("");
    try {
      setOut(await summarizePdf(docId, range[0], range[1], detailed, (l, t) => (setLabel(l), setOut(t))));
      setPhase("done");
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
      setPhase("ask");
    }
  };
  const save = async () => {
    onClose();
    await neridaNote(title, `Summary of **${name}**, pages ${range[0]}–${range[1]}.\n\n${out}`, false, true);
  };
  const close = () => (phase === "run" && stopEdit(), onClose());
  const chip = (on: boolean) => `cursor-pointer rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-sky-400/50 bg-sky-500/20 text-sky-100" : "border-white/[0.08] text-neutral-300 hover:bg-white/[0.06]"}`;
  const num = "w-16 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[13px] text-neutral-100 outline-none";

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50" onMouseDown={close}>
      <div className="w-[480px] max-w-[calc(100vw-32px)] rounded-2xl border border-white/[0.1] bg-[var(--oc-surface)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.55)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <NeridaMark size={18} busy={phase === "run"} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-neutral-100">Summarize {name}<BetaPill /></span>
          <button type="button" onClick={close} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-4" /></button>
        </div>
        {phase === "ask" ? (
          <div className="space-y-3 text-[12px] text-neutral-400">
            <div>Pages
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <button type="button" className={chip(all)} onClick={() => setAll(true)}>All {pageCount}</button>
                <button type="button" className={chip(!all)} onClick={() => setAll(false)}>Range</button>
                {!all && (
                  <>
                    <input type="number" min={1} max={pageCount} value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} className={num} />
                    <span>to</span>
                    <input type="number" min={1} max={pageCount} value={to} onChange={(e) => setTo(Number(e.target.value) || 1)} className={num} />
                  </>
                )}
              </div>
            </div>
            <div>Length
              <div className="mt-1 flex gap-1.5">
                <button type="button" className={chip(!detailed)} onClick={() => setDetailed(false)}>Short</button>
                <button type="button" className={chip(detailed)} onClick={() => setDetailed(true)}>Detailed (by section)</button>
              </div>
            </div>
            {range[1] - range[0] > 40 && <p className="text-amber-300/90">Long PDFs take a while on local models (about one part per 3–4 pages).</p>}
            {err && <p className="text-red-300">{err}</p>}
            <div className="flex justify-end gap-1.5 pt-1">
              <button type="button" onClick={close} className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Cancel</button>
              <button type="button" onClick={() => void go()} className="cursor-pointer rounded-md bg-sky-500/25 px-3 py-1.5 text-[12.5px] text-sky-100 hover:bg-sky-500/35">Summarize</button>
            </div>
          </div>
        ) : (
          <>
            {phase === "run" && <p className="oc-nerida-shimmer mb-2 text-[12.5px]">{label || "Starting"}…</p>}
            <div className="scrollbar-thin max-h-[50vh] overflow-auto rounded-lg bg-white/[0.04] px-3 py-2 text-[13px]">
              {out ? <Markdown text={out} /> : <span className="text-neutral-500">Reading…</span>}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {phase === "run" ? (
                <button type="button" onClick={stopEdit} className="flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]"><Square className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} /> Stop</button>
              ) : (
                <>
                  <button type="button" onClick={() => setPhase("ask")} className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Back</button>
                  <span className="flex-1" />
                  <button type="button" disabled={!out} onClick={() => void save()} className="cursor-pointer rounded-md bg-sky-500/25 px-3 py-1.5 text-[12.5px] text-sky-100 hover:bg-sky-500/35 disabled:opacity-40">Save as note</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
