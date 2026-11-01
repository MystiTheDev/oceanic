import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Shuffle } from "lucide-react";

type Emoji = { unicode: string; label: string; tags?: string[]; group?: number; order?: number };

/** emojibase groups, minus 2 (skin-tone components). */
const GROUPS: [number, string][] = [
  [0, "Smileys & emotion"],
  [1, "People & body"],
  [3, "Animals & nature"],
  [4, "Food & drink"],
  [5, "Travel & places"],
  [6, "Activities"],
  [7, "Objects"],
  [8, "Symbols"],
  [9, "Flags"],
];

/** The short list shown before "View more emojis". */
const POPULAR = [
  "📄", "📝", "📚", "📌", "💡", "✅", "🎯", "🚀", "🔥", "⭐", "🌊", "🧠",
  "⚛️", "🧪", "📐", "💻", "🧬", "🔭", "🌍", "🎨", "🎵", "📊", "📅", "⚙️",
  "😀", "😎", "🤔", "❤️", "👍", "🎉", "🏆", "📦", "🗂️", "🔑", "🌱", "☕",
];

const RECENT_KEY = "oceanic.recentEmoji";
const DEFAULT_ICON = "📄";

const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
};

/** The emoji list is ~400 KB, so it loads on first open, not with the app. */
let cache: Promise<Emoji[]> | null = null;
const loadEmoji = () =>
  (cache ??= import("emojibase-data/en/compact.json").then((m) =>
    (m.default as Emoji[])
      .filter((e) => e.group !== undefined && e.group !== 2)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  ));

/** Notion's icon picker: search, Random, Remove, recents, then every emoji by category. */
export function EmojiPicker({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<Emoji[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [recent] = useState(readRecent);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEmoji().then(setAll);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const pick = (emoji: string) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recent.filter((e) => e !== emoji)].slice(0, 18)));
    } catch {
      /* storage blocked */
    }
    onSelect(emoji);
    onClose();
  };

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (q) {
      const hits = all.filter((e) => e.label.includes(q) || e.tags?.some((t) => t.startsWith(q)));
      return [{ title: hits.length ? "Results" : "No results", items: hits.map((e) => e.unicode) }];
    }
    const out = recent.length ? [{ title: "Recent", items: recent }] : [];
    if (!showAll) return [...out, { title: "Popular", items: POPULAR }];
    for (const [g, title] of GROUPS) out.push({ title, items: all.filter((e) => e.group === g).map((e) => e.unicode) });
    return out;
  }, [all, q, recent, showAll]);

  const labels = useMemo(() => new Map(all.map((e) => [e.unicode, e.label])), [all]);

  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 6, window.innerHeight - 390);

  return createPortal(
    <div
      ref={ref}
      style={{ left: Math.min(r.left, window.innerWidth - 420), top: Math.max(8, top) }}
      className="oc-pop-in fixed z-50 flex max-h-[380px] w-[408px] flex-col rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] shadow-xl shadow-black/50"
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2 pb-2 pt-2">
        <div className="flex h-7 flex-1 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 focus-within:border-sky-500/60">
          <Search className="size-3.5 shrink-0 text-neutral-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500"
          />
        </div>
        <button
          type="button"
          title="Random"
          onClick={() => all.length && pick(all[Math.floor(Math.random() * all.length)].unicode)}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
        >
          <Shuffle className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => pick(DEFAULT_ICON)}
          className="h-7 cursor-pointer rounded-md px-2 text-[13px] text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
        >
          Remove
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {(showAll || q) && !all.length ? (
          <p className="px-1 py-6 text-center text-[13px] text-neutral-500">Loading…</p>
        ) : (
          sections.map((s) => (
            <section key={s.title}>
              <p className="sticky top-0 z-10 bg-[var(--oc-surface)] px-1 pb-1 pt-2.5 text-[11px] font-medium text-neutral-500">
                {s.title}
              </p>
              <div className="grid grid-cols-12">
                {s.items.map((e) => (
                  <button
                    key={e}
                    type="button"
                    title={labels.get(e)}
                    onClick={() => pick(e)}
                    className="grid aspect-square cursor-pointer place-items-center rounded text-[22px] leading-none transition-colors hover:bg-white/[0.08]"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
        {!showAll && !q && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-2 h-8 w-full cursor-pointer rounded-md text-[13px] text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
          >
            View more emojis
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
