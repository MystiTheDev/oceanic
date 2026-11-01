import { useEffect, useState, type RefObject } from "react";
import type { OceanicEditor } from "../editor/schema";

type Heading = { id: string; level: number; text: string };

const headingsOf = (editor: OceanicEditor): Heading[] => {
  const out: Heading[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      if (b.type === "heading") {
        const level = (b.props as { level?: number }).level ?? 1;
        if (level <= 3) {
          const text = Array.isArray(b.content)
            ? b.content.map((c) => ("text" in c ? c.text : "")).join("")
            : "";
          out.push({ id: b.id, level, text: text || "Untitled heading" });
        }
      }
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
};

/** Line width per level, like Notion's right-edge outline. */
const WIDTH = { 1: 16, 2: 12, 3: 8 } as Record<number, number>;

/**
 * Notion's page outline: a strip of short lines on the right edge (one per
 * H1–H3, current section bright). Hovering opens the full heading list.
 */
export function PageOutline({ editor, scroller }: { editor: OceanicEditor; scroller: RefObject<HTMLDivElement | null> }) {
  const [headings, setHeadings] = useState<Heading[]>(() => headingsOf(editor));
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => editor.onChange(() => setHeadings(headingsOf(editor))), [editor]);

  // Current section: the last heading scrolled past the top third.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const line = el.getBoundingClientRect().top + el.clientHeight / 3;
      let current: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const node = el.querySelector(`[data-id="${h.id}"]`);
        if (node && node.getBoundingClientRect().top <= line) current = h.id;
      }
      setActive(current);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [headings, scroller]);

  if (headings.length < 2) return null;

  const go = (id: string) => {
    const el = scroller.current;
    const node = el?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!el || !node) return;
    const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24;
    el.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <div
      className="oc-outline pointer-events-auto absolute right-3 top-1/2 z-20 -translate-y-1/2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Collapsed strip */}
      <div className={`flex flex-col items-end gap-[9px] py-2 pl-4 transition-opacity duration-150 ${open ? "opacity-0" : "opacity-100"}`}>
        {headings.map((h) => (
          <span
            key={h.id}
            style={{ width: WIDTH[h.level] }}
            className={`block h-[2px] rounded-full transition-colors duration-150 ${
              h.id === active ? "bg-neutral-200" : "bg-neutral-600"
            }`}
          />
        ))}
      </div>

      {/* Hover list */}
      {open && (
        <nav className="oc-pop-in absolute right-0 top-1/2 max-h-[60vh] w-60 origin-right -translate-y-1/2 overflow-y-auto rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1.5 shadow-xl shadow-black/40 scrollbar-thin">
          {headings.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => go(h.id)}
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              className={`flex h-7 w-full cursor-pointer items-center truncate rounded-md pr-2 text-left text-[13px] transition-colors hover:bg-white/[0.06] ${
                h.id === active ? "text-sky-400" : h.level === 1 ? "text-neutral-200" : "text-neutral-400"
              }`}
            >
              <span className="truncate">{h.text}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
