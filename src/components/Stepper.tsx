import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

/**
 * Multi-step flow (after React Bits' Stepper): numbered dots with a gliding
 * connector, spring slide between steps, Back / Next footer.
 */
export function Stepper({
  steps,
  canNext = () => true,
  onStep,
  onFinish,
  finishLabel = "Finish",
}: {
  steps: ReactNode[];
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

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-6">
        {steps.map((_, n) => (
          <div key={n} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={n > i}
              onClick={() => go(n)}
              className="relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-[12px] font-semibold disabled:cursor-default"
            >
              <motion.span
                className="absolute inset-0 rounded-full"
                initial={false}
                animate={{ backgroundColor: n <= i ? "var(--color-sky-500)" : "rgba(255,255,255,0.08)", scale: n === i ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
              <span className={`relative ${n <= i ? "text-white" : "text-neutral-400"}`}>{n < i ? <Check className="size-3.5" /> : n + 1}</span>
            </button>
            {n < steps.length - 1 && (
              <div className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div className="h-full bg-[color:var(--color-sky-500)]" initial={false} animate={{ width: n < i ? "100%" : "0%" }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="relative min-h-[260px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={i}
            custom={dir}
            variants={{ enter: (d: number) => ({ x: d * 60, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -60, opacity: 0 }) }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="px-6 py-5"
          >
            {steps[i]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3.5">
        <button type="button" onClick={() => go(i - 1)} className={`cursor-pointer text-[13px] text-neutral-400 hover:text-neutral-200 ${i === 0 ? "invisible" : ""}`}>
          Back
        </button>
        <button
          type="button"
          disabled={!canNext(i)}
          onClick={() => (onStep?.(i), last ? onFinish() : go(i + 1))}
          className="h-8 cursor-pointer rounded-md bg-[color:var(--color-sky-500)] px-4 text-[13px] font-medium text-white hover:brightness-110 disabled:cursor-default disabled:opacity-40"
        >
          {last ? finishLabel : "Next"}
        </button>
      </div>
    </div>
  );
}
