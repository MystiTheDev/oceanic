import { useEffect, useState } from "react";
import { BookOpenCheck, Download, Layers, MessageSquareText, ShieldCheck } from "lucide-react";
import { MODEL_NAMES, type ModelId } from "../lib/nerida";
import { Modal } from "./Modal";
import { NeridaMark } from "./NeridaOrb";


const FEATURES = [
  { icon: MessageSquareText, text: "Ask questions and get answers from your own notes" },
  { icon: Layers, text: "Turn notes into flashcards and quizzes" },
  { icon: BookOpenCheck, text: "Summarize, explain and rewrite in one click" },
];

/** Looping mini demo: a question, Nerida thinking, then generated flashcards. */
function Preview() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="h-[150px] rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[12px]">
      <div className="oc-fade-in flex justify-end"><span className="rounded-2xl rounded-br-md bg-white/[0.08] px-2.5 py-1 text-neutral-200">Make flashcards from my Biology notes</span></div>
      {step >= 1 && (
        <div className="oc-fade-in mt-2 flex items-center gap-1.5">
          <NeridaMark busy={step === 1} size={14} />
          {step === 1 ? <span className="oc-nerida-shimmer">Reading Biology…</span> : <span className="text-neutral-400">Created 3 flashcards</span>}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        {["What is ATP?", "Role of mitochondria?", "Define osmosis"].map((q, i) =>
          step >= i + 2 ? <span key={q} className="oc-pop-in rounded-lg border border-teal-300/20 bg-teal-300/[0.06] px-2 py-1.5 text-neutral-200">{q}</span> : null,
        )}
      </div>
    </div>
  );
}

export function NeridaIntro({ onDownload, onLater }: { onDownload: (m: ModelId) => void; onLater: () => void }) {
  const model: ModelId = "plus";
  return (
    <Modal onClose={onLater} className="w-[480px]">
      <div className="p-6">
        <div className="mx-auto mb-3 grid place-items-center"><NeridaMark size={64} busy /></div>
        <h2 className="text-center text-[19px] font-semibold text-neutral-50">Meet Nerida, your free AI study partner</h2>
        <p className="mx-auto mt-1.5 max-w-[380px] text-center text-[13px] text-neutral-400">
          Get answers from your notes, create flashcards and quizzes, and work faster, all privately on your device.
        </p>

        <div className="mt-4"><Preview /></div>

        <ul className="mt-4 space-y-2">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-[13px] text-neutral-300"><Icon className="size-4 shrink-0 text-teal-300" />{text}</li>
          ))}
        </ul>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-neutral-500">
          <ShieldCheck className="size-3.5" /> Free forever. Runs on your PC, so your notes never leave it.
        </p>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onLater} className="flex-1 cursor-pointer rounded-lg px-3 py-2 text-[13px] text-neutral-400 hover:bg-white/[0.05]">Maybe later</button>
          <button type="button" onClick={() => onDownload(model)}
            className="flex flex-[2] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-teal-400/90 px-3 py-2 text-[13px] font-medium text-neutral-950 hover:bg-teal-300">
            <Download className="size-4" /> Download {MODEL_NAMES[model]} (~1.3 GB)
          </button>
        </div>
      </div>
    </Modal>
  );
}
