/* ---------------------------------------------------------------------------
 * HTML overlays on a reader page (screen pixels, positioned from the
 * annotation's point geometry × scale): the text-box editor, the sticky-note
 * popover, the selected annotation's bar and the text-selection bar.
 * ------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from "react";
import { Highlighter, Layers, Lightbulb, MessageSquareText, ScrollText, Strikethrough, Trash2, Underline } from "lucide-react";
import type { PdfAnnotationKind } from "../data/api";
import { HIGHLIGHT_COLORS, INK_COLORS, MARKUP, STICKY_SIZE, bbox, type Ann } from "./annotations";

export function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`oc-pdf-swatch ${c === value ? "oc-pdf-swatch-on" : ""}`}
          style={{ background: c }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

/** Editing a text box in place: a textarea over the box, saved on blur. */
export function TextBoxEditor({ a, scale, onDone }: { a: Ann; scale: number; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const b = a.data.box!;
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="oc-pdf-textedit"
      defaultValue={a.data.text ?? ""}
      placeholder="Text"
      style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, fontSize: (a.data.width ?? 12) * scale, color: a.color }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

/** The sticky note's popover card: its text, when it was made, delete. */
export function StickyPopover({
  a,
  scale,
  pageWidth,
  onText,
  onDelete,
  onClose,
}: {
  a: Ann;
  scale: number;
  pageWidth: number;
  onText: (text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(a.data.text ?? "");
  const latest = useRef(text);
  latest.current = text;
  const b = a.data.box!;
  // Open on the side with room.
  const right = (b.x + STICKY_SIZE) * scale + 248 < pageWidth * scale;
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      onText(latest.current);
    };
  }, []);
  const when = a.createdAt ? new Date(a.createdAt) : new Date();
  return (
    <div
      ref={ref}
      className="oc-pdf-sticky oc-pop-in"
      style={{ top: b.y * scale, ...(right ? { left: (b.x + STICKY_SIZE) * scale + 8 } : { left: b.x * scale - 248 }) }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="oc-pdf-sticky-head" style={{ background: a.color }}>
        <span>Note · {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, {when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
        <button type="button" data-tip="Delete note" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
      <textarea autoFocus value={text} placeholder="Write a note…" onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

/** Floating bar above the selected annotation: recolour and delete. */
export function AnnBar({ a, scale, onColor, onDelete }: { a: Ann; scale: number; onColor: (c: string) => void; onDelete: () => void }) {
  const b = bbox(a);
  const top = b.y * scale - 44;
  return (
    <div
      className="oc-pdf-bar oc-pop-in"
      style={{ left: (b.x + b.w / 2) * scale, top: top < 4 ? (b.y + b.h) * scale + 8 : top }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Swatches colors={MARKUP.includes(a.kind) || a.kind === "sticky" ? HIGHLIGHT_COLORS : INK_COLORS} value={a.color} onPick={onColor} />
      <i className="oc-pdf-bar-sep" />
      <button type="button" className="oc-pdf-bar-btn" data-tip="Delete (Del)" onClick={onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** Shown over a fresh text selection: mark it up in the current colour. */
export function SelectionBar({
  x,
  y,
  color,
  onColor,
  onMark,
  onNerida,
}: {
  x: number;
  y: number;
  color: string;
  onColor: (c: string) => void;
  onMark: (kind: PdfAnnotationKind) => void;
  onNerida?: (action: "explain" | "summarize" | "cards" | "ask") => void;
}) {
  return (
    <div className="oc-pdf-bar oc-pop-in" style={{ left: x, top: y, position: "fixed" }} onMouseDown={(e) => e.preventDefault()}>
      <Swatches colors={HIGHLIGHT_COLORS} value={color} onPick={onColor} />
      <i className="oc-pdf-bar-sep" />
      <button type="button" className="oc-pdf-bar-btn" data-tip="Highlight" onClick={() => onMark("highlight")}>
        <Highlighter size={14} />
      </button>
      <button type="button" className="oc-pdf-bar-btn" data-tip="Underline" onClick={() => onMark("underline")}>
        <Underline size={14} />
      </button>
      <button type="button" className="oc-pdf-bar-btn" data-tip="Strikethrough" onClick={() => onMark("strike")}>
        <Strikethrough size={14} />
      </button>
      {onNerida && (
        <>
          <i className="oc-pdf-bar-sep" />
          <button type="button" className="oc-pdf-bar-btn" data-tip="Explain simply (Nerida)" onClick={() => onNerida("explain")}><Lightbulb size={14} /></button>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Summarize (Nerida)" onClick={() => onNerida("summarize")}><ScrollText size={14} /></button>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Flashcards (Nerida)" onClick={() => onNerida("cards")}><Layers size={14} /></button>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Ask Nerida about it" onClick={() => onNerida("ask")}><MessageSquareText size={14} /></button>
        </>
      )}
    </div>
  );
}
