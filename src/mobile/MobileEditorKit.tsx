/**
 * Phone editing (Notion-style): a scrollable toolbar above the keyboard, a
 * bottom-sheet block list for "+" (typing "/" does nothing special), a "Turn into" sheet (Aa),
 * and a small popup for selected text.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, ChevronDown, Code, Heading1, Heading2, Heading3, Highlighter, IndentDecrease, IndentIncrease, Italic,
  Camera, FileSymlink, ImagePlus, Link, Paperclip, List, ListChecks, ListOrdered, ListTree, Palette, Plus, Quote, Redo2, Search, Strikethrough, Table2, Text, Underline, Undo2,
} from "lucide-react";
import { useBlockNoteEditor, type DefaultReactSuggestionItem } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import "./mobile-editor.css";
import { buzz } from "./mobilePrefs";
import { attachBlocks, pickFiles, type AttachKind } from "./attach";

type Editor = BlockNoteEditor<any, any, any>;


/** "+": start a fresh line when the current one has text, so the picked block lands there. */
function freshLine(editor: Editor) {
  const block = editor.getTextCursorPosition().block;
  if ((block.content as unknown[] | undefined)?.length) {
    const [created] = editor.insertBlocks([{ type: "paragraph" }], block, "after");
    editor.setTextCursorPosition(created, "end");
  }
}

/** Photo, Image and File rows for the block sheet: pick, then insert at the caret. */
function attachItems(editor: Editor): DefaultReactSuggestionItem[] {
  const add = (kind: AttachKind) => () =>
    void pickFiles(kind).then(async (files) => {
      const blocks = await attachBlocks(files);
      if (!blocks.length) return;
      const cur = editor.getTextCursorPosition().block;
      const empty = !(cur.content as unknown[] | undefined)?.length && cur.type === "paragraph";
      if (empty) editor.replaceBlocks([cur], blocks as never);
      else editor.insertBlocks(blocks as never, cur, "after");
    });
  return [
    { title: "Photo", subtext: "Take a picture with the camera", icon: <Camera size={18} />, onItemClick: add("photo") },
    { title: "Image", subtext: "Pick images from the gallery", icon: <ImagePlus size={18} />, onItemClick: add("image") },
    { title: "File", subtext: "Attach a PDF, document or any file", icon: <Paperclip size={18} />, onItemClick: add("file") },
  ];
}

/** Bottom sheet opened by the toolbar's "+": one row per block, with its description. */
function BlockSheet({ items, onClose }: { items: DefaultReactSuggestionItem[]; onClose: () => void }) {
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault() /* keep the keyboard and caret */}>
        <div className="ocme-grab" />
        <h2>Add a block</h2>
        {items.map((item) => (
          <button key={item.title} className="ocme-block" onClick={() => (buzz(), onClose(), item.onItemClick())}>
            <span className="ocme-block-icon">{item.icon}</span>
            <span>
              <strong>{item.title}</strong>
              {item.subtext && <em>{item.subtext}</em>}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Block types "Turn into" can switch the current block to. */
const TURN_INTO = [
  { label: "Text", note: "Plain paragraph", icon: <Text size={20} />, type: "paragraph" },
  { label: "Heading 1", note: "Big section heading", icon: <Heading1 size={20} />, type: "heading", props: { level: 1 } },
  { label: "Heading 2", note: "Medium section heading", icon: <Heading2 size={20} />, type: "heading", props: { level: 2 } },
  { label: "Heading 3", note: "Small section heading", icon: <Heading3 size={20} />, type: "heading", props: { level: 3 } },
  { label: "Bulleted list", note: "Simple bullet points", icon: <List size={20} />, type: "bulletListItem" },
  { label: "Numbered list", note: "Numbered steps", icon: <ListOrdered size={20} />, type: "numberedListItem" },
  { label: "To-do", note: "Checkbox to tick off", icon: <ListChecks size={20} />, type: "checkListItem" },
  { label: "Toggle list", note: "Hide details under a toggle", icon: <ListTree size={20} />, type: "toggleListItem" },
  { label: "Quote", note: "Set a quote apart", icon: <Quote size={20} />, type: "quote" },
  { label: "Code", note: "Code with monospace font", icon: <Code size={20} />, type: "codeBlock" },
] as const;

function TurnIntoSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault()}>
        <div className="ocme-grab" />
        <h2>Turn into</h2>
        {TURN_INTO.map((t) => (
          <button
            key={t.label}
            className="ocme-block"
            onClick={() => {
              buzz();
              const block = editor.getTextCursorPosition().block;
              editor.updateBlock(block, { type: t.type, props: "props" in t ? t.props : {} } as never);
              onClose();
            }}
          >
            <span className="ocme-block-icon">{t.icon}</span>
            <span>
              <strong>{t.label}</strong>
              <em>{t.note}</em>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Toolbar button handlers: finger-down keeps focus (and the keyboard) in the note;
 * the action runs on release, so a sheet it opens can't catch the same tap.
 */
const press = (fn: () => void) => ({
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onClick: () => {
    buzz();
    fn();
  },
});

/** BlockNote's colour names (same as desktop) with swatch colours. */
const COLORS: [string, string, string][] = [
  ["default", "Default", ""],
  ["gray", "Gray", "#9b9a97"],
  ["brown", "Brown", "#8a6a5a"],
  ["red", "Red", "#e03e3e"],
  ["orange", "Orange", "#d9730d"],
  ["yellow", "Yellow", "#dfab01"],
  ["green", "Green", "#4f9a6b"],
  ["blue", "Blue", "#2e8ec4"],
  ["purple", "Purple", "#8a5fc7"],
  ["pink", "Pink", "#d0458f"],
];

function ColorSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const cur = editor.getActiveStyles() as { textColor?: string; backgroundColor?: string };
  const pick = (key: "textColor" | "backgroundColor", c: string) => {
    buzz();
    if (c === "default") editor.removeStyles({ [key]: cur[key] ?? "" } as never);
    else editor.addStyles({ [key]: c } as never);
    onClose();
  };
  const row = (key: "textColor" | "backgroundColor") => (
    <div className="ocme-colors">
      {COLORS.map(([c, label, hex]) => (
        <button
          key={c}
          aria-label={`${label} ${key === "textColor" ? "text" : "highlight"}`}
          className={`ocme-swatch${(cur[key] ?? "default") === c ? " on" : ""}`}
          style={key === "textColor" ? { color: hex || undefined } : { background: hex ? `color-mix(in srgb, ${hex} 30%, transparent)` : undefined }}
          onClick={() => pick(key, c)}
        >
          A
        </button>
      ))}
    </div>
  );
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault()}>
        <div className="ocme-grab" />
        <h2>Text colour</h2>
        {row("textColor")}
        <h2>Highlight</h2>
        {row("backgroundColor")}
      </div>
    </div>,
    document.body,
  );
}

/** Pick a page to link at the caret (same items as typing [[ on desktop). */
function LinkPageSheet({ editor, links, onClose }: { editor: Editor; links: (q: string) => DefaultReactSuggestionItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const items = links(q);
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet">
        <div className="ocme-grab" />
        <h2>Link to page</h2>
        <label className="ocme-find">
          <Search size={16} />
          <input value={q} placeholder="Search pages" onChange={(e) => setQ(e.target.value)} />
        </label>
        {items.map((item) => (
          <button key={item.title + String(item.icon)} className="ocme-block" onClick={() => (buzz(), onClose(), editor.focus(), item.onItemClick())}>
            <span className="ocme-block-icon">{item.icon}</span>
            <span><strong>{item.title}</strong></span>
          </button>
        ))}
        {!items.length && <p className="ocme-empty">No pages match.</p>}
      </div>
    </div>,
    document.body,
  );
}

type Cell = unknown;
type TableContent = { type: "tableContent"; rows: { cells: Cell[] }[]; [k: string]: unknown };

/** Row and column of the table cell holding the caret. */
function caretCell() {
  const node = window.getSelection()?.anchorNode;
  const td = (node instanceof Element ? node : node?.parentElement)?.closest("td, th") as HTMLTableCellElement | null;
  const tr = td?.parentElement as HTMLTableRowElement | null;
  return td && tr ? { row: tr.rowIndex, col: td.cellIndex } : { row: -1, col: -1 };
}

/** An empty cell shaped like `like` (cells are plain arrays or tableCell objects depending on version). */
const emptyCell = (like: Cell): Cell => (Array.isArray(like) ? [] : { ...(like as object), content: [] });

function TableSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const block = editor.getTextCursorPosition().block as unknown as { type: string; content: TableContent };
  const { row, col } = caretCell();
  const edit = (fn: (rows: Cell[][]) => Cell[][]) => {
    buzz();
    const rows = fn(block.content.rows.map((r) => [...r.cells]));
    if (!rows.length || !rows[0].length) return onClose();
    editor.updateBlock(block as never, { content: { ...block.content, rows: rows.map((cells) => ({ cells })) } } as never);
    onClose();
  };
  const r = row < 0 ? block.content.rows.length - 1 : row;
  const c = col < 0 ? block.content.rows[0].cells.length - 1 : col;
  const actions: [string, () => void][] = [
    ["Add row above", () => edit((rows) => (rows.splice(r, 0, rows[r].map(emptyCell)), rows))],
    ["Add row below", () => edit((rows) => (rows.splice(r + 1, 0, rows[r].map(emptyCell)), rows))],
    ["Add column left", () => edit((rows) => rows.map((cells) => (cells.splice(c, 0, emptyCell(cells[c])), cells)))],
    ["Add column right", () => edit((rows) => rows.map((cells) => (cells.splice(c + 1, 0, emptyCell(cells[c])), cells)))],
    ["Delete row", () => edit((rows) => (rows.splice(r, 1), rows))],
    ["Delete column", () => edit((rows) => rows.map((cells) => (cells.splice(c, 1), cells)))],
  ];
  return createPortal(
    <div className="ocme-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ocme-sheet" onPointerDown={(e) => e.preventDefault()}>
        <div className="ocme-grab" />
        <h2>Table</h2>
        {actions.map(([label, fn]) => (
          <button key={label} className={`ocme-row${label.startsWith("Delete") ? " ocme-danger" : ""}`} onClick={fn}>
            {label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Which styles are on at the caret or selection; rechecks on every caret move and edit. */
function useActive(editor: Editor) {
  const read = () => {
    const s = editor.getActiveStyles() as Record<string, unknown>;
    return { bold: !!s.bold, italic: !!s.italic, underline: !!s.underline, strike: !!s.strike, highlight: !!s.backgroundColor && s.backgroundColor !== "default", color: !!s.textColor && s.textColor !== "default", link: !!editor.getSelectedLinkUrl() };
  };
  const [active, setActive] = useState(read);
  useEffect(() => {
    const update = () => setActive(read());
    const offSel = editor.onSelectionChange(update);
    const offDoc = editor.onChange(update);
    // Toggling a style on an empty selection changes no text and no caret: watch transactions too.
    const view = editor.prosemirrorView;
    const onKey = () => requestAnimationFrame(update);
    view?.dom.addEventListener("keyup", onKey);
    document.addEventListener("click", onKey, true);
    return () => {
      offSel?.();
      offDoc?.();
      view?.dom.removeEventListener("keyup", onKey);
      document.removeEventListener("click", onKey, true);
    };
  }, [editor]);
  return active;
}

function askLink(editor: Editor) {
  const url = window.prompt("Link address", "https://");
  if (url && url !== "https://") editor.createLink(url);
}

/** Toolbar pinned above the keyboard while the note is being edited. */
export function MobileToolbar({ editor, blocks, links }: { editor: Editor; blocks: () => DefaultReactSuggestionItem[]; links: (q: string) => DefaultReactSuggestionItem[] }) {
  const [editing, setEditing] = useState(false);
  const [turnInto, setTurnInto] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<null | "color" | "link" | "table">(null);
  const active = useActive(editor);

  useEffect(() => {
    const root = editor.domElement;
    if (!root) return;
    const on = () => setEditing(true);
    // Focus moving to our own toolbar or sheets is still "editing".
    const off = (e: FocusEvent) => !(e.relatedTarget as Element | null)?.closest(".ocme-bar, .ocme-sheet") && setEditing(false);
    root.addEventListener("focusin", on);
    root.addEventListener("focusout", off);
    return () => {
      root.removeEventListener("focusin", on);
      root.removeEventListener("focusout", off);
    };
  }, [editor]);

  // Keep the caret above the keyboard + toolbar while typing.
  useEffect(() => {
    if (!editing) return;
    const keep = () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const limit = (window.visualViewport?.height ?? window.innerHeight) - 72;
      if (rect.bottom > limit) (editor.domElement?.closest(".overflow-y-auto") ?? document.scrollingElement)?.scrollBy({ top: rect.bottom - limit + 24, behavior: "smooth" });
    };
    const offSel = editor.onSelectionChange(keep);
    window.visualViewport?.addEventListener("resize", keep);
    return () => {
      offSel?.();
      window.visualViewport?.removeEventListener("resize", keep);
    };
  }, [editing, editor]);

  if (!editing && !turnInto && !adding && !sheet) return null;
  const tap = (fn: () => void) => press(fn);
  const style = (s: Record<string, unknown>) => () => editor.toggleStyles(s as never);
  const on = (k: keyof typeof active) => ({ className: active[k] ? "on" : undefined, "aria-pressed": active[k] });
  const block = editor.getTextCursorPosition().block;

  return (
    <>
      <div className="ocme-bar" role="toolbar" aria-label="Formatting">
        <button aria-label="Add block" className="ocme-add" {...tap(() => (freshLine(editor), setAdding(true)))}>
          <Plus size={20} />
        </button>
        <button aria-label="Turn into" className="ocme-aa" {...tap(() => setTurnInto(true))}>
          Aa
        </button>
        <span className="ocme-sep" />
        <button aria-label="Bold" {...on("bold")} {...tap(style({ bold: true }))}><Bold size={19} /></button>
        <button aria-label="Italic" {...on("italic")} {...tap(style({ italic: true }))}><Italic size={19} /></button>
        <button aria-label="Underline" {...on("underline")} {...tap(style({ underline: true }))}><Underline size={19} /></button>
        <button aria-label="Strikethrough" {...on("strike")} {...tap(style({ strike: true }))}><Strikethrough size={19} /></button>
        <button aria-label="Highlight" {...on("highlight")} {...tap(style({ backgroundColor: "yellow" }))}><Highlighter size={19} /></button>
        <button aria-label="Colour" {...on("color")} {...tap(() => setSheet("color"))}><Palette size={19} /></button>
        <button aria-label="Link" {...on("link")} {...tap(() => askLink(editor))}><Link size={19} /></button>
        <button aria-label="Link to page" {...tap(() => setSheet("link"))}><FileSymlink size={19} /></button>
        {block?.type === "table" && (
          <button aria-label="Table rows and columns" className="on" {...tap(() => setSheet("table"))}><Table2 size={19} /></button>
        )}
        <span className="ocme-sep" />
        <button aria-label="Indent" disabled={!editor.canNestBlock()} {...tap(() => editor.nestBlock())}><IndentIncrease size={19} /></button>
        <button aria-label="Outdent" disabled={!editor.canUnnestBlock()} {...tap(() => editor.unnestBlock())}><IndentDecrease size={19} /></button>
        <span className="ocme-sep" />
        <button aria-label="Undo" {...tap(() => editor.undo())}><Undo2 size={19} /></button>
        <button aria-label="Redo" {...tap(() => editor.redo())}><Redo2 size={19} /></button>
        <button aria-label="Hide keyboard" {...tap(() => (document.activeElement as HTMLElement | null)?.blur())}><ChevronDown size={20} /></button>
      </div>
      {turnInto && block && <TurnIntoSheet editor={editor} onClose={() => setTurnInto(false)} />}
      {adding && <BlockSheet items={[...attachItems(editor), ...blocks()]} onClose={() => setAdding(false)} />}
      {sheet === "color" && <ColorSheet editor={editor} onClose={() => setSheet(null)} />}
      {sheet === "link" && <LinkPageSheet editor={editor} links={links} onClose={() => setSheet(null)} />}
      {sheet === "table" && <TableSheet editor={editor} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Small popup over selected text: bold, italic, highlight, link. */
export function MobileSelectionPopup() {
  const editor = useBlockNoteEditor() as Editor;
  // BlockNote also shows its toolbar after a plain tap; only show this for real selections.
  const [hasText, setHasText] = useState(() => !!editor.getSelectedText());
  // Placed just above the selected text (BlockNote's own placement landed on the toolbar).
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(
    () =>
      editor.onSelectionChange(() => {
        const text = !!editor.getSelectedText();
        setHasText(text);
        const sel = window.getSelection();
        if (!text || !sel?.rangeCount) return setAt(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        const half = 86; // half the popup's width
        setAt({ x: Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8), y: Math.max(r.top - 52, 8) });
      }),
    [editor],
  );
  const active = useActive(editor);
  const on = (k: keyof typeof active) => ({ className: active[k] ? "on" : undefined, "aria-pressed": active[k] });
  const tap = (fn: () => void) => press(fn);
  if (!hasText || !at) return null;
  return createPortal(
    <div className="ocme-pop" style={{ left: at.x, top: at.y }}>
      <button aria-label="Bold" {...on("bold")} {...tap(() => editor.toggleStyles({ bold: true } as never))}><Bold size={18} /></button>
      <button aria-label="Italic" {...on("italic")} {...tap(() => editor.toggleStyles({ italic: true } as never))}><Italic size={18} /></button>
      <button aria-label="Highlight" {...on("highlight")} {...tap(() => editor.toggleStyles({ backgroundColor: "yellow" } as never))}><Highlighter size={18} /></button>
      <button aria-label="Link" {...on("link")} {...tap(() => askLink(editor))}><Link size={18} /></button>
    </div>,
    document.body,
  );
}
