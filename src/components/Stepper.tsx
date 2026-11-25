import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownLeft } from "lucide-react";
import logoRaw from "../assets/logo-raw.png";

export type StepInfo = { label: string; hint: string };

/**
 * Split-panel setup flow: a tinted side panel lists the steps (the current one
 * has a sliding highlight), the form sits on the right and fades/rises between
 * steps. Footer: Skip for now, Back, Next (Enter also moves on).
 */
export function Stepper({
  steps,
  info,
  canNext = () => true,
  onStep,
  onFinish,
  onSkip,
  finishLabel = "Finish",
  height = 400,
}: {
  steps: ReactNode[];
  /** Name and one-line description per step, for the side panel. */
  info: StepInfo[];
  /** Whether Next is enabled on step `i`. */
  canNext?: (i: number) => boolean;
  /** Called with the step being left by Next (to save its choices). */
  onStep?: (i: number) => void;
  onFinish: () => void;
  /** Shows a "Skip for now" link. */
  onSkip?: () => void;
  finishLabel?: string;
  /** Fixed body height (px) so the dialog does not jump between steps. */
  height?: number;
}) {
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  const next = () => {
    if (!canNext(i)) return;
    onStep?.(i);
    if (last) onFinish();
    else setI(i + 1);
  };

  return (
    <div
      className="flex"
      style={{ height }}
      onKeyDown={(e) => {
        // Enter advances, except on buttons (they click) and while an IME is composing.
        if (e.key !== "Enter" || e.nativeEvent.isComposing || (e.target as HTMLElement).closest("button, textarea, [role=listbox]")) return;
        e.preventDefault();
        next();
      }}
    >
      {/* Side panel: brand, steps, progress */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.025] p-5">
        <div className="mb-7 flex items-center gap-2.5">
          <img src={logoRaw} alt="" className="oc-brand-logo size-8 rounded-lg object-contain" />
          <div>
            <p className="text-[14px] font-semibold leading-tight text-neutral-100">Oceanic</p>
            <p className="text-[11.5px] text-neutral-500">Setup</p>
          </div>
        </div>
        <ol className="flex flex-col gap-1">
          {info.map((s, n) => (
            <li key={s.label}>
              <button
                type="button"
                disabled={n > i}
                onClick={() => setI(n)}
                aria-current={n === i ? "step" : undefined}
                className="relative flex w-full cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2 text-left disabled:cursor-default"
              >
                {n === i && (
                  <motion.span layoutId="oc-step-hl" className="absolute inset-0 rounded-xl bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" transition={{ type: "spring", stiffness: 420, damping: 36 }} />
                )}
                <span
                  className={`relative mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors ${n < i ? "bg-sky-500 text-white" : n === i ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/60" : "bg-white/[0.06] text-neutral-500"}`}
                >
                  {n < i ? <Check className="size-3" strokeWidth={3} /> : n + 1}
                </span>
                <span className="relative min-w-0">
                  <span className={`block text-[13px] font-medium ${n <= i ? "text-neutral-100" : "text-neutral-500"}`}>{s.label}</span>
                  <span className={`block text-[11.5px] leading-snug ${n === i ? "text-neutral-400" : "text-neutral-500/80"}`}>{s.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-auto">
          <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div className="h-full rounded-full bg-sky-500" initial={false} animate={{ width: `${((i + 1) / steps.length) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
          </div>
          <p className="text-[11.5px] text-neutral-500">
            Step {i + 1} of {steps.length}
          </p>
        </div>
      </aside>

      {/* Form */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="h-full px-7 pt-7"
            >
              {steps[i]}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2 px-7 pb-6 pt-2">
          {onSkip && (
            <button type="button" onClick={onSkip} className="cursor-pointer rounded-md px-1 text-[12.5px] text-neutral-500 hover:text-neutral-300">
              Skip for now
            </button>
          )}
          <span className="flex-1" />
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="h-9 cursor-pointer rounded-full bg-white/[0.06] px-5 text-[13px] font-medium text-neutral-200 hover:bg-white/[0.1] active:scale-[0.97]">
              Back
            </button>
          )}
          <button
            type="button"
            disabled={!canNext(i)}
            onClick={next}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-[color:var(--color-sky-500)] pl-5 pr-3 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
          >
            {last ? finishLabel : "Continue"}
            <kbd className="grid h-5 place-items-center rounded-md bg-white/20 px-1 font-sans" aria-label="Enter">
              <CornerDownLeft className="size-3" />
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
