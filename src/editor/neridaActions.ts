import { TextSelection } from "prosemirror-state";
import type { BlockNoteEditor } from "@blocknote/core";
import { openNeridaEdit } from "../lib/neridaEdit";
import { blockText } from "../lib/srs";

/* Opening Nerida's AI popup from the note editor: the selection toolbar, the block (⋮⋮) menu and `/ai`.
 * Every result goes in through editor commands (one transaction each), so Ctrl+Z undoes it. */

type Ed = BlockNoteEditor<any, any, any>;

/** Re-select a range (the popup took focus), then run `fn` on it. */
const onRange = (editor: Ed, from: number, to: number, fn: () => void) => {
  const view = editor.prosemirrorView!;
  editor.focus();
  const max = view.state.doc.content.size;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(from, max), Math.min(to, max))));
  fn();
};

/** Replace the current selection. A one-paragraph result goes in as inline text, so the block keeps its
 *  type (a bullet stays a bullet, a heading a heading); anything longer is pasted as Markdown blocks. */
const replaceSelection = (editor: Ed, md: string) => {
  const blocks = editor.tryParseMarkdownToBlocks(md) as { type: string; content?: unknown; children?: unknown[] }[];
  if (blocks.length === 1 && blocks[0].type === "paragraph" && !blocks[0].children?.length && Array.isArray(blocks[0].content))
    editor.insertInlineContent(blocks[0].content as never);
  else editor.pasteMarkdown(md);
};

const insertMdBelow = (editor: Ed, md: string) => {
  const blocks = editor.tryParseMarkdownToBlocks(md);
  const sel = editor.getSelection()?.blocks;
  if (blocks.length) editor.insertBlocks(blocks as never, sel?.[sel.length - 1] ?? editor.getTextCursorPosition().block, "after");
};

/** Selected text → popup; Accept replaces the selection, Insert below adds after its last block. */
export function aiOnSelection(editor: Ed, at: { x: number; y: number }) {
  const view = editor.prosemirrorView;
  const text = editor.getSelectedText().trim();
  if (!view || !text) return;
  const { from, to } = view.state.selection;
  openNeridaEdit({
    text, ...at,
    replace: (t) => onRange(editor, from, to, () => replaceSelection(editor, t)),
    insertBelow: (t) => onRange(editor, from, to, () => insertMdBelow(editor, t)),
  });
}

/** Inline-content range of a block in the ProseMirror doc, or null (tables, images…). */
function blockRange(editor: Ed, id: string): { from: number; to: number } | null {
  let r: { from: number; to: number } | null = null;
  editor.prosemirrorView?.state.doc.descendants((node, pos) => {
    if (r) return false;
    if (node.attrs?.id !== id) return true;
    const content = node.firstChild;
    if (content?.isTextblock) r = { from: pos + 2, to: pos + 1 + content.nodeSize - 1 };
    return false;
  });
  return r;
}

/** Block menu "Ask Nerida": the whole block's text is the selection. */
export function aiOnBlock(editor: Ed, id: string) {
  const range = blockRange(editor, id);
  const block = editor.getBlock(id);
  if (!range || !block) return;
  const text = blockText(block as never).trim();
  if (!text) return aiAtCaret(editor, id);
  onRange(editor, range.from, range.to, () => {});
  const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
  openNeridaEdit({
    text, x: el?.left ?? 200, y: (el?.bottom ?? 200) + 6,
    replace: (t) => onRange(editor, range.from, range.to, () => replaceSelection(editor, t)),
    insertBelow: (t) => onRange(editor, range.from, range.to, () => insertMdBelow(editor, t)),
  });
}

/** `/ai`: free-form instruction at the caret. The note up to this block is context; the result replaces
 *  the block when it's empty, else goes after it. */
export function aiAtCaret(editor: Ed, blockId?: string) {
  const at = blockId ? editor.getBlock(blockId) : editor.getTextCursorPosition().block;
  if (!at) return;
  const doc = editor.document;
  const upTo = doc.slice(0, Math.max(0, doc.findIndex((b) => b.id === at.id)) + 1);
  const before = upTo.map((b) => blockText(b as never)).filter((t) => t.trim()).join("\n\n");
  const view = editor.prosemirrorView;
  const c = view ? view.coordsAtPos(view.state.selection.from) : null;
  openNeridaEdit({
    text: before, x: c?.left ?? 200, y: (c?.bottom ?? 200) + 6, prompt: true,
    replace: (t) => {
      const blocks = editor.tryParseMarkdownToBlocks(t);
      const cur = editor.getBlock(at.id);
      if (!blocks.length || !cur) return;
      editor.focus();
      if (!(cur.content as unknown[] | undefined)?.length) editor.replaceBlocks([cur], blocks as never);
      else editor.insertBlocks(blocks as never, cur, "after");
    },
  });
}
