import { useEffect, useRef, useState, type ReactNode } from "react";
import { FONT_IDS, FONTS, type FontId } from "../lib/fonts";
import { createPortal } from "react-dom";
import { NeridaMark } from "./NeridaOrb";
import { Copy, Download, PenLine, Star, Trash2 } from "lucide-react";

export type PageMenuAction = "favorite" | "rename" | "duplicate" | "export" | "flashcards" | "trash";

type PageMenuProps = {
  /** Button the menu hangs from. */
  anchor: HTMLElement;
  /** "right" hangs beside a sidebar row; "below" drops under a header button. */
  placement?: "right" | "below";
  /** The page header's menu also offers Export; the sidebar's doesn't. */
  showExport?: boolean;
  pinned: boolean;
  /** Header menu only: the page font tiles at the top. */
  font?: string;
  onFont?: (font: FontId) => void;
  onAction: (action: PageMenuAction) => void;
  onClose: () => void;
};

type Item = {
  id: PageMenuAction;
  label: string;
  icon: ReactNode;
  danger?: boolean;
};

/** Notion's page "⋯" menu: filter field on top, then actions. */
export function PageMenu({
  anchor,
  placement = "right",
  showExport,
  pinned,
  font = "default",
  onFont,
  onAction,
  onClose,
}: PageMenuProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: Item[] = [
    {
      id: "favorite",
      label: pinned ? "Remove from Favorites" : "Add to Favorites",
      icon: <Star className="size-4" />,
    },
    { id: "rename", label: "Rename", icon: <PenLine className="size-4" /> },
    { id: "duplicate", label: "Duplicate", icon: <Copy className="size-4" /> },
    ...(showExport
      ? [
          { id: "export" as const, label: "Export", icon: <Download className="size-4" /> },
          { id: "flashcards" as const, label: "Make flashcards with Nerida", icon: <NeridaMark size={16} /> },
        ]
      : []),
    { id: "trash", label: "Move to Trash", icon: <Trash2 className="size-4" />, danger: true },
  ];
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => i.label.toLowerCase().includes(q));

  // Open beside the button, flipped up if it would run off the bottom.
  const rect = anchor.getBoundingClientRect();
  const top =
    placement === "below" ? rect.bottom + 4 : Math.min(rect.top, window.innerHeight - 220);
  const left = placement === "below" ? Math.max(8, rect.right - 240) : rect.right + 6;

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  const pick = (id: PageMenuAction) => {
    onAction(id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && shown[cursor]) pick(shown[cursor].id);
  };

  return createPortal(
    <div
      ref={menuRef}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      style={{ top, left }}
      className={`oc-pop-in fixed z-50 w-64 ${placement === "below" ? "origin-top-right" : "origin-top-left"} rounded-lg border border-white/[0.08] bg-neutral-800 p-1 shadow-xl shadow-black/50`}
    >
      {onFont && (
        <div className="mb-1 grid grid-cols-5 gap-0.5 border-b border-white/[0.06] pb-1">
          {FONT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              title={FONTS[id].label}
              onClick={() => onFont(id)}
              className={`flex h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md transition-colors ${
                font === id ? "bg-white/[0.08] text-sky-400" : "text-neutral-300 hover:bg-white/[0.05]"
              }`}
            >
              <span style={{ fontFamily: FONTS[id].stack }} className="text-[18px] leading-none">
                Ag
              </span>
              <span className="max-w-full truncate px-0.5 text-[10px] text-neutral-500">{FONTS[id].label}</span>
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search actions…"
        className="mb-1 h-7 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none transition-colors duration-100 placeholder:text-neutral-500 focus:border-sky-500/60"
      />
      {shown.length > 0 ? (
        shown.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => setCursor(i)}
            onClick={() => pick(item.id)}
            className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors duration-100 ${
              i === cursor
                ? item.danger
                  ? "bg-white/[0.06] text-red-400"
                  : "bg-white/[0.06] text-neutral-100"
                : "text-neutral-300"
            }`}
          >
            <span className={i === cursor && item.danger ? "text-red-400" : "text-neutral-400"}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))
      ) : (
        <p className="px-2 py-1.5 text-[13px] text-neutral-500">No actions</p>
      )}
    </div>,
    document.body,
  );
}
