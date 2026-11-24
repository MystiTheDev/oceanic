import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

/**
 * Multi-step flow (after React Bits' Stepper): numbered dots with a gliding
 * connector, spring slide between steps, Back / Next footer. Enter = Next.
 */
export function Stepper({
  steps,
  labels,
  canNext = () => true,
  onStep,
  onFinish,
  finishLabel = "Finish",
}: {
  steps: ReactNode[];
  /** Optional name under each dot. */
  labels?: string[];
  /** Whether Next is enabled on step `i`. */
  canNext?: (i: number) => boolean;
  /** Called with the step being left by Next (to save its choices). */
  onStep?: (i: number) => void;
  onFinish: () => void;
  finishLabel?: string;
}) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const last = i === steps.length - 1;
  const go = (n: number) => (setDir(n > i ? 1 : -1), setI(n));
  const next = () => canNext(i) && (onStep?.(i), last ? onFinish() : go(i + 1));

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && !e.shiftKey && t.tagName !== "TEXTAREA" && t.tagName !== "BUTTON") (e.preventDefault(), next());
      }}
    >
      <div className="flex items-start px-7 pt-7">
        {steps.map((_, n) => (
          <div key={n} className="flex flex-1 items-start last:flex-none">
            <button
              type="button"
              disabled={n > i}
              onClick={() => go(n)}
              className="group flex w-7 shrink-0 cursor-pointer flex-col items-center gap-1.5 disabled:cursor-default"
            >
              <span className="relative grid size-7 place-items-center rounded-full text-[12px] font-semibold">
                <motion.span
                  className="absolute inset-0 rounded-full"
                  initial={false}
                  animate={{
                    backgroundColor: n <= i ? "var(--color-sky-500)" : "rgba(255,255,255,0.06)",
                    boxShadow: n === i ? "0 0 0 4px rgba(56,189,248,0.18), inset 0 1px 0 rgba(255,255,255,0.3)" : "0 0 0 0px rgba(56,189,248,0), inset 0 1px 0 rgba(255,255,255,0.08)",
                    scale: n === i ? 1.08 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
                <span className={`relative ${n <= i ? "text-white" : "text-neutral-400"}`}>{n < i ? <Check className="size-3.5" /> : n + 1}</span>
              </span>
              {labels?.[n] && (
                <span className={`whitespace-nowrap text-[11px] font-medium transition-colors ${n === i ? "text-neutral-100" : n < i ? "text-neutral-400 group-hover:text-neutral-200" : "text-neutral-600"}`}>{labels[n]}</span>
              )}
            </button>
            {n < steps.length - 1 && (
              <div className="mx-2 mt-[13px] h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div className="h-full bg-gradient-to-r from-sky-400 to-[color:var(--color-sky-500)]" initial={false} animate={{ width: n < i ? "100%" : "0%" }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="relative min-h-[270px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={i}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 48, opacity: 0, filter: "blur(6px)" }),
              center: { x: 0, opacity: 1, filter: "blur(0px)" },
              exit: (d: number) => ({ x: d * -48, opacity: 0, filter: "blur(6px)" }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="px-7 py-6"
          >
            {steps[i]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.015] px-7 py-4">
        <button type="button" onClick={() => go(i - 1)} className={`h-8 cursor-pointer rounded-full px-3 text-[13px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 ${i === 0 ? "invisible" : ""}`}>
          Back
        </button>
        <span className="flex items-center gap-3">
          <span className="hidden text-[11px] text-neutral-500 sm:inline">{canNext(i) ? "Press Enter ↵" : ""}</span>
          <button
            type="button"
            disabled={!canNext(i)}
            onClick={next}
            className="oc-setup-next h-9 cursor-pointer rounded-full px-5 text-[13px] font-medium text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:cursor-default disabled:opacity-40 disabled:active:scale-100"
          >
            {last ? finishLabel : "Next"}
          </button>
        </span>
      </div>
    </div>
  );
}
