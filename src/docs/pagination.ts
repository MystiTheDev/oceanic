import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Word-style pages over one continuous editor: blocks that would cross the
 * bottom margin get a top spacer (node decoration) pushing them onto the next
 * page card. Blocks that cannot sit whole on a page (a big table or figure)
 * stay in the flow and cross the seam like Word's non-repeating tables —
 * paginate() returns the seams they cross so DocEditor can white-out the
 * inter-card gap there ("bridges"), keeping the paper looking continuous.
 * Page cards themselves are drawn behind the editor by DocEditor.
 */
export const pageKey = new PluginKey<DecorationSet>("oc-pages");

export const Pagination = Extension.create({
  name: "pagination",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pageKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => (tr.getMeta(pageKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => pageKey.getState(state) },
      }),
    ];
  },
});

/** White band over the card gap where content flows across a seam. */
export type Bridge = { top: number; bottom: number };

/** Lays out pages; returns the page count (bridges kept for API, unused).
    `stride` = page height + gap, `content` = usable height per page (px),
    `zoom` = current scale (rects are measured in zoomed px). Tables split
    between rows like Word: later rows are shifted down onto the next page. */
export function paginate(editor: Editor, stride: number, content: number, _pagesEl?: HTMLElement | null, zoom = 1): { pages: number; bridges: Bridge[] } {
  const { view } = editor;
  const setDecos = (decos: Decoration[]) =>
    view.dispatch(view.state.tr.setMeta(pageKey, DecorationSet.create(view.state.doc, decos)).setMeta("addToHistory", false));

  // 1. Natural layout (no spacers), measured synchronously — no flicker.
  setDecos([]);
  const origin = view.dom.getBoundingClientRect().top;
  const y = (r: DOMRect) => ({ top: (r.top - origin) / zoom, bottom: (r.bottom - origin) / zoom });

  const decos: Decoration[] = [];
  let shift = 0;
  let page = 0;
  let forceNext = false;
  /** Pushes something starting at `top` onto the next page; returns the gap. */
  const nextPage = (top: number) => {
    page = Math.floor(top / stride) + 1;
    return page * stride - top;
  };
  const overflows = (top: number, bottom: number) => {
    const start = page * stride;
    return bottom > start + content && top > start + 1 && bottom - top <= content;
  };

  view.state.doc.forEach((node, pos) => {
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el?.getBoundingClientRect) return;
    const box = y(el.getBoundingClientRect());
    const margin = parseFloat(getComputedStyle(el).marginTop) || 0;

    if (node.type.name === "table") {
      // Split between rows: each row that would cross the page edge (and every
      // row after it) is translated down; the table's bottom margin grows by
      // the same amount so following blocks keep their place.
      if (forceNext) {
        const gap = nextPage(box.top + shift);
        shift += gap;
        decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `margin-top: ${gap + margin}px !important` }));
      }
      const rows = [...el.querySelectorAll("tr")];
      let rowShift = 0;
      let rowPos = pos + 1;
      node.forEach((row, offset, i) => {
        const r = rows[i] && y(rows[i].getBoundingClientRect());
        if (r) {
          const top = r.top + shift + rowShift;
          const bottom = r.bottom + shift + rowShift;
          if (overflows(top, bottom)) rowShift += nextPage(top);
          else page = Math.max(page, Math.floor((bottom - 1) / stride));
          if (rowShift) decos.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + row.nodeSize, { style: `transform: translateY(${rowShift}px)` }));
        }
        rowPos += row.nodeSize;
      });
      if (rowShift) {
        const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
        decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `margin-bottom: ${rowShift + mb}px !important` }));
        shift += rowShift;
      }
      forceNext = false;
      return;
    }

    const top = box.top + shift;
    const bottom = box.bottom + shift;
    if (forceNext || overflows(top, bottom)) {
      const gap = nextPage(top);
      shift += gap;
      // The spacer replaces the block's own top margin, so add it back.
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `margin-top: ${gap + margin}px !important` }));
    }
    forceNext = node.type.name === "pageBreak";
    page = Math.max(page, Math.floor((box.bottom + shift - 1) / stride));
  });

  setDecos(decos);
  return { pages: page + 1, bridges: [] };
}
