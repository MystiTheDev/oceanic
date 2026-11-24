import { useLayoutEffect, useRef } from "react";

const ON = ':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > [aria-checked="true"]';

/** Sliding selection pill. Put it first inside a segmented control; it glides
 *  under whichever sibling has aria-pressed / aria-selected / aria-checked. */
export function SlidePill({ className = "rounded-md" }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = (animate: boolean) => {
    const el = ref.current;
    const on = el?.parentElement?.querySelector<HTMLElement>(ON);
    if (!el) return;
    if (!on) return void (el.style.opacity = "0");
    if (!animate || el.style.opacity !== "1") el.style.transition = "none";
    Object.assign(el.style, { opacity: "1", left: `${on.offsetLeft}px`, top: `${on.offsetTop}px`, width: `${on.offsetWidth}px`, height: `${on.offsetHeight}px` });
    void el.offsetWidth;
    el.style.transition = "";
  };
  useLayoutEffect(() => place(true));
  // Tabs shrink with the window: follow size changes without animating.
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    let w = box.offsetWidth;
    const ro = new ResizeObserver(() => w !== box.offsetWidth && ((w = box.offsetWidth), place(false)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} aria-hidden className={`oc-seg-pill ${className}`} style={{ opacity: 0 }} />;
}
