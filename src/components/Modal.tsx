import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscape, useFocusTrap } from "../lib/overlay";

/** Centered dialog over a dimmed backdrop; Escape or a backdrop click closes it. Tab stays inside; focus returns on close. */
export function Modal({
  children,
  onClose,
  className = "w-[400px]",
  label,
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  /** Accessible name when the dialog has no visible heading. */
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(box);

  return createPortal(
    <div
      data-oc-modal
      className="oc-fade-in fixed inset-0 z-[60] grid place-items-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`oc-pop-in oc-dialog max-h-[85vh] overflow-hidden border border-white/[0.08] bg-[var(--oc-surface)] outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalButton({
  children,
  onClick,
  variant = "plain",
  disabled,
  autoFocus,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "plain" | "primary" | "danger";
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const look = {
    plain: "text-neutral-300 hover:bg-white/[0.08]",
    primary: "bg-sky-600 text-[#fff] hover:bg-sky-500",
    danger: "bg-red-500/80 text-[#fff] hover:bg-red-500",
  }[variant];
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onClick}
      className={`oc-btn h-8 cursor-pointer px-3 text-[13px] font-medium disabled:cursor-default disabled:opacity-40 ${look}`}
    >
      {children}
    </button>
  );
}

/** Square icon-only button with a required label (screen readers + hover tooltip). */
export function IconButton({
  label,
  onClick,
  children,
  className = "",
  size = "size-7",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  size?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      onClick={onClick}
      className={`oc-btn grid ${size} shrink-0 cursor-pointer place-items-center text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-200 ${className}`}
    >
      {children}
    </button>
  );
}
