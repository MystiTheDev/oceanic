/* ---------------------------------------------------------------------------
 * Oceanic's BlockNote schema: the default blocks plus
 *   • pageLink   — inline `[[page]]` / `@page` reference chip
 *   • inlineMath — inline KaTeX, typed as `$E = mc^2$`
 *   • math       — standalone equation block (`/equation`)
 *   • pdf        — PDF preview card that opens the reader (`/pdf`)
 * ------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from "react";
import {
  BlockNoteSchema,
  createExtension,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
  type BlockNoteEditor,
} from "@blocknote/core";
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  createReactStyleSpec,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { Plugin } from "prosemirror-state";
import katex from "katex";
import "katex/dist/katex.min.css";
import { FileText, Layers, ListTree, Music, Network, Sigma, SquareFunction } from "lucide-react";
import { openNeridaOutline } from "../components/NeridaOutlineUI";
import { isMarked, toggleMarked } from "../lib/srs";
import { usePageDirectory, pageDirectory } from "./pageDirectory";
import { fontStack } from "../lib/fonts";
import { LectureAudio, Timestamp } from "./audio";
import { MindmapEmbed } from "./mindmapBlock";
import { FileEmbed } from "./fileEmbedBlock";
import { spellPlugin } from "../lib/spell/plugin";
import { DatabaseBlock } from "./databaseBlock";
import { PdfBlock } from "../pdf/PdfBlock";
import { PdfRef } from "../pdf/PdfRef";

/* ------------------------------------------------------------------ KaTeX */
function renderTex(latex: string, displayMode: boolean) {
  try {
    return { html: katex.renderToString(latex, { displayMode, throwOnError: true }), error: null };
  } catch (e) {
    return { html: "", error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : "Invalid TeX" };
  }
}

/** TeX editor popover shared by inline and block math: input + live preview. */
function TexEditor({
  initial,
  display,
  onDone,
  onCancel,
}: {
  initial: string;
  display: boolean;
  onDone: (latex: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const preview = renderTex(value || "\\square", display);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div
      contentEditable={false}
      className="oc-pop-in oc-tex-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !display)) {
          e.preventDefault();
          onDone(value);
        }
      }}
    >
      <textarea
        ref={ref}
        value={value}
        spellCheck={false}
        rows={display ? 3 : 1}
        placeholder={display ? "\\int_0^\\infty e^{-x^2}\\,dx" : "E = mc^2"}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="oc-tex-preview">
        {preview.error ? (
          <span className="oc-tex-error">{preview.error}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: preview.html }} />
        )}
      </div>
      <div className="oc-tex-actions">
        <span>{display ? "Ctrl+Enter" : "Enter"} to save · Esc to cancel</span>
        <button type="button" onClick={() => onDone(value)}>
          Done
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pageLink */
const PageLink = createReactInlineContentSpec(
  { type: "pageLink", propSchema: { pageId: { default: "" } }, content: "none" },
  {
    render: function PageLinkChip({ inlineContent }) {
      const { pages, open } = usePageDirectory();
      const page = pages.get(inlineContent.props.pageId);
      return (
        <span
          className={`oc-page-link ${page ? "" : "oc-page-link-missing"}`}
          title={page ? "Open page (Ctrl+click: new tab)" : "This page was deleted or moved to Trash"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => page && open(page.id, e.ctrlKey || e.metaKey)}
          onAuxClick={(e) => page && e.button === 1 && open(page.id, true)}
        >
          <span className="oc-page-link-icon">{page?.icon ?? "📄"}</span>
          <span className="oc-page-link-title">{page ? page.title || "Untitled" : "Deleted page"}</span>
        </span>
      );
    },
    // Exports: a plain link carrying the page title.
    toExternalHTML: ({ inlineContent }) => {
      const page = pageDirectory.get().pages.get(inlineContent.props.pageId);
      return <a href="#">{page ? `${page.icon} ${page.title || "Untitled"}` : "Deleted page"}</a>;
    },
  },
);

/* ------------------------------------------------------------- inlineMath */
const InlineMath = createReactInlineContentSpec(
  { type: "inlineMath", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: function InlineMathView({ inlineContent, updateInlineContent }) {
      const [editing, setEditing] = useState(!inlineContent.props.latex);
      const { latex } = inlineContent.props;
      const out = renderTex(latex || "\\square", false);
      return (
        <span className="oc-inline-math-wrap">
          <span
            className={`oc-inline-math ${out.error ? "oc-tex-invalid" : ""}`}
            title="Edit equation"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
            {...(out.error ? { children: latex } : { dangerouslySetInnerHTML: { __html: out.html } })}
          />
          {editing && (
            <TexEditor
              initial={latex}
              display={false}
              onCancel={() => setEditing(false)}
              onDone={(next) => {
                updateInlineContent({ type: "inlineMath", props: { latex: next } });
                setEditing(false);
              }}
            />
          )}
        </span>
      );
    },
    // Exports keep the TeX source, so Markdown round-trips as `$…$`.
    toExternalHTML: ({ inlineContent }) => <span>{`$${inlineContent.props.latex}$`}</span>,
  },
);

/* ------------------------------------------------------------- math block */
const MathBlock = createReactBlockSpec(
  { type: "math", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: function MathBlockView({ block, editor }) {
      const { latex } = block.props;
      const [editing, setEditing] = useState(!latex);
      const out = renderTex(latex, true);
      return (
        <div className="oc-math-block" contentEditable={false}>
          <div
            className={`oc-math-display ${latex ? "" : "oc-math-empty"}`}
            onClick={() => setEditing(true)}
            title="Edit equation"
          >
            {!latex ? (
              <span className="oc-math-placeholder">
                <SquareFunction className="size-4" /> Add a TeX equation
              </span>
            ) : out.error ? (
              <span className="oc-tex-error">{out.error}</span>
            ) : (
              <span dangerouslySetInnerHTML={{ __html: out.html }} />
            )}
          </div>
          {editing && (
            <TexEditor
              initial={latex}
              display
              onCancel={() => setEditing(false)}
              onDone={(next) => {
                editor.updateBlock(block, { props: { latex: next } });
                setEditing(false);
              }}
            />
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => <p>{`$$${block.props.latex}$$`}</p>,
  },
);

/* ------------------------------------------------- `$…$` → inline math */
// Pandoc/Obsidian rule: no space just inside either `$`, so "$5 and $10"
// stays plain text. Fires on the closing `$`.
const INLINE_MATH = /(^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$$/;

const inlineMathInput = createExtension({
  key: "inlineMathInput",
  prosemirrorPlugins: [
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== "$") return false;
          const { $from } = view.state.selection;
          if ($from.parent.type.spec.code) return false; // not inside code blocks
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
          const m = INLINE_MATH.exec(before + "$");
          if (!m) return false;
          const latex = m[2];
          const start = from - latex.length - 1;
          const node = view.state.schema.nodes.inlineMath?.create({ latex });
          if (!node) return false;
          view.dispatch(view.state.tr.replaceWith(start, to, node));
          return true;
        },
      },
    }),
  ],
});

/* ------------------------------------------------------------------- font */
/** Font family on selected text (selection toolbar → Font). */
const FontStyle = createReactStyleSpec(
  { type: "font", propSchema: "string" },
  {
    render: (props) => <span data-font={props.value} style={{ fontFamily: fontStack(props.value) }} ref={props.contentRef} />,
  },
);

/* ------------------------------------------------------------------ schema */
export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, math: MathBlock(), lectureAudio: LectureAudio(), mindmapEmbed: MindmapEmbed(), fileEmbed: FileEmbed(), database: DatabaseBlock(), pdf: PdfBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: PageLink, inlineMath: InlineMath, timestamp: Timestamp, pdfRef: PdfRef },
  styleSpecs: { ...defaultStyleSpecs, font: FontStyle },
});

export type OceanicEditor = typeof schema.BlockNoteEditor;
/** Offline spelling: underline + suggestions, autocorrect, completion. */
const spellAssist = createExtension({ key: "spellAssist", prosemirrorPlugins: [spellPlugin()] });
export const editorExtensions = [inlineMathInput, spellAssist];

/* -------------------------------------------------------------- menus */
/** Slash menu: BlockNote's defaults plus Equation and Inline equation. */
export function getSlashItems(editor: OceanicEditor, query: string) {
  const items: DefaultReactSuggestionItem[] = [
    ...getDefaultReactSlashMenuItems(editor as unknown as BlockNoteEditor),
    {
      title: "Flashcard",
      subtext: "Make this block a card · first line = question, rest or nested = answer",
      aliases: ["flashcard", "card", "srs", "quiz", "study", "recall"],
      group: "Study",
      icon: <Layers size={18} />,
      // Cards sync on the next edit, so marking is all that's needed.
      onItemClick: () => {
        const block = editor.getTextCursorPosition().block;
        if (!isMarked(block.id)) toggleMarked(block.id);
        // Empty line: ` :: ` template, caret on the question side.
        if (!(block.content as unknown[] | undefined)?.length) {
          editor.updateBlock(block, { content: " :: " } as never);
          editor.setTextCursorPosition(block, "start");
        }
      },
    },
    {
      title: "Outline with Nerida",
      subtext: "Essay outline from your topic and ideas",
      aliases: ["outline", "nerida", "essay", "plan", "structure", "ai"],
      group: "Nerida",
      icon: <ListTree size={18} />,
      onItemClick: () => {
        const at = editor.getTextCursorPosition().block;
        openNeridaOutline({
          topic: "",
          insert: (md) => {
            const blocks = editor.tryParseMarkdownToBlocks(md);
            if (!blocks.length) return;
            const empty = !(at.content as unknown[] | undefined)?.length;
            if (empty) editor.replaceBlocks([at], blocks as never);
            else editor.insertBlocks(blocks as never, at, "after");
          },
        });
      },
    },
    {
      title: "Mindmap",
      subtext: "Embed an Oceanic Mindmap",
      aliases: ["mindmap", "mind map", "map", "diagram", "brainstorm"],
      group: "Media",
      icon: <Network size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "mindmapEmbed" } as never),
    },
    {
      title: "Lecture audio",
      subtext: "Local audio player · Ctrl+Shift+T inserts a timestamp",
      aliases: ["audio", "lecture", "recording", "mp3", "sound", "podcast"],
      group: "Media",
      icon: <Music size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "lectureAudio" } as never),
    },
    {
      title: "PDF",
      subtext: "Read and annotate a PDF · or drop one onto the page",
      aliases: ["pdf", "document", "paper", "annotate", "reader"],
      group: "Media",
      icon: <FileText size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "pdf" } as never),
    },
    {
      title: "Equation",
      subtext: "Display a standalone mathematical equation",
      aliases: ["math", "latex", "tex", "equation", "formula", "katex"],
      group: "Advanced",
      icon: <SquareFunction size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "math" }),
    },
    {
      title: "Inline equation",
      subtext: "Math inside a line of text — or type $x^2$",
      aliases: ["inline math", "inlinemath", "latex", "tex", "$"],
      group: "Advanced",
      icon: <Sigma size={18} />,
      onItemClick: () => editor.insertInlineContent([{ type: "inlineMath", props: { latex: "" } }]),
    },
  ];
  return filterSuggestionItems(items, query);
}

/** `[[` / `@` menu: live pages, filtered by the typed query. */
export function getPageLinkItems(editor: OceanicEditor, query: string, currentPageId: string) {
  const q = query.trim().toLowerCase();
  return [...pageDirectory.get().pages.values()]
    .filter((p) => p.id !== currentPageId && (p.title || "Untitled").toLowerCase().includes(q))
    .slice(0, 12)
    .map(
      (p): DefaultReactSuggestionItem => ({
        title: p.title || "Untitled",
        group: "Link to page",
        icon: <span className="text-base leading-none">{p.icon}</span>,
        onItemClick: () =>
          editor.insertInlineContent([{ type: "pageLink", props: { pageId: p.id } }, " "]),
      }),
    );
}
