import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type ToastProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  duration?: number;
};

/** Notion-style bottom-center toast that slides up and dismisses itself. */
export function Toast({ message, actionLabel, onAction, onDismiss, duration = 5000 }: ToastProps) {
  // Keep the timer stable across parent re-renders (e.g. typing in the editor).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(t);
  }, [duration]);

  return createPortal(
    <div className="oc-toast-in fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-white/[0.08] bg-neutral-800 py-2 pl-3.5 pr-2 text-[13px] text-neutral-200 shadow-xl shadow-black/50">
      {message}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="cursor-pointer rounded-md px-2 py-1 font-medium text-sky-400 transition-colors duration-100 hover:bg-white/[0.06]"
        >
          {actionLabel}
        </button>
      )}
    </div>,
    document.body,
  );
}
