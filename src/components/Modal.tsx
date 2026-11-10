import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Centered dialog over a dimmed backdrop; Escape or a backdrop click closes it. */
export function Modal({
  children,
  onClose,
  className = "w-[400px]",
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      data-oc-modal
      className="oc-fade-in fixed inset-0 z-[60] grid place-items-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`oc-pop-in max-h-[85vh] overflow-hidden rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] shadow-2xl shadow-black/60 ${className}`}
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
      className={`h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium transition-colors duration-100 disabled:cursor-default disabled:opacity-40 ${look}`}
    >
      {children}
    </button>
  );
}
