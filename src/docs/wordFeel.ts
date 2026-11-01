import { Extension, InputRule, type Editor } from "@tiptap/core";

/** Align the paragraph; a selected floating picture drops back in line so the alignment applies to it. */
export const alignTo = (editor: Editor, a: string) => {
  if (!editor.isActive("image")) return void editor.chain().focus().setTextAlign(a).run();
  // A selected picture: align the paragraph that holds it (and drop any float).
  editor
    .chain()
    .focus()
    .updateAttributes("image", { float: null })
    .command(({ tr }) => {
      const $from = tr.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "paragraph" || node.type.name === "heading") {
          tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, textAlign: a });
          return true;
        }
      }
      return false;
    })
    .run();
};


/**
 * Word-like typing and shortcuts:
 * - smart quotes, `--` → em dash, auto-capitalised sentences
 * - Tab / Shift+Tab: indent list items, otherwise insert a tab
 * - Ctrl+E/L/R/J alignment, Ctrl+1/2/5 line spacing, Ctrl+Alt+1–3 headings, Ctrl+Alt+0 normal
 */
export const WordFeel = Extension.create({
  name: "wordFeel",

  addInputRules() {
    const quote = (find: RegExp, open: string, close: string) =>
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const before = match[1] ?? "";
          // Opening after start/space/bracket, closing otherwise.
          const isOpen = !before || /[\s([{—-]$/.test(before);
          state.tr.insertText(before + (isOpen ? open : close), range.from, range.to);
        },
      });
    return [
      new InputRule({ find: /--$/, handler: ({ state, range }) => void state.tr.insertText("—", range.from, range.to) }),
      quote(/(^|.)"$/, "“", "”"),
      quote(/(^|.)'$/, "‘", "’"),
      // Capitalise a sentence's first letter once it's followed by a space.
      new InputRule({
        find: /(?:^|[.!?]\s+)([a-z])(\S*)\s$/,
        handler: ({ state, range, match }) => {
          const word = match[1] + match[2];
          // Leave things like "e.g." or URLs alone.
          if (/[.@/:]/.test(match[2])) return null;
          const start = range.to - word.length; // the typed space is not in the doc yet
          state.tr.insertText(word[0].toUpperCase() + word.slice(1) + " ", start, range.to);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const e = this.editor;
    const align = (a: string) => () => (alignTo(e, a), true);
    const spacing = (v: string) => () => e.chain().focus().setLineHeight(v).run();
    const heading = (level: 1 | 2 | 3 | 4) => () => e.chain().focus().setHeading({ level }).run();
    return {
      Tab: () => (e.isActive("listItem") ? e.commands.sinkListItem("listItem") || true : e.commands.insertContent("\t")),
      "Shift-Tab": () => (e.isActive("listItem") ? e.commands.liftListItem("listItem") || true : true),
      "Mod-e": align("center"),
      "Mod-l": align("left"),
      "Mod-r": align("right"),
      "Mod-j": align("justify"),
      "Mod-1": spacing("1"),
      "Mod-2": spacing("2"),
      "Mod-5": spacing("1.5"),
      "Mod-Alt-1": heading(2),
      "Mod-Alt-2": heading(3),
      "Mod-Alt-3": heading(4),
      "Mod-Alt-0": () => e.chain().focus().setParagraph().run(),
      "Mod-k": () => {
        const href = window.prompt("Link address", e.getAttributes("link").href ?? "https://");
        if (href === null) return true;
        return href ? e.chain().focus().extendMarkRange("link").setLink({ href }).run() : e.chain().focus().unsetLink().run();
      },
    };
  },
});
