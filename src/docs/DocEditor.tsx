import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Extension, Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, FileDown, FilePlus, FolderOpen, Highlighter, ImagePlus, IndentDecrease,
  IndentIncrease, Italic, List, ListOrdered, Printer, Redo2, RotateCcw, Save, Search, SeparatorHorizontal, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2, Keyboard, Type, Pilcrow, Maximize2, Scissors, Copy, ClipboardPaste, SpellCheck, ChevronDown, ArrowLeft, FileText, Minus, Plus as PlusIcon, X,
} from "lucide-react";
import { openContextMenu } from "../components/ContextMenu";
import { flushSync } from "react-dom";
import { Pagination, paginate, type Bridge } from "./pagination";
import { ParagraphFormat } from "./paragraphFormat";
import { WordFeel, alignTo } from "./wordFeel";
import { spellMenuItems, spellPlugin } from "../lib/spell/plugin";
import { FeedbackDrawer, NeridaGroup, NeridaSlash } from "./docNerida";
import { WindowControls } from "../components/TitleBar";
import { Modal, ModalButton } from "../components/Modal";
import { isOceanicDoc, type PageBorder, DEFAULT_PAGE, PAGE_MM, exportDocx, importDocx, resetImageCache, type PageSetup } from "./docxIO";
import { registerSaver } from "../lib/embedSource";
import { makeWorkingCopy, originalOf, revealDoc, setUntitledContent, forgetUntitled, docTitle, isUnsaved, newUntitled, pickDocx, pickSavePath, readDoc, refreshFiles, touchRecent, untitledContent, useDocs, writeDoc } from "./store";

/** Images are INLINE like Word: they share the line with text/spaces, get
    centered by their paragraph's alignment, and padding-space tricks work. */
const DocImage = Image.extend({
  // The resize wrapper is what sits in the text flow: make it draggable so a
  // picture can be dragged to a new spot, and mirror its float onto it.
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return (props) => {
      const view = parent(props) as unknown as { dom: HTMLElement; update?: (n: typeof props.node) => boolean };
      const sync = (float: unknown) => (float ? view.dom.setAttribute("data-float", String(float)) : view.dom.removeAttribute("data-float"));
      view.dom.draggable = true;
      sync(props.node.attrs.float);
      const update = view.update?.bind(view);
      view.update = (n) => {
        const ok = update ? update(n) : false;
        if (ok) sync(n.attrs.float);
        return ok;
      };
      return view as never;
    };
  },
}).configure({ inline: true, allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true } });


/** Older docs store images as standalone block nodes. Under the inline model
    those get wrapped into their own paragraphs on load — centered ones stay
    centered (the image's old textAlign becomes the paragraph's). Idempotent.
    Accepts either a top-level nodes array or a whole `{type:"doc"}` node. */
function migrateBlockImages(content: JSONContent | JSONContent[] | undefined): JSONContent[] {
  const nodes = Array.isArray(content) ? content : content?.content ?? [];
  return nodes.map((n) => {
    if (n.type === "image") {
      const align = (n.attrs?.textAlign as string) || undefined;
      const centered = align === "center" || align === "right";
      return {
        type: "paragraph",
        attrs: centered ? { textAlign: align } : undefined,
        content: [{ ...n, attrs: { ...n.attrs, textAlign: undefined } }],
      };
    }
    if (n.content?.length) return { ...n, content: migrateBlockImages(n.content) };
    return n;
  });
}

/** True when a document has no visible content (only empty paragraphs). */
function isEmptyDoc(content: JSONContent | JSONContent[] | undefined): boolean {
  const nodes = Array.isArray(content) ? content : content?.content ?? [];
  return !nodes.some(hasContent);
  function hasContent(n: JSONContent): boolean {
    if (n.type === "text") return !!n.text;
    // Empty paragraph/heading: only children count. Anything else (image,
    // page break, table, breaks…) counts as content.
    if (n.type !== "paragraph" && n.type !== "heading") return true;
    return (n.content ?? []).some(hasContent);
  }
}
/** Manual page break (Insert → Page break). */
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertContent({ type: "pageBreak" }) };
  },
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "oc-page-break" })],
});

const FONTS = ["Calibri", "Arial", "Times New Roman", "Georgia", "Cambria", "Garamond", "Verdana", "Courier New", "Inter"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const SPACING = ["1", "1.15", "1.5", "2"];
const STYLES: { label: string; level: number | null }[] = [
  { label: "Normal", level: null },
  { label: "Title", level: 1 },
  { label: "Heading 1", level: 2 },
  { label: "Heading 2", level: 3 },
  { label: "Heading 3", level: 4 },
];
const PX_PER_MM = 96 / 25.4;

type Status = "loading" | "saved" | "saving" | "error" | "unsaved";

/** A .docx open for editing: Word-style ribbon (or Docs/minimal toolbar), white pages, autosave. */
export function DocEditor({ path, onOpenDoc, onSavedAs, onHome, onBack, onCloseDoc }: { path: string; onOpenDoc: (path: string) => void; onSavedAs: (path: string) => void; onHome: () => void; onBack: () => void; onCloseDoc: () => void }) {
  const { uiStyle } = useDocs();
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE);
  const [status, setStatus] = useState<Status>("loading");
  const [lossy, setLossy] = useState(false);
  const [tab, setTab] = useState<"file" | "home" | "insert" | "layout" | "review" | "nerida">("home");
  const [feedback, setFeedback] = useState(false);
  const [find, setFind] = useState<string | null>(null);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const [backstage, setBackstage] = useState(false);
  /** Collapsed ribbon shown temporarily over the page after clicking a tab (Word). */
  const [peekRibbon, setPeekRibbon] = useState(false);
  const [dialog, setDialog] = useState<null | "font" | "paragraph">(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const saveTimer = useRef<number>(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  /** Autosave lock: false until a document load has completed successfully.
      A failed/blank load must never be able to overwrite the real file. */
  const loadedRef = useRef(false);
  const pagesEl = useRef<HTMLDivElement | null>(null);
  const [bridges, setBridges] = useState<Bridge[]>([]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      LineHeight,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      DocImage.configure({ allowBase64: true }),
      TableKit.configure({ table: { resizable: true } }),
      PageBreak,
      Pagination,
      ParagraphFormat,
      WordFeel,
      Extension.create({ name: "spellAssist", addProseMirrorPlugins: () => [spellPlugin()] }),
      NeridaSlash(() => docTitle(path), () => {}),
    ],
    // Word opens with the caret blinking at the start of the document.
    autofocus: "start",
    editorProps: {
      attributes: { class: "oc-doc-body", spellcheck: "false" },
      // Pictures copied from any app paste in as images.
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        files.forEach((f) => {
          const r = new FileReader();
          r.onload = () => view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src: r.result as string })));
          r.readAsDataURL(f);
        });
        return true;
      },
    },
    onUpdate: () => scheduleSave(),
  });

  const save = async (): Promise<string | null> => {
    if (!editor || !loadedRef.current) return null;
    // First save of a new document: Save As, then continue in the real file.
    if (isUnsaved(path)) {
      const target = await pickSavePath(docTitle(path));
      if (!target) return null;
      await writeDoc(target, await exportDocx(editor.getJSON(), pageRef.current));
      void refreshFiles();
      forgetUntitled(path);
      onSavedAs(target);
      return target;
    }
    setStatus("saving");
    try {
      await writeDoc(path, await exportDocx(editor.getJSON(), pageRef.current));
      setStatus("saved");
      void refreshFiles();
      return path;
    } catch {
      setStatus("error");
      return null;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSaver(() => saveRef.current());
    return () => registerSaver(null);
  }, []);
  const scheduleSave = () => {
    if (!loadedRef.current) return;
    if (isUnsaved(path)) {
      if (editor) setUntitledContent(path, editor.getJSON(), pageRef.current);
      return setStatus("unsaved");
    }
    window.clearTimeout(saveTimer.current);
    setStatus("saving");
    saveTimer.current = window.setTimeout(() => void save(), 1000);
  };
  const dim = PAGE_MM[page.size];
  const [w, h] = page.orientation === "landscape" ? [dim.h, dim.w] : [dim.w, dim.h];
  // Gap between page cards; 0 while printing so pages line up with paper.
  const [gap, setGap] = useState(24);
  const stride = h * PX_PER_MM + gap;
  const [pages, setPages] = useState(1);
  const relayout = () => {
    if (!editor || editor.isDestroyed) return;
    const res = paginate(editor, stride, (h - page.margin.top - page.margin.bottom) * PX_PER_MM, pagesEl.current, zoom);
    setPages(res.pages);
    setBridges(res.bridges);
  };
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const run = () => (cancelAnimationFrame(raf), (raf = requestAnimationFrame(relayout)));
    run();
    editor.on("update", run);
    return () => (cancelAnimationFrame(raf), void editor.off("update", run));
  }, [editor, zoom, stride, h, page.margin.top, page.margin.bottom, page.margin.left, page.margin.right, status === "loading"]);
  useEffect(() => {
    // Printing: paper-exact layout (no card gap, 100% zoom), laid out synchronously
    // before the print snapshot, and the @page size set to this document's paper.
    let prevZoom = 1;
    let pageStyle: HTMLStyleElement | null = null;
    const before = () => {
      if (!editor) return;
      const pg = pageRef.current;
      const d = PAGE_MM[pg.size];
      const [pw, ph] = pg.orientation === "landscape" ? [d.h, d.w] : [d.w, d.h];
      prevZoom = zoomRef.current;
      flushSync(() => (setGap(0), setZoom(1)));
      const res = paginate(editor, ph * PX_PER_MM, (ph - pg.margin.top - pg.margin.bottom) * PX_PER_MM, pagesEl.current, 1);
      flushSync(() => setPages(res.pages));
      pageStyle = document.createElement("style");
      pageStyle.textContent = `@page { size: ${pw}mm ${ph}mm; margin: 0; }`;
      document.head.appendChild(pageStyle);
    };
    const after = () => {
      pageStyle?.remove();
      setGap(24);
      setZoom(prevZoom);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => (window.removeEventListener("beforeprint", before), window.removeEventListener("afterprint", after));
  }, [editor]);
  // Pointer watchdog: a drag or resize that ends outside the window can leave a
  // cursor override behind (the pointer then seems to vanish); clear it.
  useEffect(() => {
    const reset = () => {
      document.body.style.cursor = "";
      document.documentElement.style.cursor = "";
    };
    const events = ["pointerup", "dragend", "drop", "blur", "pointercancel"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset));
    return () => events.forEach((ev) => window.removeEventListener(ev, reset));
  }, []);
  const updatePage = (patch: Partial<PageSetup>) => {
    setPage((p) => ({ ...p, ...patch }));
    window.setTimeout(scheduleSave);
  };

  // Load the file (an empty/new file starts blank and is written on first save).
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    loadedRef.current = false; // no saving until this load has completed
    resetImageCache(); // each document starts with a fresh image cache
    setStatus("loading");
    (async () => {
      let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
      if (isUnsaved(path)) {
        editor.commands.setContent(migrateBlockImages((untitledContent(path) as JSONContent) ?? [{ type: "paragraph" }]), { emitUpdate: false });
        if (!alive) return;
        loadedRef.current = true;
        setStatus("unsaved");
        return;
      }
      try {
        // A FAILED read must never be treated as an empty document — saving
        // blank over a real file would destroy it. Unreadable → error state.
        try {
          bytes = await readDoc(path);
        } catch {
          setStatus("error");
          return;
        }
        // Word files made elsewhere: never edit the original (saving would
        // simplify it). Work on a copy in the Docs folder instead.
        if (!originalOf(path) && !(await isOceanicDoc(bytes))) {
          const copy = await makeWorkingCopy(path, bytes);
          if (copy && alive) return onSavedAs(copy);
        }
        const loaded = await importDocx(bytes);
        if (!alive) return;
        // Mammoth-fallback content is HTML — set directly. Our own saves are
        // JSON and go through the block-image migration.
        if (typeof loaded.content === "string") {
          editor.commands.setContent(loaded.content, { emitUpdate: false });
          if (!alive) return;
          loadedRef.current = true;
          setPage(loaded.page);
          setLossy(loaded.lossy);
          setStatus("saved");
          touchRecent(path);
          if (!bytes.length) void save();
          return;
        }
        editor.commands.setContent(migrateBlockImages(loaded.content), { emitUpdate: false });
        if (!alive) return;
        // Sanity gate: if the file had content but the editor somehow ended up
        // empty (schema rejection / parser bug), treat the load as failed —
        // autosave stays locked out so a bad load can never wipe the file.
        const loadedEmpty = isEmptyDoc(loaded.content);
        if (bytes.length && !loadedEmpty && isEmptyDoc(editor.getJSON())) {
          setStatus("error");
          return;
        }
        loadedRef.current = true;
        setPage(loaded.page);
        setLossy(loaded.lossy);
        setStatus("saved");
        touchRecent(path);
        if (!bytes.length) void save();
      } catch (e) {
        // Load failed: keep autosave locked so nothing overwrites the file.
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
      // Flush a pending save when leaving the doc.
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        void save();
      }
    };
  }, [editor, path]);

  const saveCopy = async () => {
    const target = await pickSavePath(docTitle(path) + " (copy)");
    if (!target || !editor) return;
    await writeDoc(target, await exportDocx(editor.getJSON(), page));
    void refreshFiles();
    onOpenDoc(target);
  };

  if (!editor) return null;

  const groups = {
    file: <RibbonGroup label="File"><FileGroup onNew={() => onOpenDoc(newUntitled())} onOpen={async () => { const p = await pickDocx(); if (p) onOpenDoc(p); }} onCopy={saveCopy} onSave={save} /></RibbonGroup>,
    home: <RibbonGroup label="Home"><HomeGroups editor={editor} /></RibbonGroup>,
    insert: <RibbonGroup label="Insert"><InsertGroup editor={editor} page={page} updatePage={updatePage} /></RibbonGroup>,
    layout: <RibbonGroup label="Layout"><LayoutGroup page={page} updatePage={updatePage} /></RibbonGroup>,
    review: <RibbonGroup label="Review"><ReviewGroup editor={editor} onFind={() => setFind("")} /></RibbonGroup>,
    nerida: <RibbonGroup label="Nerida"><NeridaGroup editor={editor} title={docTitle(path)} onFeedback={() => setFeedback(true)} Big={(p) => <Big {...p} />} /></RibbonGroup>,
  };

  return (
    <div
      className="oc-docs relative flex h-full flex-col"
      onWheel={(e) => {
        if (!e.ctrlKey) return;
        setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z - Math.sign(e.deltaY) * 0.1) * 10) / 10)));
      }}
      onKeyDown={(e) => {
        // Word: Ctrl+Shift+> / < steps the font size.
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && [">", "<", ".", ","].includes(e.key) && editor) {
          e.preventDefault();
          const cur = parseFloat(editor.getAttributes("textStyle").fontSize ?? "") || 11;
          const up = e.key === ">" || e.key === ".";
          const next = up ? (SIZES.find((x) => x > cur) ?? cur + 12) : ([...SIZES].reverse().find((x) => x < cur) ?? Math.max(1, cur - 1));
          editor.chain().focus().setFontSize(`${next}pt`).run();
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "F1" && mod) {
          e.preventDefault();
          setRibbonCollapsed((v) => !v);
          setPeekRibbon(false);
          return;
        }
        if (mod && !e.shiftKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          setDialog("font");
          return;
        }
        if (e.key === "F12") {
          e.preventDefault();
          void saveCopy();
          return;
        }
        // Word's file shortcuts (kept from reaching Oceanic's own Ctrl+N etc.)
        const fileKey = mod && !e.shiftKey && !e.altKey ? e.key.toLowerCase() : "";
        if (fileKey === "n" || fileKey === "o" || fileKey === "p") {
          e.preventDefault();
          e.stopPropagation();
          if (fileKey === "n") onOpenDoc(newUntitled());
          else if (fileKey === "p") window.print();
          else void pickDocx().then((p) => p && onOpenDoc(p));
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setFind("");
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          window.clearTimeout(saveTimer.current);
          void save();
        }
      }}
    >
      {/* Other toolbar styles still need a title strip: Oceanic's top bar is hidden in Docs. */}
      {uiStyle !== "ribbon" && (
        <div data-tauri-drag-region className="oc-docs-chrome flex h-9 shrink-0 items-center gap-2 pl-3 text-[13px]">
          <button type="button" onClick={() => setBackstage(true)} className="h-6 cursor-pointer rounded bg-[var(--oc-docs)] px-2.5 text-[12px] font-semibold text-[#04262a]">File</button>
          <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-center font-semibold text-neutral-100">{docTitle(path)}</span>
          <WindowControls />
        </div>
      )}
      {/* ---- Ribbon / toolbar ---- */}
      {uiStyle === "ribbon" ? (
        <div className="oc-docs-enter relative z-20 shrink-0">
          {/* Word-style accent band (follows the Accent Color setting): quick access · centred name · window controls */}
          <div className="oc-docs-titlebar">
            <div data-tauri-drag-region className="relative flex h-8 items-center gap-0.5 pl-1.5">
              <QBtn title="Save (Ctrl+S)" onClick={save}><Save /></QBtn>
              <QBtn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()}><Undo2 /></QBtn>
              <QBtn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()}><Redo2 /></QBtn>
              <div data-tauri-drag-region className="pointer-events-none absolute inset-x-40 flex min-w-0 items-center justify-center gap-2 text-[12.5px]">
                <span className="truncate">{docTitle(path)} - Oceanic Docs</span>
                <span className="oc-docs-titlebar-status shrink-0"><SaveStatus status={status} /></span>
              </div>
              <span data-tauri-drag-region className="flex-1 self-stretch" />
              <WindowControls />
            </div>
            {/* Tabs: File opens the backstage; the selected tab merges into the ribbon like Word */}
            <div data-tauri-drag-region className="flex h-[30px] items-end gap-0.5 px-1.5">
              <button type="button" onClick={() => setBackstage(true)} className="oc-docs-tab h-[26px] cursor-pointer rounded-t px-4 text-[13px]">
                File
              </button>
              {(["home", "insert", "layout", "review", "nerida"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => (setTab(t), ribbonCollapsed && setPeekRibbon((v) => !v || tab !== t))}
                  onDoubleClick={() => (setRibbonCollapsed((v) => !v), setPeekRibbon(false))}
                  className={`oc-docs-tab h-[26px] cursor-pointer rounded-t px-4 text-[13px] capitalize ${tab === t && (!ribbonCollapsed || peekRibbon) ? "is-on" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {(!ribbonCollapsed || peekRibbon) && (
            <div className={ribbonCollapsed ? "absolute inset-x-0 z-30" : "relative"}>
              {ribbonCollapsed && <div className="fixed inset-0" onMouseDown={() => setPeekRibbon(false)} />}
              <div key={tab} className={`oc-docs-ribbon oc-ribbon-swap relative flex min-h-[96px] items-stretch gap-1 overflow-x-auto px-2 py-1.5 pr-9 ${ribbonCollapsed ? "shadow-[0_12px_30px_rgba(0,0,0,0.45)]" : ""}`}>
                {tab === "home" ? <HomeRibbon editor={editor} /> : groups[tab === "file" ? "home" : tab]}
                {/* Word's collapse/pin control, bottom-right of the ribbon (also Ctrl+F1, double-click a tab) */}
                <button
                  type="button"
                  data-tip={ribbonCollapsed ? "Pin the ribbon (Ctrl+F1)" : "Collapse the ribbon (Ctrl+F1)"}
                  onClick={() => (setRibbonCollapsed((v) => !v), setPeekRibbon(false))}
                  className="oc-press absolute bottom-1 right-1 grid size-6 cursor-pointer place-items-center rounded text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100"
                >
                  <ChevronDown className={`size-4 transition-transform duration-200 ${ribbonCollapsed ? "" : "rotate-180"}`} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : uiStyle === "docs" ? (
        <div className="shrink-0 border-b border-white/[0.06] bg-[var(--oc-surface)] px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {groups.home}
            <Sep />
            {groups.insert}
            <Sep />
            {groups.nerida}
            <span className="flex-1" />
            <SaveStatus status={status} />
          </div>
        </div>
      ) : null}

      {originalOf(path) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-sky-500/20 bg-sky-500/10 px-4 py-1.5 text-[12.5px] text-sky-200">
          <span className="flex-1">You're editing an Oceanic copy. The original Word file is left untouched.</span>
          <button type="button" onClick={() => void revealDoc(originalOf(path)!)} className="cursor-pointer rounded-md px-2 py-0.5 hover:bg-white/[0.08]">Show original</button>
        </div>
      )}
      {lossy && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-200">
          <span className="flex-1">This document has parts Oceanic Docs can't keep (like text boxes, comments or tracked changes). Saving will simplify them.</span>
          <button type="button" onClick={saveCopy} className="cursor-pointer rounded-md bg-amber-400/20 px-2.5 py-1 font-medium hover:bg-amber-400/30">
            Save as copy
          </button>
          <button type="button" onClick={() => setLossy(false)} className="cursor-pointer rounded-md px-2 py-1 hover:bg-white/[0.06]">
            Continue
          </button>
        </div>
      )}
      {find !== null && <FindBar editor={editor} onClose={() => setFind(null)} />}

      {/* ---- Page canvas: white pages on gray, in every theme ---- */}
      <div ref={canvasRef} className="oc-doc-canvas scrollbar-thin relative min-h-0 flex-1 overflow-auto py-10">
        {uiStyle === "minimal" && (
          <div className="sticky top-0 z-10 mx-auto mb-4 flex w-fit flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-[var(--oc-surface)]/95 px-2 py-1 shadow-lg backdrop-blur">
            <HomeGroups editor={editor} compact />
            <Sep />
            <SaveStatus status={status} />
          </div>
        )}
        {/* Zoom scales the paper; the outer box keeps the scroll size right. */}
        <div className="oc-doc-zoom-box mx-auto" style={{ width: w * PX_PER_MM * zoom, height: (pages * stride - gap) * zoom }}>
          <div className="oc-doc-zoom transition-transform duration-200 ease-out" style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: w * PX_PER_MM }}>
        {/* Page cards behind one continuous editor; pagination.ts pushes blocks onto the next card. */}
        <div ref={pagesEl} className="oc-doc-pages relative cursor-text" style={{ width: w * PX_PER_MM, height: pages * stride - gap }} onMouseDown={(e) => placeCaret(e, editor)}>
          {Array.from({ length: pages }, (_, i) => (
            <div
              key={i}
              className="oc-doc-page oc-page-rise absolute inset-x-0 bg-white text-[12px] text-neutral-500"
              style={{ top: i * stride, height: h * PX_PER_MM, animationDelay: `${Math.min(i, 6) * 60}ms` }}
            >
              {page.border && <BorderBox border={page.border} margin={page.margin} />}
              {page.header && (
                <div className="absolute top-0 pt-6" style={{ left: page.margin.left * PX_PER_MM }}>
                  {page.header}
                </div>
              )}
              {(page.footer || page.pageNumbers) && (
                <div className="absolute inset-x-0 bottom-0 pb-6 text-center">
                  {page.footer} {page.pageNumbers && i + 1}
                </div>
              )}
            </div>
          ))}
          {bridges.map((b, i) => (
            <div key={`br${i}`} className="oc-page-bridge" style={{ top: b.top, height: Math.max(0, b.bottom - b.top) }} />
          ))}
          <div
            className="relative text-black"
            style={{ paddingTop: page.margin.top * PX_PER_MM, paddingLeft: page.margin.left * PX_PER_MM, paddingRight: page.margin.right * PX_PER_MM }}
          >
            <EditorContent editor={editor} onContextMenu={(e) => docMenu(e, editor, setDialog)} />
          </div>
        </div>
          </div>
        </div>
      </div>
      <StatusBar
        editor={editor}
        pagesEl={pagesEl}
        stride={stride}
        pages={pages}
        zoom={zoom}
        setZoom={setZoom}
        onFitWidth={() => canvasRef.current && setZoom(Math.min(2, Math.max(0.5, Math.floor(((canvasRef.current.clientWidth - 64) / (w * PX_PER_MM)) * 100) / 100)))}
      />
      {feedback && <FeedbackDrawer editor={editor} onClose={() => setFeedback(false)} />}
      {dialog === "font" && <FontDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === "paragraph" && <ParagraphDialog editor={editor} onClose={() => setDialog(null)} />}
      {backstage && (
        <Backstage
          title={docTitle(path)}
          onClose={() => setBackstage(false)}
          onHome={onHome}
          onBack={onBack}
          onNew={() => onOpenDoc(newUntitled())}
          onOpen={async () => {
            const p = await pickDocx();
            if (p) onOpenDoc(p);
          }}
          onOpenRecent={onOpenDoc}
          onCloseDoc={onCloseDoc}
          onSave={save}
          onCopy={saveCopy}
          onPrint={() => (setBackstage(false), setTimeout(() => window.print(), 50))}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ context menu */
/** Right-click in the page. Shift+right-click keeps the WebView's own menu (spelling suggestions). */
/** Like Word: a click anywhere on the paper (margins, empty space below the text)
    puts the caret at the nearest spot, not only clicks on existing lines. */
function placeCaret(e: React.MouseEvent, editor: Editor | null) {
  if (!editor || e.button !== 0 || (e.target as HTMLElement).closest(".ProseMirror")) return;
  e.preventDefault();
  const r = editor.view.dom.getBoundingClientRect();
  const left = Math.min(r.right - 2, Math.max(r.left + 2, e.clientX));
  const top = Math.min(r.bottom - 2, Math.max(r.top + 2, e.clientY));
  const hit = editor.view.posAtCoords({ left, top });
  const pos = hit ? hit.pos : e.clientY > r.bottom ? editor.state.doc.content.size : 0;
  editor.chain().focus().setTextSelection(pos).run();
}

function docMenu(e: React.MouseEvent, editor: Editor, openDialog: (d: "font" | "paragraph") => void) {
  if (e.shiftKey) return;
  const c = () => editor.chain().focus();
  const hasSel = !editor.state.selection.empty;
  const img = editor.isActive("image") ? (editor.getAttributes("image").float as string | null) : undefined;
  openContextMenu(e, [
    ...(spellMenuItems(editor.view, e) as Parameters<typeof openContextMenu>[1]),
    ...(img !== undefined
      ? ([
          { label: "Wrap: In line with text", checked: !img, onSelect: () => c().updateAttributes("image", { float: null }).run() },
          { label: "Wrap: Left, text on right", checked: img === "left", onSelect: () => c().updateAttributes("image", { float: "left" }).run() },
          { label: "Wrap: Right, text on left", checked: img === "right", onSelect: () => c().updateAttributes("image", { float: "right" }).run() },
          "divider",
          { label: "Align left", onSelect: () => alignTo(editor, "left") },
          { label: "Align centre", onSelect: () => alignTo(editor, "center") },
          { label: "Align right", onSelect: () => alignTo(editor, "right") },
          "divider",
        ] as Parameters<typeof openContextMenu>[1])
      : []),
    { label: "Cut", icon: <Scissors className="size-4" />, hint: "Ctrl+X", disabled: !hasSel, onSelect: () => (editor.commands.focus(), document.execCommand("cut")) },
    { label: "Copy", icon: <Copy className="size-4" />, hint: "Ctrl+C", disabled: !hasSel, onSelect: () => (editor.commands.focus(), document.execCommand("copy")) },
    {
      label: "Paste",
      icon: <ClipboardPaste className="size-4" />,
      hint: "Ctrl+V",
      onSelect: async () => {
        const text = await navigator.clipboard.readText().catch(() => "");
        if (text) c().insertContent(text).run();
      },
    },
    "divider",
    { label: "Bold", icon: <Bold className="size-4" />, hint: "Ctrl+B", checked: editor.isActive("bold"), onSelect: () => c().toggleBold().run() },
    { label: "Italic", icon: <Italic className="size-4" />, hint: "Ctrl+I", checked: editor.isActive("italic"), onSelect: () => c().toggleItalic().run() },
    { label: "Underline", icon: <UnderlineIcon className="size-4" />, hint: "Ctrl+U", checked: editor.isActive("underline"), onSelect: () => c().toggleUnderline().run() },
    { label: "Clear formatting", icon: <RotateCcw className="size-4" />, onSelect: () => c().unsetAllMarks().clearNodes().run() },
    "divider",
    { label: "Font…", icon: <Type className="size-4" />, hint: "Ctrl+D", onSelect: () => openDialog("font") },
    { label: "Paragraph…", icon: <Pilcrow className="size-4" />, onSelect: () => openDialog("paragraph") },
    "divider",
    { label: "Spelling suggestions: Shift + right-click", icon: <SpellCheck className="size-4" />, disabled: true },
  ]);
}

/* ------------------------------------------------------------ Word 365 chrome */
function QBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" data-tip={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="oc-press grid size-7 cursor-pointer place-items-center rounded-md text-neutral-300 hover:bg-white/[0.08] [&_svg]:size-4">
      {children}
    </button>
  );
}

/** A labelled ribbon group (label along the bottom, divider on the right). */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r border-white/[0.07] px-2 last:border-r-0">
      <div className="flex flex-1 flex-wrap content-center items-center gap-0.5">{children}</div>
      <span className="pt-0.5 text-center text-[10.5px] text-neutral-500">{label}</span>
    </div>
  );
}

/** Home tab, Word 365 layout: Clipboard · Font · Paragraph · Styles gallery. */
function HomeRibbon({ editor }: { editor: Editor }) {
  const a = useActive(editor);
  const c = () => editor.chain().focus();
  return (
    <>
      <Group label="Clipboard">
        <Big
          icon={<ClipboardPaste />}
          label="Paste"
          onClick={async () => {
            const text = await navigator.clipboard.readText().catch(() => "");
            if (text) c().insertContent(text).run();
          }}
        />
        <div className="flex flex-col">
          <Btn title="Cut (Ctrl+X)" onClick={() => (editor.commands.focus(), document.execCommand("cut"))}><Scissors /></Btn>
          <Btn title="Copy (Ctrl+C)" onClick={() => (editor.commands.focus(), document.execCommand("copy"))}><Copy /></Btn>
        </div>
      </Group>
      <Group label="Font">
        <div className="flex w-[232px] flex-col gap-1">
          <div className="flex gap-1">
            <Select value={a.font} onChange={(v) => c().setFontFamily(v).run()} options={FONTS.map((f) => [f, f])} width={164} fontPreview />
            <Select value={String(a.size)} onChange={(v) => c().setFontSize(`${v}pt`).run()} options={SIZES.map((x) => [String(x), String(x)])} width={64} />
          </div>
          <div className="flex items-center">
            <Btn title="Bold (Ctrl+B)" on={a.bold} onClick={() => c().toggleBold().run()}><Bold /></Btn>
            <Btn title="Italic (Ctrl+I)" on={a.italic} onClick={() => c().toggleItalic().run()}><Italic /></Btn>
            <Btn title="Underline (Ctrl+U)" on={a.underline} onClick={() => c().toggleUnderline().run()}><UnderlineIcon /></Btn>
            <Btn title="Strikethrough" on={a.strike} onClick={() => c().toggleStrike().run()}><Strikethrough /></Btn>
            <ColorBtn title="Text color" onPick={(col) => c().setColor(col).run()}>A</ColorBtn>
            <ColorBtn title="Highlight" highlight onPick={(col) => c().toggleHighlight({ color: col }).run()}><Highlighter className="size-4" /></ColorBtn>
            <Btn title="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}><RotateCcw /></Btn>
          </div>
        </div>
      </Group>
      <Group label="Paragraph">
        <div className="flex flex-col gap-1">
          <div className="flex items-center">
            <Btn title="Bulleted list" on={a.bullet} onClick={() => c().toggleBulletList().run()}><List /></Btn>
            <Btn title="Numbered list" on={a.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></Btn>
            <Btn title="Decrease indent" onClick={() => c().liftListItem("listItem").run()}><IndentDecrease /></Btn>
            <Btn title="Increase indent" onClick={() => c().sinkListItem("listItem").run()}><IndentIncrease /></Btn>
          </div>
          <div className="flex items-center">
            {(["left", "center", "right", "justify"] as const).map((al) => (
              <Btn key={al} title={`Align ${al}`} on={a.align === al} onClick={() => alignTo(editor, al)}>
                {{ left: <AlignLeft />, center: <AlignCenter />, right: <AlignRight />, justify: <AlignJustify /> }[al]}
              </Btn>
            ))}
            <Select value="" onChange={(v) => c().setLineHeight(v).run()} options={[["", "1.15"], ...SPACING.map((x) => [x, x] as [string, string])]} width={58} />
          </div>
        </div>
      </Group>
      <Group label="Styles">
        <div className="flex gap-1">
          {STYLES.map((st) => {
            const on = (a.level ?? null) === st.level;
            return (
              <button
                key={st.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (st.level ? c().setHeading({ level: st.level as 1 }).run() : c().setParagraph().run())}
                className={`oc-style-tile flex h-[54px] w-[78px] cursor-pointer flex-col justify-between rounded-md border bg-white px-2 py-1.5 text-left ${on ? "border-[color:var(--oc-docs)] ring-2 ring-[color:var(--oc-docs)]/40" : "border-transparent hover:border-[color:var(--oc-docs)]/60"}`}
              >
                <span
                  className="truncate leading-none"
                  style={{
                    fontFamily: "Calibri, Carlito, Arial, sans-serif",
                    fontSize: st.level === 1 ? 19 : st.level === 2 ? 15 : st.level === 3 ? 13 : st.level === 4 ? 12 : 12,
                    color: st.level && st.level > 1 ? "#2f5496" : "#000",
                  }}
                >
                  AaBbCc
                </span>
                <span className="truncate text-[10px] text-neutral-600">{st.label}</span>
              </button>
            );
          })}
        </div>
      </Group>
    </>
  );
}

/** Bottom bar: page X of Y, word count, zoom. */
function StatusBar({
  editor, pagesEl, stride, pages, zoom, setZoom,
  onFitWidth,
}: { editor: Editor; pagesEl: React.RefObject<HTMLDivElement | null>; stride: number; pages: number; zoom: number; setZoom: (z: number) => void; onFitWidth: () => void }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      let page = 1;
      try {
        const top = e.view.coordsAtPos(e.state.selection.from).top;
        const box = pagesEl.current?.getBoundingClientRect();
        if (box) page = Math.min(pages, Math.max(1, Math.floor((top - box.top) / zoom / stride) + 1));
      } catch {}
      return { page, words: e.state.doc.textContent.split(/\s+/).filter(Boolean).length };
    },
  });
  return (
    <div className="oc-docs-status oc-docs-enter-up flex h-7 shrink-0 items-center gap-4 px-3 text-[11.5px] text-neutral-300">
      <span>Page {st.page} of {pages}</span>
      <span>{st.words.toLocaleString()} words</span>
      <span className="flex-1" />
      <button type="button" data-tip="Fit page width" onClick={onFitWidth} className="cursor-pointer hover:text-white"><Maximize2 className="size-3.5" /></button>
      <button type="button" title="Zoom out" onClick={() => setZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))} className="cursor-pointer hover:text-white"><Minus className="size-3.5" /></button>
      <input type="range" min={50} max={200} step={10} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-28 accent-[var(--oc-docs)]" />
      <button type="button" title="Zoom in" onClick={() => setZoom(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))} className="cursor-pointer hover:text-white"><PlusIcon className="size-3.5" /></button>
      <button type="button" title="Reset zoom" onClick={() => setZoom(1)} className="w-10 cursor-pointer text-right hover:text-white">{Math.round(zoom * 100)}%</button>
    </div>
  );
}

/** Shortcut list shown in File → Help (keys separated by spaces render as key caps). */
const SHORTCUTS: [string, [string, string][]][] = [
  ["File", [["Ctrl+N", "New document"], ["Ctrl+O", "Open"], ["Ctrl+S", "Save"], ["F12", "Save as copy"], ["Ctrl+P", "Print / PDF"], ["Ctrl+F", "Find & replace"]]],
  ["Editing", [["Ctrl+Z", "Undo"], ["Ctrl+Y", "Redo"], ["Ctrl+X", "Cut"], ["Ctrl+C", "Copy"], ["Ctrl+V", "Paste"], ["Ctrl+Enter", "Page break"], ["Ctrl+K", "Insert link"]]],
  ["Font", [["Ctrl+B", "Bold"], ["Ctrl+I", "Italic"], ["Ctrl+U", "Underline"], ["Ctrl+Shift+>", "Bigger font"], ["Ctrl+Shift+<", "Smaller font"], ["Ctrl+D", "Font dialog"]]],
  ["Paragraph", [["Ctrl+L", "Align left"], ["Ctrl+E", "Centre"], ["Ctrl+R", "Align right"], ["Ctrl+J", "Justify"], ["Ctrl+1", "Single spacing"], ["Ctrl+5", "1.5 spacing"], ["Ctrl+2", "Double spacing"], ["Tab", "Indent / tab"], ["Shift+Tab", "Outdent"]]],
  ["Styles", [["Ctrl+Alt+1", "Heading 1"], ["Ctrl+Alt+2", "Heading 2"], ["Ctrl+Alt+3", "Heading 3"], ["Ctrl+Alt+0", "Normal text"]]],
  ["View", [["Ctrl+F1", "Collapse / pin ribbon"], ["Ctrl+Scroll", "Zoom"], ["Ctrl+Tab", "Next document"], ["Ctrl+\\", "Show / hide sidebar"]]],
];

/** Word's full-screen File menu. */
function Backstage(p: {
  title: string; onClose: () => void; onHome: () => void; onBack: () => void; onNew: () => void; onOpen: () => void;
  onOpenRecent: (path: string) => void; onSave: () => void; onCopy: () => void; onPrint: () => void; onCloseDoc: () => void;
}) {
  const { recent } = useDocs();
  const [pane, setPane] = useState<"recent" | "help">("recent");
  const run = (f: () => void) => () => (p.onClose(), f());
  const item = "flex h-10 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-[14px] text-neutral-200 hover:bg-white/[0.07]";
  return (
    <div className="oc-backstage-in absolute inset-0 z-40 flex">
      <div className="oc-docs-backstage oc-backstage-rail flex w-56 shrink-0 flex-col gap-0.5 p-3">
        <button type="button" onClick={p.onClose} className={`${item} mb-2`}><ArrowLeft className="size-4" /> Back to document</button>
        <button type="button" onClick={run(p.onNew)} className={item}><FilePlus className="size-4" /> New</button>
        <button type="button" onClick={run(p.onOpen)} className={item}><FolderOpen className="size-4" /> Open</button>
        <button type="button" onClick={run(p.onSave)} className={item}><Save className="size-4" /> Save</button>
        <button type="button" onClick={run(p.onCopy)} className={item}><FileDown className="size-4" /> Save as copy</button>
        <button type="button" onClick={p.onPrint} className={item}><Printer className="size-4" /> Print / PDF</button>
        <button type="button" onClick={run(p.onCloseDoc)} className={item}><X className="size-4" /> Close</button>
        <span className="flex-1" />
        <button type="button" onClick={() => setPane(pane === "help" ? "recent" : "help")} className={`${item} ${pane === "help" ? "bg-white/[0.07]" : ""}`}><Keyboard className="size-4" /> Help</button>
        <button type="button" onClick={run(p.onHome)} className={item}><ArrowLeft className="size-4" /> Back to Docs Home</button>
      </div>
      <div className="flex-1 overflow-y-auto bg-[var(--oc-surface)] p-10">
        <div className="flex items-center">
          <h2 className="flex-1 text-[26px] font-semibold text-neutral-100">{pane === "help" ? "Help: keyboard shortcuts" : "Recent"}</h2>
          <button type="button" onClick={p.onClose} className="grid size-8 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06]"><X className="size-4" /></button>
        </div>
        <p className="mb-4 text-[13px] text-neutral-500">{pane === "help" ? "Word-style shortcuts in Oceanic Docs" : `Editing “${p.title}”`}</p>
        {pane === "help" ? (
          <div className="grid max-w-4xl grid-cols-2 gap-x-10 gap-y-6">
            {SHORTCUTS.map(([group, rows]) => (
              <section key={group}>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--oc-docs-light)]">{group}</h3>
                {rows.map(([keys, what]) => (
                  <div key={keys} className="flex items-center gap-3 border-b border-white/[0.05] py-1.5 text-[13px]">
                    <span className="flex-1 text-neutral-300">{what}</span>
                    <span className="flex gap-1">
                      {keys.split(" ").map((k) => (
                        <kbd key={k} className="rounded border border-white/[0.12] bg-white/[0.05] px-1.5 py-0.5 font-sans text-[11px] text-neutral-200">{k}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : recent.length ? (
          recent.map((r) => (
            <button key={r} type="button" onClick={run(() => p.onOpenRecent(r))} className="flex w-full max-w-3xl cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-white/[0.05]">
              <FileText className="size-5 shrink-0 text-[color:var(--oc-docs)]" />
              <span className="min-w-0">
                <span className="block truncate text-[14px] text-neutral-100">{docTitle(r)}</span>
                <span className="block truncate text-[11px] text-neutral-500">{r}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="text-[13px] text-neutral-500">No recent documents.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Word dialogs */
const field = "h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none focus:border-[color:var(--oc-docs)]";

/** Word's Font dialog: face, size, style, effects, colour, with a live preview. */
function FontDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const ts = editor.getAttributes("textStyle");
  const [font, setFont] = useState<string>((ts.fontFamily as string | undefined)?.replace(/["']/g, "") ?? "Calibri");
  const [size, setSize] = useState<number>(parseFloat(ts.fontSize ?? "") || 11);
  const [bold, setBold] = useState(editor.isActive("bold"));
  const [italic, setItalic] = useState(editor.isActive("italic"));
  const [underline, setUnderline] = useState(editor.isActive("underline"));
  const [strike, setStrike] = useState(editor.isActive("strike"));
  const [color, setColor] = useState<string>((ts.color as string | undefined) ?? "#000000");
  const apply = () => {
    let ch = editor.chain().focus().setFontFamily(font).setFontSize(`${size}pt`).setColor(color);
    ch = bold ? ch.setBold() : ch.unsetBold();
    ch = italic ? ch.setItalic() : ch.unsetItalic();
    ch = underline ? ch.setUnderline() : ch.unsetUnderline();
    ch = strike ? ch.setStrike() : ch.unsetStrike();
    ch.run();
    onClose();
  };
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-neutral-200">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="accent-[var(--oc-docs)]" /> {label}
    </label>
  );
  return (
    <Modal onClose={onClose} className="w-[440px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">Font</h2>
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <label className="text-[12px] text-neutral-400">Font<select value={font} onChange={(e) => setFont(e.target.value)} className={`${field} mt-1`}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="text-[12px] text-neutral-400">Size<input type="number" min={1} max={400} value={size} onChange={(e) => setSize(Number(e.target.value))} className={`${field} mt-1`} /></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {check("Bold", bold, setBold)}
        {check("Italic", italic, setItalic)}
        {check("Underline", underline, setUnderline)}
        {check("Strikethrough", strike, setStrike)}
      </div>
      <label className="mt-4 flex items-center gap-2 text-[13px] text-neutral-200">
        Colour <input type="color" value={color.startsWith("#") ? color.slice(0, 7) : "#000000"} onChange={(e) => setColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
      </label>
      <div className="mt-4 rounded-md bg-white px-4 py-3 text-center" style={{ fontFamily: font, fontSize: `${size}pt`, color, fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal", textDecoration: [underline && "underline", strike && "line-through"].filter(Boolean).join(" ") || "none" }}>
        AaBbYyZz
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" autoFocus onClick={apply}>OK</ModalButton>
      </div>
    </Modal>
  );
}

/** Word's Paragraph dialog: alignment, indents and spacing (points). */
function ParagraphDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const type = editor.isActive("heading") ? "heading" : "paragraph";
  const a = editor.getAttributes(type);
  const [align, setAlign] = useState<string>(a.textAlign ?? "left");
  const [left, setLeft] = useState<number>(a.indentLeft ?? 0);
  const [right, setRight] = useState<number>(a.indentRight ?? 0);
  const [first, setFirst] = useState<number>(a.indentFirst ?? 0);
  const [before, setBefore] = useState<number>(a.spaceBefore ?? 0);
  const [after, setAfter] = useState<number>(a.spaceAfter ?? 8);
  const [line, setLine] = useState<string>(a.lineHeight ?? "1.15");
  const num = (label: string, v: number, set: (n: number) => void) => (
    <label className="text-[12px] text-neutral-400">{label}<input type="number" step={0.5} value={v} onChange={(e) => set(Number(e.target.value))} className={`${field} mt-1`} /></label>
  );
  const apply = () => {
    editor
      .chain()
      .focus()
      .setTextAlign(align)
      .setLineHeight(line)
      .updateAttributes(type, { indentLeft: left || null, indentRight: right || null, indentFirst: first || null, spaceBefore: before, spaceAfter: after })
      .run();
    onClose();
  };
  return (
    <Modal onClose={onClose} className="w-[460px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">Paragraph</h2>
      <label className="text-[12px] text-neutral-400">Alignment
        <select value={align} onChange={(e) => setAlign(e.target.value)} className={`${field} mt-1`}>
          <option value="left">Left</option><option value="center">Centred</option><option value="right">Right</option><option value="justify">Justified</option>
        </select>
      </label>
      <p className="mb-1 mt-4 text-[12px] font-semibold text-neutral-300">Indentation (pt)</p>
      <div className="grid grid-cols-3 gap-3">{num("Left", left, setLeft)}{num("Right", right, setRight)}{num("First line (− = hanging)", first, setFirst)}</div>
      <p className="mb-1 mt-4 text-[12px] font-semibold text-neutral-300">Spacing</p>
      <div className="grid grid-cols-3 gap-3">
        {num("Before (pt)", before, setBefore)}
        {num("After (pt)", after, setAfter)}
        <label className="text-[12px] text-neutral-400">Line spacing
          <select value={line} onChange={(e) => setLine(e.target.value)} className={`${field} mt-1`}>{["1", "1.15", "1.5", "2", "2.5", "3"].map((x) => <option key={x}>{x}</option>)}</select>
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" autoFocus onClick={apply}>OK</ModalButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ groups */
function useActive(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      align: (["left", "center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      font: (e.getAttributes("textStyle").fontFamily as string | undefined)?.replace(/["']/g, "") ?? "Calibri",
      size: parseFloat(e.getAttributes("textStyle").fontSize ?? "") || 11,
      level: ([1, 2, 3, 4] as const).find((l) => e.isActive("heading", { level: l })) ?? null,
      words: e.state.doc.textContent.split(/\s+/).filter(Boolean).length,
    }),
  });
}

function HomeGroups({ editor, compact }: { editor: Editor; compact?: boolean }) {
  const a = useActive(editor);
  const c = () => editor.chain().focus();
  return (
    <>
      <Btn title="Undo (Ctrl+Z)" onClick={() => c().undo().run()}><Undo2 /></Btn>
      <Btn title="Redo (Ctrl+Y)" onClick={() => c().redo().run()}><Redo2 /></Btn>
      <Sep />
      {!compact && (
        <Select
          value={String(a.level ?? "")}
          onChange={(v) => (v ? c().setHeading({ level: Number(v) as 1 }).run() : c().setParagraph().run())}
          options={STYLES.map((s) => [String(s.level ?? ""), s.label])}
          width={110}
        />
      )}
      <Select value={a.font} onChange={(v) => c().setFontFamily(v).run()} options={FONTS.map((f) => [f, f])} width={130} fontPreview />
      <Select value={String(a.size)} onChange={(v) => c().setFontSize(`${v}pt`).run()} options={SIZES.map((s) => [String(s), String(s)])} width={58} />
      <Sep />
      <Btn title="Bold (Ctrl+B)" on={a.bold} onClick={() => c().toggleBold().run()}><Bold /></Btn>
      <Btn title="Italic (Ctrl+I)" on={a.italic} onClick={() => c().toggleItalic().run()}><Italic /></Btn>
      <Btn title="Underline (Ctrl+U)" on={a.underline} onClick={() => c().toggleUnderline().run()}><UnderlineIcon /></Btn>
      <Btn title="Strikethrough" on={a.strike} onClick={() => c().toggleStrike().run()}><Strikethrough /></Btn>
      <ColorBtn title="Text color" onPick={(col) => c().setColor(col).run()}>A</ColorBtn>
      <ColorBtn title="Highlight" highlight onPick={(col) => c().toggleHighlight({ color: col }).run()}><Highlighter className="size-4" /></ColorBtn>
      <Sep />
      {(["left", "center", "right", "justify"] as const).map((al) => (
        <Btn key={al} title={`Align ${al}`} on={a.align === al} onClick={() => alignTo(editor, al)}>
          {{ left: <AlignLeft />, center: <AlignCenter />, right: <AlignRight />, justify: <AlignJustify /> }[al]}
        </Btn>
      ))}
      {!compact && (
        <Select value="" onChange={(v) => c().setLineHeight(v).run()} options={[["", "Spacing"], ...SPACING.map((s) => [s, s] as [string, string])]} width={84} />
      )}
      <Sep />
      <Btn title="Bulleted list" on={a.bullet} onClick={() => c().toggleBulletList().run()}><List /></Btn>
      <Btn title="Numbered list" on={a.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></Btn>
      {!compact && (
        <>
          <Btn title="Decrease indent" onClick={() => c().liftListItem("listItem").run()}><IndentDecrease /></Btn>
          <Btn title="Increase indent" onClick={() => c().sinkListItem("listItem").run()}><IndentIncrease /></Btn>
          <Btn title="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}><RotateCcw /></Btn>
        </>
      )}
    </>
  );
}

function InsertGroup({ editor, page, updatePage }: { editor: Editor; page: PageSetup; updatePage: (p: Partial<PageSetup>) => void }) {
  const c = () => editor.chain().focus();
  return (
    <>
      <Big icon={<Table2 />} label="Table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Big
        icon={<ImagePlus />}
        label="Image"
        onClick={async () => {
          const file = await open({ filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
          if (typeof file !== "string") return;
          const bytes = await readDoc(file);
          const ext = file.split(".").pop()!.toLowerCase().replace("jpg", "jpeg");
          let bin = "";
          bytes.forEach((b) => (bin += String.fromCharCode(b)));
          c().setImage({ src: `data:image/${ext};base64,${btoa(bin)}` }).run();
        }}
      />
      <Big icon={<SeparatorHorizontal />} label="Page break" onClick={() => c().insertContent({ type: "pageBreak" }).run()} />
      <Sep />
      <Field label="Header" value={page.header} onChange={(v) => updatePage({ header: v })} />
      <Field label="Footer" value={page.footer} onChange={(v) => updatePage({ footer: v })} />
      <label className="flex items-center gap-1.5 px-2 text-[12px] text-neutral-300">
        <input type="checkbox" checked={page.pageNumbers} onChange={(e) => updatePage({ pageNumbers: e.target.checked })} className="accent-[var(--oc-docs)]" />
        Page numbers
      </label>
    </>
  );
}

const PT = 96 / 72;
/** Page border drawn on each page card, measured from the page edge or the text. */
function BorderBox({ border: b, margin }: { border: PageBorder; margin: PageSetup["margin"] }) {
  const inset = (side: keyof PageSetup["margin"]) =>
    b.from === "page" ? b.space * PT : Math.max(0, margin[side] * PX_PER_MM - b.space * PT - b.width * PT);
  const line = (on: boolean) => (on ? `${Math.max(b.style === "double" ? 3 : 1, b.width * PT)}px ${b.style === "single" ? "solid" : b.style} ${b.color}` : "none");
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: inset("top"), right: inset("right"), bottom: inset("bottom"), left: inset("left"),
        borderTop: line(b.sides.top), borderRight: line(b.sides.right), borderBottom: line(b.sides.bottom), borderLeft: line(b.sides.left),
      }}
    />
  );
}

function BorderGroup({ page, updatePage }: { page: PageSetup; updatePage: (p: Partial<PageSetup>) => void }) {
  const b: PageBorder = page.border ?? { style: "single", width: 1, color: "#000000", sides: { top: true, right: true, bottom: true, left: true }, from: "text", space: 4 };
  const set = (patch: Partial<PageBorder>) => updatePage({ border: { ...b, ...patch } });
  const sel = "h-7 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-surface)] px-1 text-[12px] text-neutral-200 outline-none";
  return (
    <>
      <span className="px-1 text-[12px] text-neutral-500">Border</span>
      <select value={page.border ? b.style : "none"} onChange={(e) => (e.target.value === "none" ? updatePage({ border: undefined }) : set({ style: e.target.value as PageBorder["style"] }))} className={sel}>
        <option value="none">None</option>
        <option value="single">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
        <option value="double">Double</option>
      </select>
      {page.border && (
        <>
          <select value={b.width} onChange={(e) => set({ width: Number(e.target.value) })} className={sel} title="Width">
            {[0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => <option key={w} value={w}>{w} pt</option>)}
          </select>
          <input type="color" value={b.color} onChange={(e) => set({ color: e.target.value })} title="Colour" className="h-7 w-8 cursor-pointer rounded border border-white/[0.08] bg-transparent" />
          {(["top", "right", "bottom", "left"] as const).map((s) => (
            <Chip key={s} on={b.sides[s]} onClick={() => set({ sides: { ...b.sides, [s]: !b.sides[s] } })}>
              {s[0].toUpperCase() + s.slice(1)}
            </Chip>
          ))}
          <select value={b.from} onChange={(e) => set({ from: e.target.value as PageBorder["from"] })} className={sel} title="Measure from">
            <option value="text">From text</option>
            <option value="page">From page edge</option>
          </select>
          <input type="number" min={0} max={31} value={b.space} onChange={(e) => set({ space: Number(e.target.value) })} title="Distance (pt)" className="h-7 w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 text-[12px] text-neutral-200 outline-none" />
          <span className="text-[11px] text-neutral-500">pt</span>
        </>
      )}
    </>
  );
}

function LayoutGroup({ page, updatePage }: { page: PageSetup; updatePage: (p: Partial<PageSetup>) => void }) {
  const presets: [string, number][] = [["Normal", 25.4], ["Narrow", 12.7], ["Moderate", 19.1], ["Wide", 50.8]];
  const num = "h-7 w-20 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[12px] text-neutral-200 outline-none";
  return (
    <>
      <span className="px-1 text-[12px] text-neutral-500">Margins</span>
      {presets.map(([label, mm]) => (
        <Chip key={label} on={page.margin.left === mm && page.margin.top === mm} onClick={() => updatePage({ margin: { top: mm, right: mm, bottom: mm, left: mm } })}>
          {label}
        </Chip>
      ))}
      <span className="ml-2 text-[11px] text-neutral-500">Custom</span>
      <input type="number" value={page.margin.top} onChange={(e) => updatePage({ margin: { ...page.margin, top: Number(e.target.value) } })} className={num} title="Top" />
      <span className="text-[11px] text-neutral-500">T</span>
      <input type="number" value={page.margin.right} onChange={(e) => updatePage({ margin: { ...page.margin, right: Number(e.target.value) } })} className={num} title="Right" />
      <span className="text-[11px] text-neutral-500">R</span>
      <input type="number" value={page.margin.bottom} onChange={(e) => updatePage({ margin: { ...page.margin, bottom: Number(e.target.value) } })} className={num} title="Bottom" />
      <span className="text-[11px] text-neutral-500">B</span>
      <input type="number" value={page.margin.left} onChange={(e) => updatePage({ margin: { ...page.margin, left: Number(e.target.value) } })} className={num} title="Left" />
      <span className="text-[11px] text-neutral-500">L</span>
      <Sep />
      <span className="px-1 text-[12px] text-neutral-500">Orientation</span>
      {(["portrait", "landscape"] as const).map((o) => (
        <Chip key={o} on={page.orientation === o} onClick={() => updatePage({ orientation: o })}>
          {o === "portrait" ? "Portrait" : "Landscape"}
        </Chip>
      ))}
      <Sep />
      <span className="px-1 text-[12px] text-neutral-500">Size</span>
      {(["A4", "Letter"] as const).map((s) => (
        <Chip key={s} on={page.size === s} onClick={() => updatePage({ size: s })}>
          {s}
        </Chip>
      ))}
      <Sep />
      <BorderGroup page={page} updatePage={updatePage} />
    </>
  );
}

function ReviewGroup({ editor, onFind }: { editor: Editor; onFind: () => void }) {
  const a = useActive(editor);
  return (
    <>
      <Big icon={<Search />} label="Find & replace" onClick={onFind} />
      <Sep />
      <span className="px-2 text-[13px] text-neutral-300">
        <b className="text-neutral-100">{a.words.toLocaleString()}</b> words · {editor.state.doc.textContent.length.toLocaleString()} characters
      </span>
    </>
  );
}

function FileGroup({ onNew, onOpen, onCopy, onSave }: { onNew: () => void; onOpen: () => void; onCopy: () => void; onSave: () => void }) {
  return (
    <>
      <Big icon={<FilePlus />} label="New" onClick={onNew} />
      <Big icon={<FolderOpen />} label="Open…" onClick={onOpen} />
      <Big icon={<Save />} label="Save" onClick={onSave} />
      <Big icon={<FileDown />} label="Save as copy" onClick={onCopy} />
      <Big icon={<Printer />} label="Print / PDF" onClick={() => window.print()} />
    </>
  );
}

/** Find & replace across the document's text nodes. */
function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState("");
  const hits: { from: number; to: number }[] = [];
  if (q)
    editor.state.doc.descendants((n, pos) => {
      if (!n.isText) return;
      const t = n.text!.toLowerCase();
      for (let i = t.indexOf(q.toLowerCase()); i >= 0; i = t.indexOf(q.toLowerCase(), i + q.length)) hits.push({ from: pos + i, to: pos + i + q.length });
    });
  const input = "h-7 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none focus:border-[color:var(--oc-docs)]";
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[var(--oc-surface)] px-4 py-1.5 text-[13px]">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" className={input} onKeyDown={(e) => e.key === "Escape" && onClose()} />
      <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Replace with" className={input} />
      <span className="text-neutral-500">{q ? `${hits.length} found` : ""}</span>
      <Chip on={false} onClick={() => hits[0] && editor.chain().focus().setTextSelection(hits[0]).scrollIntoView().run()}>Find</Chip>
      <Chip on={false} onClick={() => hits[0] && editor.chain().focus().insertContentAt(hits[0], r).run()}>Replace</Chip>
      <Chip on={false} onClick={() => [...hits].reverse().forEach((h) => editor.chain().insertContentAt(h, r).run())}>Replace all</Chip>
      <span className="flex-1" />
      <button type="button" onClick={onClose} className="cursor-pointer text-neutral-500 hover:text-neutral-300">Close</button>
    </div>
  );
}

/* ------------------------------------------------------------ primitives */
function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-white/[0.06] bg-[var(--oc-surface)]/50 p-2">
      <div className="w-full px-1 text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}
function SaveStatus({ status }: { status: Status }) {
  const label = { loading: "Opening…", saving: "Saving…", saved: "Saved", error: "Couldn't save", unsaved: "Not saved · Ctrl+S" }[status];
  return <span className={`px-2 text-[12px] ${status === "error" ? "text-red-400" : "text-neutral-500"}`}>{label}</span>;
}
const Sep = () => <span className="mx-1 h-6 w-px bg-white/[0.08]" />;
function Btn({ title, on, onClick, children }: { title: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-tip={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`oc-press grid size-[34px] cursor-pointer place-items-center rounded-md transition-colors duration-150 [&_svg]:size-[17px] ${on ? "bg-[color:var(--oc-docs)]/20 text-[color:var(--oc-docs-light)]" : "text-neutral-300 hover:bg-white/[0.06]"}`}
    >
      {children}
    </button>
  );
}
function Big({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="flex h-14 min-w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-2 text-[12px] text-neutral-300 hover:bg-white/[0.06] [&_svg]:size-5 [&_svg]:text-[color:var(--oc-docs-light)]">
      {icon}
      {label}
    </button>
  );
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`h-7 cursor-pointer rounded-md px-2.5 text-[12px] ${on ? "bg-[color:var(--oc-docs)]/20 text-[color:var(--oc-docs-light)]" : "text-neutral-300 hover:bg-white/[0.06]"}`}>
      {children}
    </button>
  );
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 px-1 text-[12px] text-neutral-500">
      {label}
      <input defaultValue={value} onBlur={(e) => onChange(e.target.value)} className="h-7 w-40 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none" />
    </label>
  );
}
/** Fixed-position popover under an anchor (the ribbon scrolls, so absolute menus would clip). */
function useAnchor() {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    setAt((v) => (v || !r ? null : { left: r.left, top: r.bottom + 4, width: r.width }));
  };
  return { ref, at, toggle, close: () => setAt(null) };
}
function Popover({ at, onClose, children, className = "" }: { at: { left: number; top: number }; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div
        className={`oc-docs-pop fixed z-[61] rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${className}`}
        style={{ left: at.left, top: at.top }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </>
  );
}

/** Styled dropdown (fonts preview in their own face). */
function Select({ value, onChange, options, width, fontPreview }: { value: string; onChange: (v: string) => void; options: [string, string][]; width: number; fontPreview?: boolean }) {
  const p = useAnchor();
  const label = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <>
      <button
        ref={p.ref}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
        style={{ width, fontFamily: fontPreview ? value : undefined }}
        className={`flex h-8 cursor-pointer items-center gap-1 rounded-md border bg-[var(--oc-surface)] pl-2 pr-1 text-[13px] text-neutral-200 transition-colors duration-150 ${p.at ? "border-[color:var(--oc-docs)]" : "border-white/[0.08] hover:border-white/20"}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-neutral-500 transition-transform duration-200 ${p.at ? "rotate-180" : ""}`} />
      </button>
      {p.at && (
        <Popover at={p.at} onClose={p.close} className="scrollbar-thin max-h-72 overflow-y-auto">
          <div style={{ minWidth: Math.max(p.at.width, fontPreview ? 200 : 0) }}>
            {options.map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => (onChange(v), p.close())}
                style={{ fontFamily: fontPreview ? v : undefined }}
                className={`flex h-8 w-full cursor-pointer items-center rounded-md px-2.5 text-left ${fontPreview ? "text-[15px]" : "text-[13px]"} ${v === value ? "bg-[color:var(--oc-docs)]/15 text-[color:var(--oc-docs-light)]" : "text-neutral-200 hover:bg-white/[0.06]"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}


const SWATCHES = ["#000000", "#434343", "#999999", "#c00000", "#e36c09", "#f1c232", "#38761d", "#0b5394", "#674ea7", "#a61c00", "#ffff00", "#00ff00", "#00ffff", "#ff00ff"];
function ColorBtn({ title, onPick, highlight, children }: { title: string; onPick: (c: string) => void; highlight?: boolean; children: ReactNode }) {
  const p = useAnchor();
  return (
    <>
      <button
        ref={p.ref}
        type="button"
        data-tip={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.toggle}
        className="oc-press grid size-[34px] cursor-pointer place-items-center rounded-md text-neutral-300 transition-colors duration-150 hover:bg-white/[0.06]"
      >
        <span className={`font-bold ${highlight ? "" : "underline decoration-red-500 decoration-2"}`}>{children}</span>
      </button>
      {p.at && (
        <Popover at={p.at} onClose={p.close}>
          <div className="grid w-[176px] grid-cols-7 gap-1 p-1.5">
            {SWATCHES.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => (onPick(c), p.close())}
                className="oc-swatch size-5 cursor-pointer rounded border border-white/10 transition-transform duration-150 hover:scale-125"
                style={{ background: c, animationDelay: `${i * 12}ms` }}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
