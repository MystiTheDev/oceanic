import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageAnnotator } from "./ImageAnnotator";
import { copyImageToClipboard } from "../lib/clipboard";
import { CheckSquare, Layers, Network } from "lucide-react";
import { ReviewModal } from "./ReviewModal";
import { blockText, dueCards, useSrs } from "../lib/srs";
import { api } from "../data/api";
import { PageOutline } from "./PageOutline";
import { importAudioFile, insertTimestamp, isAudioFile, uploadFile } from "../editor/audio";
import { importPdfFile, isPdfFile } from "../pdf/importPdf";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useCreateBlockNote,
  useSelectedBlocks,
} from "@blocknote/react";
import { NeridaMark } from "./NeridaOrb";
import { openNeridaCards } from "./NeridaCards";
import { openNeridaEdit } from "../lib/neridaEdit";
import { TextSelection } from "prosemirror-state";
import { BlockNoteView } from "@blocknote/mantine";
import type { Block, PartialBlock } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { ToolbarOverflow } from "./ToolbarOverflow";
import { Backlinks } from "./Backlinks";
import { EmojiPicker } from "./EmojiPicker";
import { PageBanner } from "./PageBanner";
import { useBanner } from "../lib/banners";
import { FontButton } from "./FontButton";
import { fontStack } from "../lib/fonts";
import { BlockHandleMenu } from "./BlockHandleMenu";
import { getSeedBlocks, type PageMeta } from "../data/workspace";
import { editorExtensions, getPageLinkItems, getSlashItems, schema } from "../editor/schema";
import { editorContextMenu } from "../editor/editorMenu";
import { openContextMenu } from "./ContextMenu";

type PageEditorProps = {
  page: PageMeta;
  /** Previously edited content for this page, if any. */
  doc: PartialBlock[] | undefined;
  onTitleChange: (id: string, title: string) => void;
  onDocChange: (id: string, blocks: Block[]) => void;
  onIconChange: (id: string, icon: string) => void;
  /** Bumped after each save so the backlinks line refetches. */
  linksVersion: number;
  /** Date / Status / Tags rows, rendered under the title. */
  properties?: React.ReactNode;
  /** Page font from the ⋯ menu (Default / Serif / Mono / Dyslexic / Handwriting). */
  font?: string;
};

// Notion's color menu headings read "Text color" / "Background color".
const dictionary = {
  ...en,
  color_picker: {
    ...en.color_picker,
    text_title: "Text color",
    background_title: "Background color",
  },
};

/**
 * Notion-style selection menu: grouped controls split by hairlines, no
 * alignment buttons. Hidden for blocks without text (equations, images…),
 * where every control would be empty.
 */
function SelectionToolbar() {
  const blocks = useSelectedBlocks();
  if (blocks.every((b) => b.content === undefined)) return null;
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="blockType" />
      <span key="d1" className="oc-toolbar-divider" />
      <CreateLinkButton key="link" />
      <span key="d2" className="oc-toolbar-divider" />
      <BasicTextStyleButton key="bold" basicTextStyle="bold" />
      <BasicTextStyleButton key="italic" basicTextStyle="italic" />
      <BasicTextStyleButton key="underline" basicTextStyle="underline" />
      <BasicTextStyleButton key="strike" basicTextStyle="strike" />
      <BasicTextStyleButton key="code" basicTextStyle="code" />
      <span key="d3" className="oc-toolbar-divider" />
      <FontButton key="font" />
      <ColorStyleButton key="color" />
      <span key="d4" className="oc-toolbar-divider" />
      <EditWithNerida key="nerida-edit" />
      <CardsFromSelection key="nerida" />
      <ToolbarOverflow key="more" />
    </FormattingToolbar>
  );
}


/** Selection toolbar: Nerida rewrites / fixes / custom-edits the selection, previewed before it replaces it. */
function EditWithNerida() {
  const editor = useBlockNoteEditor();
  return (
    <button type="button" title="Edit with Nerida" className="oc-toolbar-btn flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.08]"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const view = editor.prosemirrorView;
        const text = editor.getSelectedText().trim();
        if (!view || !text) return;
        const { from, to } = view.state.selection;
        const r = e.currentTarget.getBoundingClientRect();
        // Re-select the original range first: the popup steals focus.
        const select = () => (editor.focus(), view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, Math.min(to, view.state.doc.content.size)))));
        openNeridaEdit({
          text, x: r.left, y: r.bottom + 6,
          replace: (t) => (select(), editor.pasteMarkdown(t)),
          insertBelow: (t) => {
            select();
            const blocks = editor.tryParseMarkdownToBlocks(t);
            const sel = editor.getSelection()?.blocks;
            if (blocks.length) editor.insertBlocks(blocks as never, sel?.[sel.length - 1] ?? editor.getTextCursorPosition().block, "after");
          },
        });
      }}>
      <NeridaMark size={15} /> Edit
    </button>
  );
}

/** Selection toolbar: Nerida flashcards from the selected text (PageEditor adds the page id). */
function CardsFromSelection() {
  const editor = useBlockNoteEditor();
  return (
    <button type="button" title="Make flashcards from selection (Nerida)" className="oc-toolbar-btn flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.08]"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => window.dispatchEvent(new CustomEvent("oc-nerida-selection-cards", { detail: editor.getSelectedText() }))}>
      <NeridaMark size={15} /> Flashcards
    </button>
  );
}

const handledDrops = new WeakSet<DataTransfer>();

/** Nerida replies → note: "$…$" becomes inline math, a "$$…$$" paragraph a math block. */
type MdText = { type: string; text?: string; styles?: object };
export type MdBlock = { type: string; content?: MdText[] | unknown; children?: MdBlock[] };
const MATH = /\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
export function withMath(blocks: MdBlock[]): MdBlock[] {
  return blocks.map((b) => {
    const content = Array.isArray(b.content) ? (b.content as MdText[]) : null;
    const whole = content?.length === 1 && content[0].type === "text" ? content[0].text!.trim().match(/^\$\$([\s\S]+)\$\$$/) : null;
    if (whole) return { type: "math", props: { latex: whole[1].trim() } } as MdBlock;
    const next = content?.flatMap((c) => {
      if (c.type !== "text" || !c.text?.includes("$")) return [c];
      const out: unknown[] = [];
      let last = 0;
      for (const m of c.text.matchAll(MATH)) {
        if (m.index! > last) out.push({ ...c, text: c.text.slice(last, m.index) });
        // Plain numbers ("$6.53$") stay text.
        out.push(/^-?[\d.,]+$/.test(m[1]) ? { ...c, text: m[1] } : { type: "inlineMath", props: { latex: m[1] } });
        last = m.index! + m[0].length;
      }
      if (last < c.text.length) out.push({ ...c, text: c.text.slice(last) });
      return out as MdText[];
    });
    return { ...b, ...(next ? { content: next } : {}), ...(b.children?.length ? { children: withMath(b.children) } : {}) };
  });
}

export function PageEditor({
  page,
  doc,
  onTitleChange,
  onDocChange,
  onIconChange,
  linksVersion,
  properties,
  font,
}: PageEditorProps) {
  // One editor per open page — remounted (keyed) whenever the active tab changes.
  const editor = useCreateBlockNote({
    schema,
    initialContent: (doc ?? getSeedBlocks(page.id)) as never,
    dictionary,
    extensions: editorExtensions,
    uploadFile,
  });

  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const hasBanner = !!useBanner(page.id);
  // Notion's "Get started with" bar shows while the body is empty.
  const [empty, setEmpty] = useState(() => isEmptyDoc(editor.document as Block[]));
  const scroller = useRef<HTMLDivElement>(null);

  // Picture annotation: hover button (top-right of an image) or right-click → Annotate….
  const [annotating, setAnnotating] = useState<{ id: string; url: string } | null>(null);
  const [hoverImg, setHoverImg] = useState<{ id: string; url: string; x: number; y: number } | null>(null);
  // Nerida "Insert into note": Markdown reply goes in after the caret's block.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const blocks = withMath(editor.tryParseMarkdownToBlocks((e as CustomEvent<string>).detail) as unknown as MdBlock[]);
      if (blocks.length) editor.insertBlocks(blocks as never, editor.getTextCursorPosition().block, "after");
    };
    window.addEventListener("oc-nerida-insert", onInsert);
    return () => window.removeEventListener("oc-nerida-insert", onInsert);
  }, [editor]);

  // Nerida flashcards: selection → generator for this page; saved cards → the "Flashcards" toggle at the end.
  useEffect(() => {
    const onSel = (e: Event) => {
      const text = (e as CustomEvent<string>).detail?.trim();
      if (text && editor.isFocused?.() !== false) openNeridaCards({ pageId: page.id, selection: text });
    };
    const onSave = (e: Event) => {
      const detail = (e as CustomEvent<{ pageId: string; cards: string[]; handled?: boolean }>).detail;
      const { pageId, cards } = detail;
      if (pageId !== page.id || detail.handled) return;
      detail.handled = true;
      const doc = editor.document as Block[];
      const toggle = doc.find((b) => b.type === "toggleListItem" && blockText(b).trim() === "Flashcards");
      const have = new Set((toggle?.children ?? []).map((c) => blockText(c).split(" :: ")[0].trim().toLowerCase()));
      const fresh = cards.filter((c) => !have.has(c.split(" :: ")[0].trim().toLowerCase()));
      if (!fresh.length) return;
      const items = fresh.map((t) => ({ type: "bulletListItem", content: t }));
      if (!toggle) editor.insertBlocks([{ type: "toggleListItem", content: "Flashcards", children: items }] as never, doc[doc.length - 1], "after");
      else if (toggle.children.length) editor.insertBlocks(items as never, toggle.children[toggle.children.length - 1], "after");
      else editor.updateBlock(toggle, { children: items } as never);
    };
    window.addEventListener("oc-nerida-selection-cards", onSel);
    window.addEventListener("oc-nerida-cards", onSave);
    return () => (window.removeEventListener("oc-nerida-selection-cards", onSel), window.removeEventListener("oc-nerida-cards", onSave));
  }, [editor, page.id]);

  // Flashcard "Open in note": caret + scroll to the block once it's in this editor.
  useEffect(() => {
    const jump = () => setTimeout(() => {
      const id = pendingJump;
      if (!id || !editor.getBlock(id)) return;
      pendingJump = null;
      editor.setTextCursorPosition(id, "end");
      editor.focus();
      document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    jump();
    window.addEventListener("oc-open-block", jump);
    return () => window.removeEventListener("oc-open-block", jump);
  }, [editor]);
  useEffect(() => {
    const on = (e: Event) => setAnnotating((e as CustomEvent).detail);
    window.addEventListener("oc-annotate", on);
    return () => window.removeEventListener("oc-annotate", on);
  }, []);
  const trackImage = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest?.("[data-content-type='image'] img") as HTMLImageElement | null;
    const id = img?.closest("[data-id]")?.getAttribute("data-id");
    if (!img || !id) return;
    const r = img.getBoundingClientRect();
    const block = editor.getBlock(id) as { props?: { url?: string } } | undefined;
    if (block?.props?.url) setHoverImg({ id, url: block.props.url, x: r.right - 8, y: r.top + 8 });
  };

  /** Pasted or dropped images become image blocks (resize by dragging its edges; caption via right-click). */
  const insertImages = async (files: File[]) => {
    let after = editor.getTextCursorPosition().block;
    for (const f of files) {
      const url = await uploadFile(f).catch(() => null);
      if (!url) continue;
      const [inserted] = editor.insertBlocks([{ type: "image", props: { url, name: f.name, previewWidth: 512 } }] as never, after, "after");
      after = inserted;
    }
  };

  /** Pasted or dropped PDFs become preview cards (the import finishes in the background). */
  const insertPdfs = async (files: File[]) => {
    let after = editor.getTextCursorPosition().block;
    for (const f of files) {
      const doc = await importPdfFile(f).catch((e) => (console.error("PDF import failed", e), null));
      if (!doc) continue;
      const [inserted] = editor.insertBlocks([{ type: "pdf", props: { docId: doc.id, name: doc.name } }] as never, after, "after");
      after = inserted;
    }
  };

  return (
    <div
      className="relative h-full"
      onKeyDownCapture={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
          e.preventDefault();
          e.stopPropagation();
          insertTimestamp(editor);
        }
      }}
      onCopyCapture={(e) => {
        // A selected picture copies as the image itself, not as a Markdown link.
        const sel = editor.prosemirrorView?.state.selection as { node?: { type: { name: string }; attrs: { url?: string } } } | undefined;
        const blocks = editor.getSelection()?.blocks;
        const url = sel?.node?.type.name === "image" ? sel.node.attrs.url : blocks?.length === 1 && blocks[0].type === "image" ? (blocks[0].props as { url?: string }).url : undefined;
        if (!url) return;
        e.preventDefault();
        e.stopPropagation();
        void copyImageToClipboard(url).catch(() => {});
      }}
      onPasteCapture={(e) => {
        const pdfs = [...e.clipboardData.files].filter(isPdfFile);
        if (pdfs.length) {
          e.preventDefault();
          e.stopPropagation();
          void insertPdfs(pdfs);
          return;
        }
        const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
        if (!images.length) return;
        e.preventDefault();
        e.stopPropagation();
        void insertImages(images);
      }}
      onDropCapture={async (e) => {
        // BlockNote re-dispatches some drops with the same DataTransfer: handle each once.
        if (handledDrops.has(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const pdfs = [...e.dataTransfer.files].filter(isPdfFile);
        if (pdfs.length) {
          e.preventDefault();
          e.stopPropagation();
          handledDrops.add(e.dataTransfer);
          void insertPdfs(pdfs);
          return;
        }
        const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (images.length) {
          e.preventDefault();
          e.stopPropagation();
          handledDrops.add(e.dataTransfer);
          void insertImages(images);
          return;
        }
        const files = [...e.dataTransfer.files].filter(isAudioFile);
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        handledDrops.add(e.dataTransfer);
        const after = editor.getTextCursorPosition().block;
        for (const f of files) {
          const asset = await importAudioFile(f).catch(() => null);
          if (asset) editor.insertBlocks([{ type: "lectureAudio", props: { src: asset.path, name: asset.name } }] as never, after, "after");
        }
      }}
    >
    <div
      ref={scroller}
      onMouseMove={trackImage}
      onMouseLeave={(e) => !(e.relatedTarget as HTMLElement | null)?.closest?.("button") && setHoverImg(null)}
      onScroll={() => setHoverImg(null)}
      className="oc-page-in oc-page-font scrollbar-thin h-full overflow-y-auto overflow-x-hidden"
      style={{ "--oc-page-font": fontStack(font) } as React.CSSProperties}
    >
      <div className="oc-banner-zone">
      <PageBanner pageId={page.id} />
      <div className={`mx-auto flex w-full flex-col px-10 max-w-3xl pb-32 ${hasBanner ? "-mt-9 relative" : "pt-4"}`}>
        {/* Page icon */}
        <button
          type="button"
          title="Change icon"
          onClick={(e) => {
            const el = e.currentTarget;
            setIconAnchor((a) => (a ? null : el));
          }}
          className="mb-1 grid size-16 cursor-pointer place-items-center rounded-xl text-5xl leading-none transition-colors duration-200 hover:bg-white/5"
        >
          {page.icon}
        </button>
        {iconAnchor && (
          <EmojiPicker
            anchor={iconAnchor}
            onSelect={(icon) => onIconChange(page.id, icon)}
            onClose={() => setIconAnchor(null)}
          />
        )}

        {/* Frameless title */}
        <input
          value={page.title}
          onChange={(e) => onTitleChange(page.id, e.target.value)}
          placeholder="Untitled"
          data-page-title
          spellCheck={false}
          className="mb-1 w-full bg-transparent text-4xl font-bold tracking-tight text-neutral-50 outline-none placeholder:text-neutral-700"
        />

        {/* Notion: "N backlinks" sits right under the title */}
        {properties}
        <Backlinks pageId={page.id} version={linksVersion} />
        <PageFlashcards page={page} />
        <div className="mb-2" />

        {/* BlockNote canvas (dark); right-click opens Oceanic's block menu */}
        <div
          onContextMenu={(e) => {
            const items = editorContextMenu(editor, e, page.id);
            if (items) openContextMenu(e, items);
          }}
        >
        <BlockNoteView
          editor={editor}
          theme="dark"
          onChange={() => {
            onDocChange(page.id, editor.document as Block[]);
            setEmpty(isEmptyDoc(editor.document as Block[]));
          }}
          formattingToolbar={false}
          slashMenu={false}
          sideMenu={false}
        >
          <SideMenuController
            sideMenu={(props) => <SideMenu {...props} dragHandleMenu={BlockHandleMenu} />}
          />
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => getSlashItems(editor, query)}
          />
          {/* Link to page: `[[` (wiki-style) and `@` (Notion's mention) */}
          <SuggestionMenuController
            triggerCharacter="[["
            getItems={async (query) => getPageLinkItems(editor, query, page.id)}
          />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) => getPageLinkItems(editor, query, page.id)}
          />
          <FormattingToolbarController formattingToolbar={SelectionToolbar} />
        </BlockNoteView>
        </div>
      </div>
      </div>
    </div>
    <PageOutline editor={editor} scroller={scroller} />
    {hoverImg && !annotating && (
      <button
        type="button"
        onMouseEnter={() => setHoverImg(hoverImg)}
        onClick={() => setAnnotating({ id: hoverImg.id, url: hoverImg.url })}
        className="oc-fade-in fixed z-40 flex h-7 -translate-x-full cursor-pointer items-center gap-1.5 rounded-md bg-black/70 px-2.5 text-[12px] font-medium text-white shadow-lg backdrop-blur hover:bg-black/85"
        style={{ left: hoverImg.x, top: hoverImg.y }}
      >
        ✎ Annotate
      </button>
    )}
    {annotating && (
      <ImageAnnotator
        url={annotating.url}
        onClose={() => setAnnotating(null)}
        onSave={(url) => editor.updateBlock(annotating.id, { props: { url } } as never)}
      />
    )}
    {empty && (
      <div className="oc-fade-in pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
        <div className="pointer-events-auto w-full max-w-[720px]">
          <p className="mb-2 text-[12px] text-neutral-500">Get started with</p>
          <div className="flex flex-wrap gap-2">
            <StartPill
              icon={<CheckSquare className="size-4" />}
              label="To-do list"
              onClick={() => {
                editor.replaceBlocks([editor.document[0]], [{ type: "checkListItem" }] as never);
                editor.focus();
              }}
            />
            <StartPill
              icon={<Network className="size-4" />}
              label="Mindmap"
              onClick={async () => {
                const m = await api.createMindmap("", "");
                const first = editor.document[0];
                editor.replaceBlocks([first], [{ type: "mindmapEmbed", props: { mindmapId: m.id } } as never, { type: "paragraph" }]);
              }}
            />
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

/** Only empty paragraphs (what a new page starts with). */
function isEmptyDoc(doc: Block[]) {
  return doc.every((b) => b.type === "paragraph" && !(b.content as unknown[])?.length && !b.children.length);
}

function StartPill({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[14px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.1]"
    >
      <span className="text-neutral-400">{icon}</span>
      {label}
    </button>
  );
}

/** Block to jump to once its page's editor mounts (set before App switches tabs). */
let pendingJump: string | null = null;
window.addEventListener("oc-open-block", (e) => (pendingJump = (e as CustomEvent<{ blockId: string }>).detail.blockId));

/** "🃏 5 cards due · Study" under the title, when the page has flashcards. */
function PageFlashcards({ page }: { page: PageMeta }) {
  const { cards, marked } = useSrs();
  const [open, setOpen] = useState<null | "due" | "practice">(null);
  const all = Object.values(cards).filter((c) => c.pageId === page.id);
  // 🃏 in the left margin of every card / marked block.
  const ids = [...new Set([...marked, ...all.map((c) => c.blockId)])];
  const sel = (after = "") => ids.map((id) => `[data-id="${id}"]>.bn-block>.bn-block-content${after}`).join(",");
  const marker = ids.length ? <style>{`${sel()}{position:relative}${sel("::before")}{content:"🃏";position:absolute;left:-1.6em;font-size:.8em;opacity:.6}`}</style> : null;
  if (!all.length) return marker;
  const due = dueCards(cards, page.id).length;
  return (
    <>
      {marker}
      <div className="mb-1 flex items-center">
      <button
        type="button"
        disabled={!due}
        onClick={() => setOpen("due")}
        className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md disabled:cursor-default px-1.5 py-0.5 text-[12px] text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
      >
        <Layers className="size-3.5" /> {all.length} flashcard{all.length === 1 ? "" : "s"} · {due ? <span className="text-emerald-400">{due} due · Study</span> : "none due"}
      </button>
      <button type="button" onClick={() => setOpen("practice")} className="cursor-pointer rounded-md px-1.5 py-0.5 text-[12px] text-neutral-500 hover:bg-white/5 hover:text-neutral-300">
        · Practice
      </button>
      </div>
      {open && <ReviewModal pages={[page]} pageId={page.id} practice={open === "practice"} onClose={() => setOpen(null)} />}
    </>
  );
}
