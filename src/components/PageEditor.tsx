import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImageAnnotator } from "./ImageAnnotator";
import { copyImageToClipboard } from "../lib/clipboard";
import { Check, CheckSquare, ChevronLeft, ChevronRight, Eye, Layers, Network, X } from "lucide-react";
import { ReviewModal } from "./ReviewModal";
import { blockText, dueCards, useSrs } from "../lib/srs";
import { api } from "../data/api";
import { headingsOf, PageOutline } from "./PageOutline";
import { HEADINGS_TO_ATLAS, PromoteDialog, type PromoteItem } from "./PromoteDialog";
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
import { aiOnSelection } from "../editor/neridaActions";
import { NOTE_BLOCKS, PROPOSE, paintTable, setPending, tableToText, textToTable, usePending, type NoteBlock, type Proposal, type TableData } from "../lib/neridaChatEdit";
import { flip, offset, shift } from "@floating-ui/react";
import { AGENT_SET_DOC } from "../lib/neridaAgent";
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
import { editorExtensions, getPageLinkItems, getSlashItems, mobileEditorExtensions, schema } from "../editor/schema";
import { isAndroid, usePhoneUI, useSoftKeyboard } from "../mobile/formFactor";
import { MobileSelectionPopup, MobileToolbar } from "../mobile/MobileEditorKit";
import { editorContextMenu } from "../editor/editorMenu";
import { openContextMenu } from "./ContextMenu";
import type * as Y from "yjs";
import { withCollaboration } from "@blocknote/core/yjs";
import { FRAGMENT, liveDocs, loadDoc, RESTORE_VERSION, type RestoreDetail } from "../lib/ydoc";

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
      {!isAndroid && <EditWithNerida key="nerida-edit" />}
      {!isAndroid && <CardsFromSelection key="nerida" />}
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
        const r = e.currentTarget.getBoundingClientRect();
        aiOnSelection(editor as never, { x: r.left, y: r.bottom + 6 });
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

/** Pending Nerida edits (blue blocks below): accept or reject each, or all. */
function NeridaChangesBar({ n: live }: { n: number }) {
  const p = usePending();
  const [cur, setCur] = useState(0);
  // Stay mounted briefly after the last change goes, so the bar can slide out.
  const [n, setN] = useState(live);
  useEffect(() => {
    if (live) return setN(live);
    const t = setTimeout(() => setN(0), 160);
    return () => clearTimeout(t);
  }, [live]);
  if (!n) return null;
  const i = Math.min(cur, n - 1);
  // Step to a change and scroll the note to it.
  const go = (to: number) => {
    const k = (to + n) % n;
    setCur(k);
    document.querySelector(`[data-id="${p.ids?.[k]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const icon = "grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-100";
  return (
    <div className={`${live ? "oc-bar-in" : "oc-bar-out"} sticky top-2 z-10 mb-3 flex h-11 items-center gap-1 rounded-xl border border-white/[0.08] bg-neutral-900/85 pl-3 pr-1.5 text-[13px] text-neutral-200 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md`}>
      <NeridaMark size={16} />
      <span className="ml-1.5 min-w-0 truncate">
        <span className="font-semibold text-neutral-100 tabular-nums">{n}</span> <span className="text-neutral-400">suggested change{n > 1 ? "s" : ""}</span>
      </span>
      <span className="ml-auto" />
      {n > 1 && (
        <>
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.03]">
            <button type="button" data-tip="Previous change" className={icon} onClick={() => go(i - 1)}><ChevronLeft className="size-4" /></button>
            <button type="button" data-tip="Show in note" className="cursor-pointer px-1 text-[12px] tabular-nums text-neutral-400 hover:text-neutral-100" onClick={() => go(i)}>{i + 1}/{n}</button>
            <button type="button" data-tip="Next change" className={icon} onClick={() => go(i + 1)}><ChevronRight className="size-4" /></button>
          </div>
          <button type="button" data-tip="Accept this change" className={icon + " hover:text-teal-300"} onClick={() => p.accept(i)}><Check className="size-4" /></button>
          <button type="button" data-tip="Reject this change" className={icon + " hover:text-rose-300"} onClick={() => p.reject(i)}><X className="size-4" /></button>
          <span className="mx-1 h-5 w-px bg-white/[0.08]" />
        </>
      )}
      <button type="button" className="h-7 cursor-pointer rounded-lg px-2.5 text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-100" onClick={() => p.reject()}>Reject{n > 1 && " all"}</button>
      <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-teal-400 px-3 font-medium text-neutral-950 shadow-[0_0_0_1px_rgba(45,212,191,0.4),0_4px_14px_-4px_rgba(45,212,191,0.5)] transition-colors hover:bg-teal-300"
        onClick={() => p.accept()}><Check className="size-3.5" />Accept{n > 1 && " all"}</button>
    </div>
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

/** Loads the page's Yjs doc (LAN sync 7c), then mounts the editor on it. */
export function PageEditor(props: PageEditorProps) {
  const [y, setY] = useState<{ doc: Y.Doc; stale: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void loadDoc(props.page.id, (props.doc ?? getSeedBlocks(props.page.id)) as PartialBlock[]).then((r) => live && setY(r));
    return () => void (live = false);
  }, [props.page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return y ? <PageEditorBody {...props} ydoc={y.doc} stale={y.stale} /> : null;
}

function PageEditorBody({
  page,
  doc,
  onTitleChange,
  onDocChange: onDocChangeRaw,
  onIconChange,
  linksVersion,
  properties,
  font,
  ydoc,
  stale,
}: PageEditorProps & { ydoc: Y.Doc; stale: boolean }) {
  const isMobile = usePhoneUI();
  const keyboard = useSoftKeyboard();
  // One editor per open page — remounted (keyed) whenever the active tab changes.
  // The body is the page's Yjs doc, so edits from another device merge in.
  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary,
      extensions: isMobile ? mobileEditorExtensions : editorExtensions,
      uploadFile,
      collaboration: { fragment: ydoc.getXmlFragment(FRAGMENT), user: { name: "", color: "transparent" } },
    }),
  );
  // Saves carry the Yjs doc while the saved body is the one the editor made.
  const onDocChange = (id: string, blocks: Block[]) => {
    liveDocs.set(id, { doc: ydoc, json: JSON.stringify(blocks), mounted: true });
    onDocChangeRaw(id, blocks);
  };
  useEffect(() => {
    liveDocs.set(page.id, { doc: ydoc, json: "", mounted: true });
    // The body changed outside the editor (another device's old-style edit, a restore): replay it.
    if (stale && doc) editor.replaceBlocks(editor.document, doc as never);
    lastDoc.current = JSON.stringify(editor.document);
    const onRestore = (e: Event) => {
      const d = (e as CustomEvent<RestoreDetail>).detail;
      if (d.pageId !== page.id) return;
      d.handled = true;
      editor.replaceBlocks(editor.document, d.blocks as never);
    };
    window.addEventListener(RESTORE_VERSION, onRestore);
    return () => {
      window.removeEventListener(RESTORE_VERSION, onRestore);
      const live = liveDocs.get(page.id);
      if (live?.doc === ydoc) live.mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const hasBanner = !!useBanner(page.id);
  // Notion's "Get started with" bar shows while the body is empty.
  const [empty, setEmpty] = useState(() => isEmptyDoc(editor.document as Block[]));
  // The body fills from the Y.Doc after mount (and on sync) without onChange: re-check then.
  useEffect(() => {
    const check = () => setEmpty(isEmptyDoc(editor.document as Block[]));
    const raf = requestAnimationFrame(check);
    ydoc.on("update", check);
    return () => (cancelAnimationFrame(raf), ydoc.off("update", check));
  }, [editor, ydoc]);
  const scroller = useRef<HTMLDivElement>(null);
  // The note body: the selection toolbar flips below the text instead of covering the properties above it.
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const toolbarFloat = useMemo(
    () => ({
      useFloatingOptions: {
        // BlockNote's defaults, but the flip boundary is the note body: on the first lines
        // the toolbar goes below the selection instead of over Date/Status/Tags.
        middleware: [offset(10), shift(), flip({ boundary: canvas ?? "clippingAncestors", crossAxis: false })],
      },
    }),
    [canvas],
  );
  // Restore last scroll spot; retry briefly while content lays out.
  useEffect(() => {
    const y = Number(localStorage.getItem(`oc-scroll:${page.id}`)) || 0;
    if (!y) return;
    let n = 0;
    const t = window.setInterval(() => {
      const el = scroller.current;
      if (el) el.scrollTop = y;
      if (++n > 20 || (el && Math.abs(el.scrollTop - y) < 2)) window.clearInterval(t);
    }, 50);
    return () => window.clearInterval(t);
  }, [page.id]);

  // Picture annotation: hover button (top-right of an image) or right-click → Annotate….
  const [annotating, setAnnotating] = useState<{ id: string; url: string; name?: string; edit?: boolean } | null>(null);
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

  // Nerida chat edits: new or changed blocks turn blue (Nerida-colour) until accepted. A replaced block is
  // changed in place (so its sub-items stay); `old` is what reject puts back.
  const [changes, setChanges] = useState<{ newId: string; old?: PartialBlock }[]>([]);
  useEffect(() => {
    const onBlocks = (e: Event) => {
      // Nested blocks too (sub-tasks under a list item), in reading order.
      const flat = (bs: Block[]): Block[] => bs.flatMap((b) => [b, ...flat((b.children ?? []) as Block[])]);
      (e as CustomEvent<{ blocks: NoteBlock[] }>).detail.blocks = flat(editor.document as Block[]).map((b) => ({ id: b.id, text: b.type === "table" ? tableToText(b) : blockText(b) +(b.type === "checkListItem" ? ((b.props as { checked?: boolean }).checked ? " [done]" : " [not done]") : ""), type: b.type }));
    };
    const onPropose = (e: Event) => {
      const d = (e as CustomEvent<{ proposals: Proposal[]; applied: number }>).detail;
      const doc = editor.document as Block[];
      const added: { newId: string; old?: PartialBlock }[] = [];
      for (const p of d.proposals) {
        const ref = p.id ? editor.getBlock(p.id) : doc[0];
        if (!ref) continue;
        // Tables: only a full "TABLE: …" replacement of an existing table; never turn one into text or add new ones.
        if (ref.type === "table" || /^TABLE:/i.test(p.text)) {
          if (p.kind !== "replace" || ref.type !== "table" || !/^TABLE:/i.test(p.text)) continue;
          const old = { type: ref.type, content: ref.content, props: ref.props } as PartialBlock;
          editor.updateBlock(ref, { content: textToTable(p.text, ref.content as unknown as TableData, "blue") } as never);
          added.push({ newId: ref.id, old });
          continue;
        }
        // A replaced block keeps its type (checklists stay checklists; "[done]" ticks the box).
        const type = p.kind === "replace" && ["paragraph", "heading", "checkListItem", "bulletListItem", "numberedListItem"].includes(ref.type) ? ref.type : "paragraph";
        const done = /\s*\[(done|not done)\]\s*$/i.exec(p.text);
        const text = done ? p.text.slice(0, done.index) : p.text;
        const props = { backgroundColor: "blue", ...(type === "checkListItem" && { checked: done?.[1].toLowerCase() === "done" }), ...(type === "heading" && { level: (ref.props as { level?: number }).level }) };
        if (p.kind === "replace") {
          const old = { type: ref.type, content: ref.content, props: ref.props } as PartialBlock;
          editor.updateBlock(ref, { type, content: text, props } as never);
          added.push({ newId: ref.id, old });
          continue;
        }
        const [b] = editor.insertBlocks([{ type, content: text, props }] as never, ref, p.id ? "after" : "before");
        added.push({ newId: b.id });
      }
      d.applied = added.length;
      setChanges((c) => [...c, ...added]);
    };
    window.addEventListener(NOTE_BLOCKS, onBlocks);
    window.addEventListener(PROPOSE, onPropose);
    return () => (window.removeEventListener(NOTE_BLOCKS, onBlocks), window.removeEventListener(PROPOSE, onPropose));
  }, [editor]);
  useEffect(() => {
    const pick = (i?: number) => (i === undefined ? changes : [changes[i]]);
    const done = (list: typeof changes) => setChanges((c) => c.filter((x) => !list.includes(x)));
    const accept = (i?: number) => {
      const list = pick(i).filter(Boolean);
      for (const c of list) {
        const bg = (c.old?.props as { backgroundColor?: string } | undefined)?.backgroundColor ?? "default";
        const b = editor.getBlock(c.newId);
        if (b?.type === "table") editor.updateBlock(b, { content: paintTable(b.content as unknown as TableData, "default") } as never);
        else if (b) editor.updateBlock(c.newId, { props: { backgroundColor: bg } } as never);
      }
      done(list);
    };
    const reject = (i?: number) => {
      const list = pick(i).filter(Boolean);
      done(list); // first, so the bar always clears even if the editor refuses a step below
      for (const c of list) {
        try {
          if (!editor.getBlock(c.newId)) continue;
          // Restore type and text, then props on their own (BlockNote can drop props set with a type change).
          if (c.old) editor.updateBlock(c.newId, { type: c.old.type, content: c.old.content } as never), editor.updateBlock(c.newId, { props: c.old.props } as never);
          else editor.removeBlocks([c.newId]);
        } catch (e) {
          console.error("Nerida reject failed", e);
        }
      }
    };
    setPending({ count: changes.length, ids: changes.map((c) => c.newId), accept, reject });
  }, [changes, editor]);
  useEffect(() => () => setPending({ count: 0, accept: () => {}, reject: () => {} }), []);

  // What gets saved: the note without Nerida's pending changes (replaced blocks as they were, added
  // blocks left out), so a change only reaches disk once you accept it.
  const changesRef = useRef(changes);
  changesRef.current = changes;
  const savedDoc = () => {
    const pending = changesRef.current;
    if (!pending.length) return editor.document as Block[];
    const byId = new Map(pending.map((c) => [c.newId, c]));
    const strip = (bs: Block[]): Block[] =>
      bs.flatMap((b) => {
        const c = byId.get(b.id);
        if (c && !c.old) return [];
        const base = c?.old ? ({ ...b, ...c.old } as Block) : b;
        return [{ ...base, children: strip((b.children ?? []) as Block[]) } as Block];
      });
    return strip(editor.document as Block[]);
  };
  const lastDoc = useRef(JSON.stringify(editor.document));
  // Accept / reject settle after the editor's own change event: save again once they do.
  // Compares with the last list (not a "first run" flag) so StrictMode's double mount doesn't save.
  const settled = useRef(changes);
  useEffect(() => {
    if (settled.current === changes) return;
    settled.current = changes;
    onDocChange(page.id, savedDoc());
  }, [changes]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Nerida agent: the note's new document, as one change (Ctrl+Z undoes it).
    const onAgent = (e: Event) => {
      const d = (e as CustomEvent<{ pageId: string; blocks: PartialBlock[]; handled: boolean }>).detail;
      if (d.pageId !== page.id || d.handled) return;
      d.handled = true;
      editor.replaceBlocks(editor.document, d.blocks as never);
    };
    window.addEventListener("oc-nerida-selection-cards", onSel);
    window.addEventListener("oc-nerida-cards", onSave);
    window.addEventListener(AGENT_SET_DOC, onAgent);
    return () => (window.removeEventListener("oc-nerida-selection-cards", onSel), window.removeEventListener("oc-nerida-cards", onSave), window.removeEventListener(AGENT_SET_DOC, onAgent));
  }, [editor, page.id]);

  // "Send to Atlas" for this note's headings (page menu, or a heading's block menu).
  const [atlasPick, setAtlasPick] = useState<string[] | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const { pageId, blockId } = (e as CustomEvent<{ pageId?: string; blockId?: string }>).detail;
      if (pageId === page.id) setAtlasPick([]);
      else if (blockId && editor.getBlock(blockId)) setAtlasPick([blockId]);
    };
    window.addEventListener(HEADINGS_TO_ATLAS, on);
    return () => window.removeEventListener(HEADINGS_TO_ATLAS, on);
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
  // Images dropped on the sidebar: append to this page.
  useEffect(() => {
    const on = (e: Event) => void insertImages((e as CustomEvent<File[]>).detail, true);
    window.addEventListener("oc-insert-images", on);
    return () => window.removeEventListener("oc-insert-images", on);
  }, [editor]);
  useEffect(() => {
    const on = (e: Event) => setAnnotating({ ...(e as CustomEvent).detail, edit: true });
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
  /** Clicking a picture opens it in the viewer (View mode; Annotate from there). */
  const openImage = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest?.("[data-content-type='image'] img");
    const id = img?.closest("[data-id]")?.getAttribute("data-id");
    const block = id ? (editor.getBlock(id) as { props?: { url?: string; name?: string; caption?: string } } | undefined) : undefined;
    if (!id || !block?.props?.url) return;
    setAnnotating({ id, url: block.props.url, name: block.props.caption || block.props.name });
  };

  /** Pasted or dropped images become image blocks (resize by dragging its edges; caption via right-click). */
  const insertImages = async (files: File[], atEnd = false) => {
    let after = atEnd ? editor.document[editor.document.length - 1] : editor.getTextCursorPosition().block;
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
        // Text copied from many apps also carries a picture of itself: paste the text then.
        if (e.clipboardData.getData("text/plain").trim()) return;
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
      onClick={openImage}
      onMouseLeave={(e) => !(e.relatedTarget as HTMLElement | null)?.closest?.("button") && setHoverImg(null)}
      onScroll={(e) => {
        setHoverImg(null);
        localStorage.setItem(`oc-scroll:${page.id}`, String(Math.round(e.currentTarget.scrollTop)));
      }}
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
          data-page-icon
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
        <NeridaChangesBar n={changes.length} />

        {/* BlockNote canvas (dark); right-click opens Oceanic's block menu */}
        <div
          ref={setCanvas}
          onContextMenu={(e) => {
            const items = editorContextMenu(editor, e, page.id);
            if (items) openContextMenu(e, items);
          }}
        >
        <BlockNoteView
          editor={editor}
          theme="dark"
          onChange={() => {
            // Only real edits save: opening a page (or BlockNote normalising it) must not bump updatedAt.
            const json = JSON.stringify(editor.document);
            if (json === lastDoc.current) return;
            lastDoc.current = json;
            onDocChange(page.id, savedDoc());
            setEmpty(isEmptyDoc(editor.document as Block[]));
          }}
          formattingToolbar={false}
          slashMenu={false}
          sideMenu={false}
        >
          {/* Phones: no drag handles and no typed "/" menu; the toolbar's + opens the block sheet. */}
          {!isMobile && (
            <SideMenuController
              sideMenu={(props) => <SideMenu {...props} dragHandleMenu={BlockHandleMenu} />}
            />
          )}
          {!isMobile && (
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => getSlashItems(editor, query).filter((i) => !isAndroid || i.group !== "Nerida")}
            />
          )}
          {/* Link to page: `[[` (wiki-style) and `@` (Notion's mention) */}
          <SuggestionMenuController
            triggerCharacter="[["
            getItems={async (query) => getPageLinkItems(editor, query, page.id)}
          />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) => getPageLinkItems(editor, query, page.id)}
          />
          <FormattingToolbarController
            formattingToolbar={isMobile ? MobileSelectionPopup : SelectionToolbar}
            floatingUIOptions={toolbarFloat}
          />

        </BlockNoteView>
        {(isMobile || keyboard) && <MobileToolbar editor={editor as never} blocks={() => getSlashItems(editor, "").filter((i) => i.group !== "Nerida" && i.title !== "Image" && i.title !== "File")} links={(q) => getPageLinkItems(editor, q, page.id)} />}
        </div>
      </div>
      </div>
    </div>
    <PageOutline editor={editor} scroller={scroller} />
    {atlasPick && (
      <PromoteDialog
        workspaceId={page.workspaceId}
        items={headingItems(headingsOf(editor), page.id)}
        preselect={atlasPick}
        onClose={() => setAtlasPick(null)}
      />
    )}
    {hoverImg && !annotating && (
      <button
        type="button"
        onMouseEnter={() => setHoverImg(hoverImg)}
        onClick={() => {
          const block = editor.getBlock(hoverImg.id) as { props?: { name?: string; caption?: string } } | undefined;
          setAnnotating({ id: hoverImg.id, url: hoverImg.url, name: block?.props?.caption || block?.props?.name });
        }}
        className="oc-fade-in fixed z-40 flex h-7 -translate-x-full cursor-pointer items-center gap-1.5 rounded-md bg-black/70 px-2.5 text-[12px] font-medium text-white shadow-lg backdrop-blur hover:bg-black/85"
        style={{ left: hoverImg.x, top: hoverImg.y }}
      >
        <Eye className="size-3.5" /> View
      </button>
    )}
    {annotating && (
      <ImageAnnotator
        url={annotating.url}
        name={annotating.name}
        edit={annotating.edit}
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
/** Headings as "Send to Atlas" items: each nests under the nearest higher-level heading above it. */
function headingItems(hs: { id: string; level: number; text: string }[], pageId: string): PromoteItem[] {
  const stack: { id: string; level: number }[] = [];
  return hs.map((h) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    stack.push(h);
    return { key: h.id, title: h.text, parentKey: parent?.id ?? null, depth: stack.length - 1, entryIds: [`heading:${pageId}:${h.id}`] };
  });
}

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
