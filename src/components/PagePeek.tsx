import { useEffect, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

/** Notion's side peek: the page slides in from the right over the current view. */
export function PagePeek({
  children,
  onClose,
  onOpenFull,
  center = false,
  label,
}: {
  /** Centered modal (Notion's "new subpage" peek) instead of the side panel. */
  center?: boolean;
  label?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape inside an open menu closes the menu, not the peek.
      if (e.key === "Escape" && !document.querySelector(".oc-context-menu")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (center)
    return (
      <div className="absolute inset-0 z-30 grid place-items-center bg-black/50 p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="oc-pop-in flex h-[min(760px,100%)] w-[min(960px,100%)] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-neutral-900 shadow-2xl shadow-black/60">
          <div className="flex h-11 shrink-0 items-center gap-2 px-3">
            <PeekButton title="Open as full page" onClick={onOpenFull}>
              <Maximize2 className="size-3.5" />
            </PeekButton>
            {label && <span className="flex items-center gap-1.5 border-l border-white/[0.08] pl-3 text-[14px] text-neutral-500">{label}</span>}
            <span className="flex-1" />
            <PeekButton title="Close (Esc)" onClick={onClose}>
              <X className="size-4" />
            </PeekButton>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </div>
    );

  return (
    <div className="oc-peek-in absolute inset-y-0 right-0 z-30 flex w-[min(720px,60%)] flex-col border-l border-white/[0.08] bg-neutral-900 shadow-2xl shadow-black/60">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <PeekButton title="Close (Esc)" onClick={onClose}>
          <X className="size-4" />
        </PeekButton>
        <PeekButton title="Open as full page" onClick={onOpenFull}>
          <Maximize2 className="size-3.5" />
        </PeekButton>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function PeekButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
    >
      {children}
    </button>
  );
}
