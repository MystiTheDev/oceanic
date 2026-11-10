import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWheelScroll } from "../lib/useWheelScroll";

/** Sideways row: wheel scrolls it, cut-off edges fade, ‹ › arrows while there is more. */
export function ScrollRow({ children, deps }: { children: ReactNode; deps?: unknown }) {
  const row = useRef<HTMLDivElement>(null);
  useWheelScroll(row);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [deps]);
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * 440, behavior: "smooth" });
  return (
    <div className="group/row relative">
      <div
        ref={row}
        onScroll={measure}
        className="-mx-2 -mt-2 flex gap-3 overflow-x-auto px-2 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          // Soft fade on whichever side has more cards, so a cut-off card reads as "scroll for more".
          maskImage: `linear-gradient(to right, ${edges.left ? "transparent, black 48px" : "black, black"}, ${edges.right ? "black calc(100% - 64px), transparent" : "black, black"})`,
          WebkitMaskImage: `linear-gradient(to right, ${edges.left ? "transparent, black 48px" : "black, black"}, ${edges.right ? "black calc(100% - 64px), transparent" : "black, black"})`,
        }}
      >
        {children}
      </div>
      {edges.left && <RowArrow side="left" onClick={() => scroll(-1)} />}
      {edges.right && <RowArrow side="right" onClick={() => scroll(1)} />}
    </div>
  );
}

function RowArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 z-10 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/[0.1] bg-[var(--oc-surface)] text-neutral-300 shadow-lg transition-[color,transform] duration-150 hover:scale-105 hover:text-neutral-100 ${
        side === "left" ? "left-1" : "right-1"
      }`}
    >
      {side === "left" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  );
}
