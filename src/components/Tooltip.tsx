import { useEffect, useState } from "react";

/** Word-style tooltip card for any [data-tip] anywhere in the app (after a short hover).
 *  Optional [data-tip-sub] adds a smaller, wrapped second line. */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; sub?: string; x: number; y: number; above?: boolean } | null>(null);
  useEffect(() => {
    let timer = 0;
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      window.clearTimeout(timer);
      if (!el) return setTip(null);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const sub = el.dataset.tipSub;
        // Flip above when the card wouldn't fit below (status bars, the chat box); a second line needs more room.
        const below = r.bottom + (sub ? 100 : 40) < window.innerHeight;
        const w = sub ? 140 : 80; // half the card width, kept on screen
        setTip({ text: el.dataset.tip!, sub, x: Math.min(window.innerWidth - w, Math.max(w, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, above: !below });
      }, 450);
    };
    const hide = () => (window.clearTimeout(timer), setTip(null));
    // Keyboard users get the same tip when Tab lands on a [data-tip] control.
    const focus = (e: FocusEvent) => void (document.documentElement.hasAttribute("data-oc-kbd") && over(e as unknown as MouseEvent));
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("mousedown", hide);
    return () => (document.removeEventListener("mouseover", over), document.removeEventListener("focusin", focus), document.removeEventListener("focusout", hide), document.removeEventListener("mousedown", hide), window.clearTimeout(timer));
  }, []);
  if (!tip) return null;
  const [name, key] = tip.text.split(/ \((.+)\)$/);
  return (
    // Above the target: anchored by its bottom edge, so a taller card never covers the control.
    <div className={`oc-docs-tip pointer-events-none fixed z-[70] -translate-x-1/2 ${tip.above ? "-translate-y-full" : ""} rounded-md border border-white/[0.1] bg-[var(--oc-raised)] px-2.5 py-1.5 text-[12px] shadow-lg`} style={{ left: tip.x, top: tip.y }}>
      <span className="font-medium text-neutral-100">{name}</span>
      {key && <span className="ml-2 text-neutral-400">{key}</span>}
      {tip.sub && <p className="mt-0.5 w-[260px] text-[11.5px] leading-snug text-neutral-400">{tip.sub}</p>}
    </div>
  );
}
