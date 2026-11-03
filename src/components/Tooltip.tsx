import { useEffect, useState } from "react";

/** Word-style tooltip card for any [data-tip] anywhere in the app (after a short hover). */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      window.clearTimeout(timer);
      if (!el) return setTip(null);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        // Flip above when the target sits near the bottom edge (status bars).
        const below = r.bottom + 40 < window.innerHeight;
        setTip({ text: el.dataset.tip!, x: Math.min(window.innerWidth - 80, Math.max(80, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 34 });
      }, 450);
    };
    const hide = () => (window.clearTimeout(timer), setTip(null));
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide);
    return () => (document.removeEventListener("mouseover", over), document.removeEventListener("mousedown", hide), window.clearTimeout(timer));
  }, []);
  if (!tip) return null;
  const [name, key] = tip.text.split(/ \((.+)\)$/);
  return (
    <div className="oc-docs-tip pointer-events-none fixed z-[70] -translate-x-1/2 rounded-md border border-white/[0.1] bg-[var(--oc-raised)] px-2.5 py-1.5 text-[12px] shadow-lg" style={{ left: tip.x, top: tip.y }}>
      <span className="font-medium text-neutral-100">{name}</span>
      {key && <span className="ml-2 text-neutral-400">{key}</span>}
    </div>
  );
}
