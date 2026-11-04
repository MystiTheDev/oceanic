import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageAnnotator } from "./ImageAnnotator";
import { copyImageToClipboard } from "../lib/clipboard";
import { CheckSquare, Network } from "lucide-react";
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
  useCreateBlockNote,
  useSelectedBlocks,
} from "@blocknote/react";
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
      <ToolbarOverflow key="more" />
    </FormattingToolbar>
  );
}


const handledDrops = new WeakSet<DataTransfer>();

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
        <div className="mb-2" />

        {/* BlockNote canvas (dark); right-click opens Oceanic's block menu */}
        <div
          onContextMenu={(e) => {
            const items = editorContextMenu(editor, e);
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
