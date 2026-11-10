import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { PageMeta } from "../data/workspace";
import { clock, EXAM } from "../lib/study";
import { dueCards, getSrs, grade, GRADES, previewLabel, type Grade } from "../lib/srs";
import { Modal } from "./Modal";

const TONES = ["#f87171", "#fbbf24", "#34d399", "#60a5fa"]; // Again, Hard, Good, Easy

/** Card text: `**bold**`, `*italic*`, `` `code` `` and `$math$`. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*.+?\*|`.+?`|\$.+?\$)/).map((t, i) =>
        !(i % 2) ? t
        : t.startsWith("***") ? <b key={i}><i>{t.slice(3, -3)}</i></b>
        : t.startsWith("**") ? <b key={i}>{t.slice(2, -2)}</b>
        : t[0] === "*" ? <i key={i}>{t.slice(1, -1)}</i>
        : t[0] === "`" ? <code key={i} className="rounded bg-white/[0.08] px-1 text-[0.9em]">{t.slice(1, -1)}</code>
        : <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(t.slice(1, -1), { throwOnError: false }) }} />,
      )}
    </>
  );
}

/** Flashcard review: question → Space flips to the answer → 1–4 grades it. */
/** `practice`: every card, shuffled, without touching the review schedule. */
export function ReviewModal({ pages, pageId, practice, onClose }: { pages: PageMeta[]; pageId?: string; practice?: boolean; onClose: () => void }) {
  // Fixed queue for this session; "Again" cards go back to the end.
  const [queue, setQueue] = useState(() =>
    practice
      ? Object.values(getSrs().cards).filter((c) => !pageId || c.pageId === pageId).sort(() => Math.random() - 0.5)
      : dueCards(getSrs().cards, pageId),
  );
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [tally, setTally] = useState([0, 0, 0, 0]); // grades pressed, for the summary
  const started = useRef(Date.now());
  const total = useMemo(() => queue.length, []); // eslint-disable-line react-hooks/exhaustive-deps
  const card = queue[0];
  const page = card && pages.find((p) => p.id === card.pageId);
  const exam = page?.tags?.includes(EXAM) ? page.dueDate ?? undefined : undefined;

  const answer = (g: Grade) => {
    if (!card) return;
    if (!practice) grade(card, g, exam);
    setShown(false);
    setTally((t) => t.map((n, i) => n + +(i === g - 1)));
    if (g === 1) setQueue(([c, ...rest]) => [...rest, getSrs().cards[c.id] ?? c]);
    else (setQueue(([, ...rest]) => rest), setDone((n) => n + 1));
  };
  const openInNote = () => {
    window.dispatchEvent(new CustomEvent("oc-open-block", { detail: { pageId: card.pageId, blockId: card.blockId } }));
    onClose();
  };

  useEffect(() => {
    // Capture phase + preventDefault so keys never reach the editor behind the modal.
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.key === " " || e.key === "Enter") (e.preventDefault(), e.stopPropagation(), setShown(true));
      else if (["1", "2", "3", "4"].includes(e.key)) (e.preventDefault(), e.stopPropagation(), shown && answer(Number(e.key) as Grade));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => (document.activeElement as HTMLElement | null)?.blur(), []);

  const graded = tally.reduce((a, b) => a + b, 0);
  const face = "flex min-h-[220px] flex-col items-center justify-center whitespace-pre-wrap px-6 py-8 text-center text-[18px] text-neutral-100 [backface-visibility:hidden] [grid-area:1/1]";
  return (
    <Modal onClose={onClose} className="w-[560px]">
      <div className="flex items-center justify-between px-5 py-3 text-[12px] text-neutral-500">
        <span className="truncate">{page?.title || (card ? "Untitled" : "Flashcards")}{practice && " · practice"}</span>
        <span className="tabular-nums">{Math.min(done + 1, total)} / {total}</span>
      </div>
      <div className="h-0.5 bg-white/[0.06]">
        <div className="h-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      {!card ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[15px] font-medium text-neutral-100">{total ? (practice ? "Round finished 🎉" : "All done for today 🎉") : "No cards due"}</p>
          {graded ? (
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[[done, "reviewed"], [`${Math.round(((graded - tally[0]) / graded) * 100)}%`, "correct"], [clock(Math.round((Date.now() - started.current) / 1000)), "time"]].map(([v, l]) => (
                <div key={l} className="rounded-xl bg-white/[0.04] py-3">
                  <p className="text-[20px] font-bold tabular-nums text-neutral-100">{v}</p>
                  <p className="text-[11px] text-neutral-500">{l}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-neutral-500">Write <code>Question :: Answer</code> in a bullet to make a card.</p>
          )}
        </div>
      ) : (
        <>
          {/* 3D flip: both faces share one grid cell; the back starts turned away. Keyed so a new card doesn't flip back. */}
          <div className="[perspective:1200px]">
            <div key={`${card.id}-${graded}`} className={`grid transition-transform duration-500 [transform-style:preserve-3d] ${shown ? "[transform:rotateY(180deg)]" : ""}`}>
              <div className={face}><Rich text={card.q} /></div>
              <div className={`${face} [transform:rotateY(180deg)]`}>
                <p className="mb-4 text-[13px] text-neutral-500"><Rich text={card.q} /></p>
                <p className="text-neutral-200">
                  {card.cloze
                    ? // Odd parts are the {{…}} words; bold the one this card hides.
                      card.cloze.split(/\{\{(.+?)\}\}/).map((part, i) =>
                        i % 2 && (i - 1) / 2 === Number(card.id.split("#")[1]) ? <b key={i} className="text-[var(--oc-accent,#34d399)]"><Rich text={part} /></b> : <Rich key={i} text={part} />,
                      )
                    : <Rich text={card.a} />}
                </p>
                <button type="button" onClick={openInNote} className="mt-5 cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-300">Open in note ↗</button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 border-t border-white/[0.06] p-3">
            {shown ? (
              GRADES.map(({ g, label }) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => answer(g)}
                  className="flex-1 cursor-pointer rounded-lg py-2 text-[13px] font-medium transition-[filter] hover:brightness-125"
                  style={{ color: TONES[g - 1], background: `color-mix(in srgb, ${TONES[g - 1]} 14%, transparent)` }}
                >
                  {label} {!practice && <span className="opacity-60">{previewLabel(card, g, exam)}</span>}
                  <span className="block text-[10px] opacity-50">{g}</span>
                </button>
              ))
            ) : (
              <button type="button" onClick={() => setShown(true)} className="flex-1 cursor-pointer rounded-lg bg-white/[0.05] py-2.5 text-[13px] text-neutral-200 hover:bg-white/[0.1]">
                Show answer <span className="text-neutral-600">Space</span>
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
