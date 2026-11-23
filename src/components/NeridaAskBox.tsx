import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, X } from "lucide-react";

/* Nerida's question box: a glass card docked above the chat input, one question per page.
 * Tab chips jump between questions; 1-9 pick an option, Enter goes on, Esc cancels.
 * Reused by the study-plan wizard and Nerida's note actions. */

/** Square-ish corners. Inline, so the chat composer's pill-button rule (index.css) doesn't round them. */
const SQ = { borderRadius: 6 } as const;

export type AskOption = { label: string; description?: string; recommended?: boolean; /** Shown beside the options while this one is picked. */ preview?: ReactNode };
export type AskQuestion = {
  id: string;
  /** Short chip text, e.g. "Hours". */
  header: string;
  question: string;
  options: AskOption[];
  multi?: boolean;
  /** Free-text "Other" row (default on). */
  other?: boolean;
  otherPlaceholder?: string;
  /** Default used when skipped. */
  skipTo?: string[];
};
/** Answers by question id: picked labels, plus the "Other" text as its own entry. */
export type AskAnswers = Record<string, string[]>;

export function NeridaAskBox({ title, questions, onDone, onCancel, busy }: { title: string; questions: AskQuestion[]; onDone: (a: AskAnswers) => void; onCancel: () => void; busy?: string }) {
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<AskAnswers>(() => Object.fromEntries(questions.map((q) => [q.id, q.options.filter((o) => o.recommended && !q.multi).map((o) => o.label)])));
  const [other, setOther] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const otherRef = useRef<HTMLInputElement>(null);
  const q = questions[page];
  const last = page === questions.length - 1;
  const answer = (id: string) => [...(picked[id] ?? []), ...(other[id]?.trim() ? [other[id].trim()] : [])];
  const ready = (id: string) => skipped.has(id) || answer(id).length > 0;

  const finish = () =>
    onDone(Object.fromEntries(questions.map((x) => [x.id, skipped.has(x.id) && !answer(x.id).length ? x.skipTo ?? x.options.filter((o) => o.recommended).map((o) => o.label) : answer(x.id)])));
  const next = () => (last ? finish() : setPage(page + 1));
  const toggle = (label: string) => {
    setSkipped((s) => (s.delete(q.id), new Set(s)));
    setPicked((p) => {
      const cur = p[q.id] ?? [];
      return { ...p, [q.id]: q.multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    });
    if (!q.multi) setOther((o) => ({ ...o, [q.id]: "" }));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") return onCancel();
      if (document.activeElement === otherRef.current) {
        if (e.key === "Enter" && ready(q.id)) (e.preventDefault(), next());
        return;
      }
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) (e.preventDefault(), toggle(q.options[n - 1].label));
      else if (e.key === "Enter" && ready(q.id)) (e.preventDefault(), next());
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const preview = q.options.find((o) => (picked[q.id] ?? []).includes(o.label) && o.preview)?.preview;
  return (
    <div className="oc-ask-box mx-2 mb-2 overflow-hidden rounded-2xl border border-white/[0.09] bg-[rgba(24,26,32,0.72)] shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="rounded-full bg-[color:var(--oc-brand)]/20 px-2 py-0.5 text-[11px] font-medium text-[color:var(--oc-brand-light)]">{title}</span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {questions.map((x, i) => (
            <button key={x.id} type="button" onClick={() => setPage(i)}
              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${i === page ? "bg-white/[0.1] text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>
              {ready(x.id) && i !== page && <Check className="size-3" />}
              {x.header}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[11px] text-neutral-500">{page + 1} of {questions.length}</span>
        <button type="button" onClick={onCancel} title="Cancel (Esc)" className="cursor-pointer rounded p-0.5 text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
      </div>

      {busy ? (
        <div className="px-4 py-5 text-[13px] text-neutral-300">{busy}</div>
      ) : (
        <div className="flex gap-3 px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 px-1 text-[13.5px] font-medium text-neutral-100">{q.question}{q.multi && <span className="ml-1.5 text-[11px] font-normal text-neutral-500">pick any</span>}</div>
            <div className="flex flex-col gap-0.5">
              {q.options.map((o, i) => {
                const on = (picked[q.id] ?? []).includes(o.label);
                return (
                  <button key={o.label} type="button" style={SQ} onClick={() => toggle(o.label)}
                    className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-left ${on ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}>
                    <span className={`mt-0.5 grid size-4 shrink-0 place-items-center border ${q.multi ? "rounded" : "rounded-full"} ${on ? "border-[color:var(--oc-brand)] bg-[color:var(--oc-brand)]" : "border-white/25"}`}>
                      {on && <Check className="size-3 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[13px] text-neutral-100">{o.label}</span>
                      {o.recommended && <span className="ml-1.5 rounded bg-emerald-400/15 px-1 py-px text-[10px] text-emerald-300">Recommended</span>}
                      {o.description && <span className="block text-[11.5px] leading-snug text-neutral-500">{o.description}</span>}
                    </span>
                    <span className="mt-0.5 text-[10.5px] text-neutral-600">{i + 1}</span>
                  </button>
                );
              })}
              {q.other !== false && (
                <label style={SQ} className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-white/[0.04]">
                  <span className="text-[13px] text-neutral-400">Other:</span>
                  <input ref={otherRef} value={other[q.id] ?? ""} placeholder={q.otherPlaceholder ?? "Type your own answer"}
                    onChange={(e) => (setOther((o) => ({ ...o, [q.id]: e.target.value })), !q.multi && e.target.value && setPicked((p) => ({ ...p, [q.id]: [] })))}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-100 outline-none placeholder:text-neutral-600" />
                </label>
              )}
            </div>
          </div>
          {preview && <div className="hidden w-[42%] shrink-0 rounded-xl border border-white/[0.06] bg-black/20 p-2.5 text-[11.5px] text-neutral-300 min-[520px]:block">{preview}</div>}
        </div>
      )}

      {!busy && (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          {page > 0 && (
            <button type="button" style={SQ} onClick={() => setPage(page - 1)} className="flex cursor-pointer items-center gap-0.5 rounded-lg px-2 py-1 text-[12px] text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200">
              <ChevronLeft className="size-3.5" /> Back
            </button>
          )}
          <span className="flex-1" />
          <button type="button" style={SQ} onClick={() => (setSkipped((s) => new Set(s).add(q.id)), next())} className="cursor-pointer rounded-lg px-2 py-1 text-[12px] text-neutral-500 hover:text-neutral-300">Skip</button>
          <button type="button" style={SQ} disabled={!ready(q.id)} onClick={next}
            className="cursor-pointer rounded-lg bg-[color:var(--oc-brand)] px-3 py-1 text-[12px] font-medium text-white disabled:cursor-default disabled:opacity-40">
            {last ? "Done" : "Next"} <span className="opacity-60">⏎</span>
          </button>
        </div>
      )}
    </div>
  );
}
