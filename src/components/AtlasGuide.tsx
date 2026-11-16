import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { api } from "../data/api";
import { isConceptId } from "../data/atlas";

/** Settings key: unset = show in empty workspaces, "restart" = show anywhere, "off" = finished or dismissed. */
const KEY = "atlasGuide";
/** Fired by Settings to bring the guide back. */
export const ATLAS_GUIDE_RESET = "atlas-guide-reset";

export function resetAtlasGuide() {
  api.setSetting(KEY, "restart").then(() => window.dispatchEvent(new Event(ATLAS_GUIDE_RESET))).catch(() => {});
}

type Props = {
  workspaceId: string;
  conceptCount: number;
  /** Relationships touching at least one concept. */
  edgeCount: number;
  /** Times a concept was focused this session. */
  focusCount: number;
  /** Resources attached to concepts. */
  resourceCount: number;
  /** Workspace has pages, so the attach step makes sense. */
  hasPages: boolean;
};

/**
 * First-run checklist for Atlas. Shows when a workspace has no concepts and
 * the guide was never finished or dismissed. Steps tick off from actions taken
 * after the guide opened, so a replay in a full workspace starts fresh.
 */
export function AtlasGuide({ workspaceId, conceptCount, edgeCount, focusCount, resourceCount, hasPages }: Props) {
  const [show, setShow] = useState(false);
  /** Collapsed to its title and progress bar, to free the canvas. */
  const [mini, setMini] = useState(false);
  const counts = { conceptCount, edgeCount, focusCount, resourceCount };
  const live = useRef(counts);
  live.current = counts;
  /** Counts when the guide opened; progress is measured from here. */
  const [base, setBase] = useState(counts);

  useEffect(() => {
    const check = () =>
      // Baseline comes from storage, not props: the canvas may still be loading.
      Promise.all([api.getSettings(), api.listConcepts(workspaceId), api.getCanvasEdges(), api.listConceptResources(workspaceId)])
        .then(([s, cs, es, rs]) => {
          setBase({
            conceptCount: cs.length,
            edgeCount: es.filter((e) => isConceptId(e.sourceId) || isConceptId(e.targetId)).length,
            focusCount: live.current.focusCount,
            resourceCount: rs.length,
          });
          setShow(s[KEY] === "restart" || (!s[KEY] && cs.length === 0));
        })
        .catch(() => {});
    check();
    window.addEventListener(ATLAS_GUIDE_RESET, check);
    return () => window.removeEventListener(ATLAS_GUIDE_RESET, check);
  }, [workspaceId]);

  const steps = [
    { label: "Create a concept (bulb button, or right-click the canvas)", done: conceptCount - base.conceptCount >= 1 },
    { label: "Create a second concept", done: conceptCount - base.conceptCount >= 2 },
    { label: "Connect them: drag from a card's edge to the other", done: edgeCount > base.edgeCount },
    { label: "Double-click a concept to focus it", done: focusCount > base.focusCount },
    ...(hasPages ? [{ label: "Click a concept and attach a note", done: resourceCount > base.resourceCount }] : []),
  ];
  const allDone = steps.every((s) => s.done);

  const close = () => {
    setShow(false);
    api.setSetting(KEY, "off").catch(() => {});
  };
  // Finished: remember it now, but keep the card up with the replay hint until closed.
  useEffect(() => {
    if (show && allDone) api.setSetting(KEY, "off").catch(() => {});
  }, [show, allDone]);

  if (!show) return null;
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div
      data-atlas-overlay
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-4 top-28 z-10 w-[min(18.5rem,calc(100%-2rem))] rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] p-4 text-[12.5px] leading-snug shadow-xl shadow-black/40"
    >
      <div className="flex items-center gap-1">
        <p className="text-[13.5px] font-semibold text-neutral-100">Welcome to Atlas</p>
        <span className="flex-1" />
        {!allDone && (
          <button
            type="button"
            aria-label={mini ? "Expand" : "Minimize"}
            aria-expanded={!mini}
            data-tip={mini ? "Expand" : "Minimize"}
            onClick={() => setMini((m) => !m)}
            className="cursor-pointer rounded p-0.5 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200"
          >
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${mini ? "-rotate-90" : ""}`} />
          </button>
        )}
        <button type="button" aria-label="Dismiss" data-tip="Dismiss" onClick={close} className="-mr-1 cursor-pointer rounded p-0.5 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200">
          <X className="size-3.5" />
        </button>
      </div>
      {!(mini && !allDone) && (
        <p className="mt-1 text-neutral-400 max-[900px]:hidden">
          Map ideas as concepts and link them with meaningful relationships. Notes stay notes; concepts point to them.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2" aria-label={`${doneCount} of ${steps.length} steps done`}>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-sky-500 transition-[width] duration-500 ease-out" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
        <span className="text-[11px] tabular-nums text-neutral-500">
          {doneCount}/{steps.length}
        </span>
      </div>
      <ul className={`mt-3 space-y-2 ${mini && !allDone ? "hidden" : ""}`}>
        {steps.map((s) => (
          <li key={s.label} className={`flex items-start gap-2.5 transition-colors duration-300 ${s.done ? "text-neutral-500" : "text-neutral-200"}`}>
            <span className={`mt-px grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${s.done ? "border-sky-500 bg-sky-500" : "border-white/25"}`}>
              {s.done && <Check className="oc-pop-in size-2.5 text-white" strokeWidth={3} />}
            </span>
            {s.label}
          </li>
        ))}
      </ul>
      {allDone && (
        <div className="oc-fade-in mt-3.5 border-t border-white/[0.06] pt-3">
          <p className="mb-2.5 text-neutral-300">
            You're all set! Forget a step later? Replay this tutorial any time from Settings → Preferences → Atlas.
          </p>
          <button
            type="button"
            onClick={close}
            className="h-8 w-full cursor-pointer rounded-md bg-sky-600 text-[12.5px] font-medium text-white transition-colors hover:bg-sky-500"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
