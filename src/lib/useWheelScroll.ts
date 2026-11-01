import { useEffect, type RefObject } from "react";

/**
 * Vertical mouse wheel scrolls a sideways row while hovering it. At either
 * end the event is left alone, so the page keeps scrolling instead of sticking.
 */
export function useWheelScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) return; // trackpads / shift already go sideways
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft >= max - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY * 1.2, behavior: "smooth" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
