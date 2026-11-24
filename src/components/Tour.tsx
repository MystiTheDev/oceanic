import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

/** Fired by Settings → About to replay the tour. */
export const TOUR_START = "oc-tour-start";
export const startTour = () => window.dispatchEvent(new Event(TOUR_START));

/** Each stop highlights the first element matching `target`; a missing target shows the card centred. */
const STOPS: { target: string; title: string; body: string }[] = [
  { target: '[data-tour="sidebar"]', title: "Sidebar and pages", body: "All your pages live here. Click + next to Pages (or press Ctrl+N) to make one. Drag pages to nest them." },
  { target: '[contenteditable="true"]', title: "Editor and slash menu", body: "Open a page and start typing. Press / for headings, lists, tables, images and more." },
  { target: '[data-tour="apps"]', title: "Mindmap and Sketch", body: "More apps opens Mindmap for mapping ideas, Sketch for drawing, and Docs for Word files." },
  { target: '[title^="Ask Nerida"]', title: "Nerida AI", body: "Press Ctrl+J to chat with Nerida about your notes. It can also make flashcards and quizzes from a page." },
];

export function Tour() {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const start = () => setI(0);
    window.addEventListener(TOUR_START, start);
    return () => window.removeEventListener(TOUR_START, start);
  }, []);

  useLayoutEffect(() => {
    if (i === null) return;
    const measure = () => setRect(document.querySelector(STOPS[i].target)?.getBoundingClientRect() ?? null);
    measure();
    // The target may mount a moment later (the tour opens a page first): keep measuring briefly.
    const id = setInterval(measure, 100);
    const stop = setTimeout(() => clearInterval(id), 1500);
    window.addEventListener("resize", measure);
    return () => (clearInterval(id), clearTimeout(stop), window.removeEventListener("resize", measure));
  }, [i]);

  useEffect(() => {
    if (i === null) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setI(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i]);

  if (i === null) return null;
  const stop = STOPS[i];
  const last = i === STOPS.length - 1;
  const pad = 6;
  // Card beside the target (right if room, else left), or centred when there is no target.
  const W = 300;
  const card = rect
    ? {
        left: rect.right + 16 + W < window.innerWidth ? rect.right + 16 : Math.max(16, rect.left - 16 - W),
        top: Math.min(Math.max(16, rect.top), window.innerHeight - 200),
      }
    : { left: (window.innerWidth - W) / 2, top: window.innerHeight / 2 - 90 };

  return createPortal(
    <div className="fixed inset-0 z-[70]" onMouseDown={(e) => e.stopPropagation()}>
      {rect ? (
        <motion.div
          className="pointer-events-none absolute rounded-xl ring-2 ring-[color:var(--color-sky-500)]"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
          initial={false}
          animate={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
      <motion.div
        key={i}
        role="dialog"
        aria-label={stop.title}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute rounded-xl border border-white/[0.1] bg-[var(--oc-surface)] p-4 shadow-2xl"
        style={{ width: W, ...card }}
      >
        <p className="text-[11px] text-neutral-500">
          {i + 1} of {STOPS.length}
        </p>
        <h3 className="mt-1 text-[15px] font-semibold text-neutral-100">{stop.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-300">{stop.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setI(null)} className="cursor-pointer text-[12.5px] text-neutral-500 hover:text-neutral-300">
            Skip tour
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="h-7 cursor-pointer rounded-md px-3 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">
                Back
              </button>
            )}
            <button type="button" onClick={() => setI(last ? null : i + 1)} className="h-7 cursor-pointer rounded-md bg-[color:var(--color-sky-500)] px-3 text-[12.5px] font-medium text-white hover:brightness-110">
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
