/* ---------------------------------------------------------------------------
 * The PDF reader: a full-view route (`pdf:<docId>`) with pages stacked
 * vertically. Only pages near the viewport (±2) render; each one stacks the
 * pdf.js canvas, its selectable text layer and an SVG annotation layer whose
 * viewBox is the page in PDF points, so annotations never store pixels.
 * ------------------------------------------------------------------------ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  Circle,
  Columns2,
  Copy,
  Eraser,
  Highlighter,
  Minus,
  Download,
  FileDown,
  PenLine,
  Quote,
  Search,
  X,
  Square,
  StickyNote,
  Type,
  Maximize,
  Moon,
  MousePointer2,
  Redo2,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, type PdfDocRecord } from "../data/api";
import { notifyPdfChanged, openPdf, pageText, pdfErrorMessage, pdfjs } from "./pdfjs";
import { OPEN_PDF, pendingJump, type PdfTarget } from "./importPdf";
import type { PdfAnnotationKind } from "../data/api";
import { HIGHLIGHT_COLORS, INK_COLORS, MARKUP, bbox, rangeText, selectionRects, toRecord, type Ann, type AnnData } from "./annotations";
import { AnnotationLayer, DRAW_TOOLS, type Tool } from "./AnnotationLayer";
import { AnnBar, SelectionBar, StickyPopover, Swatches, TextBoxEditor } from "./Overlays";
import { useAnnotations } from "./useAnnotations";
import { requestDelete } from "../lib/confirmDelete";
import { openContextMenu } from "../components/ContextMenu";
import { Toast } from "../components/Toast";
import { pdfNames, sendToNote } from "./PdfRef";
import { annotatedName, annotatedPdf } from "./exportPdf";
import { getPdfBytes } from "./bytes";
import { pickSaveTarget } from "../lib/export";

/** "width" / "page" fit the viewport; a number is a percentage. */
type Zoom = "width" | "page" | number;
type Size = { w: number; h: number };

const GAP = 16;
const PAD = 32;
const ZOOMS = [25, 50, 67, 80, 100, 125, 150, 200, 300, 400];
const parseZoom = (z: string): Zoom => (z === "page" || z === "width" ? z : Number(z) || "width");

/* ------------------------------------------------------------------- find */
const norm = (s: string) => s.toLowerCase();

/** Every case-insensitive occurrence of `q` in a text layer, as page-relative pixel rects. */
function findInLayer(layer: HTMLElement, q: string): DOMRect[][] {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: n as Text, start: text.length });
      text += (n as Text).data;
    } else if ((n as Element).tagName === "BR") text += " ";
  }
  const hay = norm(text);
  const needle = norm(q);
  const at = (i: number) => {
    let k = nodes.length - 1;
    while (k > 0 && nodes[k].start > i) k--;
    return { node: nodes[k].node, offset: Math.min(nodes[k].node.length, i - nodes[k].start) };
  };
  const base = layer.getBoundingClientRect();
  const out: DOMRect[][] = [];
  for (let i = hay.indexOf(needle); needle && i >= 0 && nodes.length; i = hay.indexOf(needle, i + needle.length)) {
    const a = at(i);
    const b = at(i + needle.length);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    out.push([...r.getClientRects()].map((c) => new DOMRect(c.left - base.left, c.top - base.top, c.width, c.height)));
  }
  return out;
}

/** Find matches on one rendered page; the current one is emphasised and scrolled into view. */
function FindMarks({ layer, query, active, ready, scale }: { layer: HTMLDivElement | null; query: string; active: number; ready: number; scale: number }) {
  const [marks, setMarks] = useState<DOMRect[][]>([]);
  const activeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setMarks(layer && query ? findInLayer(layer, query) : []), [layer, query, ready, scale]);
  useEffect(() => void activeRef.current?.scrollIntoView({ block: "center", inline: "nearest" }), [active, marks]);
  return (
    <>
      {marks.flatMap((rects, i) =>
        rects.map((r, j) => (
          <div
            key={`${i}:${j}`}
            ref={i === active && j === 0 ? activeRef : undefined}
            className={`oc-pdf-find ${i === active ? "oc-pdf-find-on" : ""}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        )),
      )}
    </>
  );
}

/* ------------------------------------------------------------------- page */
function PdfPage({
  pdf,
  n,
  size,
  scale,
  live,
  query,
  activeMatch,
  children,
}: {
  pdf: PDFDocumentProxy;
  n: number;
  size: Size;
  scale: number;
  /** Near the viewport: render canvas + text; otherwise an empty sheet. */
  live: boolean;
  /** Find: the query, and which of this page's matches is current (-1: none). */
  query: string;
  activeMatch: number;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  /** Bumped when the text layer finishes rendering (find re-measures). */
  const [textReady, setTextReady] = useState(0);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    let text: { cancel(): void } | null = null;
    void pdf.getPage(n).then((page) => {
      if (cancelled || !canvasRef.current || !textRef.current) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current;
      // Draw offscreen first so a zoom change never flashes a blank page.
      const off = Object.assign(document.createElement("canvas"), { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
      const render = page.render({ canvasContext: off.getContext("2d")!, viewport });
      task = render;
      render.promise
        .then(() => {
          if (cancelled) return;
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext("2d")!.drawImage(off, 0, 0);
        })
        .catch(() => {});
      const container = textRef.current;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport: page.getViewport({ scale }) });
      text = layer;
      // Like pdf.js's viewer: an end-of-content sheet keeps drags over gaps from selecting to the end.
      layer
        .render()
        .then(() => {
          container.append(Object.assign(document.createElement("div"), { className: "endOfContent" }));
          if (!cancelled) setTextReady((v) => v + 1);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [pdf, n, scale, live]);

  return (
    <div className="oc-pdf-page" data-page={n} style={{ width: size.w * scale, height: size.h * scale }}>
      {live && (
        <>
          <canvas ref={canvasRef} className="oc-pdf-canvas" />
          <div
            ref={textRef}
            className="textLayer"
            onMouseDown={(e) => {
              const el = e.currentTarget;
              el.classList.add("selecting");
              window.addEventListener("mouseup", () => el.classList.remove("selecting"), { once: true });
            }}
          />
          {query && <FindMarks layer={textRef.current} query={query} active={activeMatch} ready={textReady} scale={scale} />}
          {children}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- toolbar */
export function PillButton({
  tip,
  active,
  disabled,
  onClick,
  children,
}: {
  tip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`oc-pdf-tool ${active ? "oc-pdf-tool-on" : ""}`} data-tip={tip} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const MARKUP_TOOLS = {
  highlight: { tip: "Highlight text", icon: <Highlighter size={17} /> },
  underline: { tip: "Underline text", icon: <Underline size={17} /> },
  strike: { tip: "Strike through text", icon: <Strikethrough size={17} /> },
};
const SHAPE_TOOLS = {
  rect: { tip: "Rectangle (Shift: square)", icon: <Square size={17} /> },
  ellipse: { tip: "Ellipse (Shift: circle)", icon: <Circle size={17} /> },
  line: { tip: "Line (Shift: 45°)", icon: <Minus size={17} className="-rotate-45" /> },
  arrow: { tip: "Arrow (Shift: 45°)", icon: <ArrowUpRight size={17} /> },
};

/* ------------------------------------------------------------------ reader */
export function PdfReader({ docId, onBack }: { docId: string; onBack: () => void }) {
  const [doc, setDoc] = useState<PdfDocRecord | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [zoom, setZoom] = useState<Zoom>("width");
  const [view, setView] = useState({ w: 0, h: 0, top: 0 });
  const [pageBox, setPageBox] = useState("1");
  const [dark, setDark] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const store = useAnnotations(docId);
  const [tool, setTool] = useState<Tool>("select");
  const [markColor, setMarkColor] = useState(HIGHLIGHT_COLORS[0]);
  const [inkColor, setInkColor] = useState(INK_COLORS[5]);
  const [penWidth, setPenWidth] = useState(2);
  /** Pen, shapes and text use the ink palette; markup and stickies the highlighter one. */
  const inkTool = DRAW_TOOLS.includes(tool) && tool !== "sticky" && tool !== "eraser";
  const color = inkTool ? inkColor : markColor;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** The text-selection bar, at the end of the selection (viewport pixels). */
  const [selBar, setSelBar] = useState<{ x: number; y: number } | null>(null);
  /** Find bar: open, query, per-page match counts (from the extracted text), current match. */
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pageTexts, setPageTexts] = useState<string[] | null>(null);
  const [matchIdx, setMatchIdx] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  /** A pill flyout (zoom menu, markup styles, shapes, colour), at the y of its button. */
  const [fly, setFly] = useState<{ kind: "zoom" | "markup" | "shapes" | "color" | "export"; top: number } | null>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const [lastMarkup, setLastMarkup] = useState<keyof typeof MARKUP_TOOLS>("highlight");
  const [lastShape, setLastShape] = useState<keyof typeof SHAPE_TOOLS>("rect");

  // Open the document and learn every page's size (in points).
  useEffect(() => {
    let live = true;
    restored.current = false;
    setPdf(null);
    setError(null);
    (async () => {
      const d = await api.getPdfDoc(docId);
      if (!d) throw new Error("This PDF is missing from Oceanic's storage.");
      if (!live) return;
      pdfNames.set(d.id, d.name);
      setDoc(d);
      setZoom(parseZoom(d.zoom));
      const p = await openPdf(d);
      const first = (await p.getPage(1)).getViewport({ scale: 1 });
      if (!live) return;
      setSizes(Array.from({ length: p.numPages }, () => ({ w: first.width, h: first.height })));
      setPdf(p);
      // Mixed page sizes: fill in the real ones as they arrive.
      const all: Size[] = [];
      for (let n = 1; n <= p.numPages; n++) {
        const v = (await p.getPage(n)).getViewport({ scale: 1 });
        all.push({ w: v.width, h: v.height });
      }
      if (live && all.some((s) => s.w !== first.width || s.h !== first.height)) setSizes(all);
    })().catch((e) => live && setError(pdfErrorMessage(e)));
    return () => void (live = false);
  }, [docId]);

  // Track the viewport.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight, top: el.scrollTop });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => (ro.disconnect(), el.removeEventListener("scroll", measure));
  }, [pdf]);

  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const scale = useMemo(() => {
    if (!sizes.length || !view.w) return 1;
    if (zoom === "width") return Math.max(0.1, (view.w - PAD * 2) / maxW);
    if (zoom === "page") return Math.max(0.1, Math.min((view.w - PAD * 2) / sizes[0].w, (view.h - PAD * 2) / sizes[0].h));
    return zoom / 100;
  }, [zoom, sizes, view.w, view.h, maxW]);

  /** Top of each page in the scroller, at the current scale. */
  const tops = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      out.push(y);
      y += s.h * scale + GAP;
    }
    out.push(y);
    return out;
  }, [sizes, scale]);

  const pageAt = (y: number) => {
    let n = 1;
    while (n < sizes.length && tops[n] <= y) n++;
    return n;
  };
  const current = sizes.length ? pageAt(view.top + view.h / 3) : 1;
  const first = sizes.length ? pageAt(view.top) : 1;
  const lastVisible = sizes.length ? pageAt(view.top + view.h) : 1;

  const goTo = (n: number, offsetPt = 0) => {
    const el = scroller.current;
    if (!el || !sizes.length) return;
    const p = Math.min(sizes.length, Math.max(1, n));
    el.scrollTop = tops[p - 1] - PAD / 2 + offsetPt * scale;
  };

  // Keep the page under the reading line steady when the scale changes.
  const anchor = useRef<{ page: number; pt: number } | null>(null);
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    if (lastScale.current === scale) return;
    const a = anchor.current;
    lastScale.current = scale;
    if (a) goTo(a.page, a.pt);
  }, [scale]);
  useEffect(() => {
    if (!sizes.length) return;
    const y = view.top + PAD / 2;
    const p = pageAt(y);
    anchor.current = { page: p, pt: (y - tops[p - 1]) / scale };
  }, [view.top, tops]);

  /** Jump to a link's target: its annotation (scrolled into view and flashed), else its page. */
  const jumpTo = (t: PdfTarget) => {
    const a = t.annotationId ? store.anns.find((x) => x.id === t.annotationId) : undefined;
    if (a) {
      goTo(a.page, Math.max(0, bbox(a).y - 60));
      setFlashId(a.id);
      window.setTimeout(() => setFlashId((f) => (f === a.id ? null : f)), 2000);
    } else if (t.page) goTo(t.page);
  };

  // First layout (once annotations are in): restore the last page, or jump where a link asked to.
  useLayoutEffect(() => {
    if (!pdf || !doc || restored.current || !view.w || !store.loaded) return;
    restored.current = true;
    const jump = pendingJump.get(docId);
    pendingJump.delete(docId);
    if (jump) jumpTo(jump);
    else goTo(doc.lastPage ?? 1);
  }, [pdf, doc, view.w, tops, store.loaded]);

  // Already open: a chip or search hit jumps right away.
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<PdfTarget>).detail;
      if (t.docId !== docId || !restored.current) return;
      pendingJump.delete(docId);
      jumpTo(t);
    };
    window.addEventListener(OPEN_PDF, on);
    return () => window.removeEventListener(OPEN_PDF, on);
  });

  useEffect(() => setPageBox(String(current)), [current]);

  // Remember the page and zoom (debounced).
  useEffect(() => {
    if (!pdf || !restored.current) return;
    const t = window.setTimeout(() => {
      void api.savePdfDocState(docId, pdf.numPages, current, String(zoom)).then(() => notifyPdfChanged(docId));
    }, 600);
    return () => window.clearTimeout(t);
  }, [current, zoom, pdf]);

  const zoomBy = (dir: 1 | -1) => {
    const pct = Math.round(scale * 100);
    const next = dir > 0 ? ZOOMS.find((z) => z > pct) : [...ZOOMS].reverse().find((z) => z < pct);
    if (next) setZoom(next);
  };

  // Ctrl+wheel zooms; Ctrl +/-/0 too.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(Math.min(400, Math.max(25, Math.round(scale * 100 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, pdf]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    if (mod && (e.key === "=" || e.key === "+")) zoomBy(1);
    else if (mod && e.key === "-") zoomBy(-1);
    else if (mod && e.key === "0") setZoom("width");
    else if (e.key === "PageDown" || (e.key === "ArrowRight" && !mod)) goTo(current + 1);
    else if (e.key === "PageUp" || (e.key === "ArrowLeft" && !mod)) goTo(current - 1);
    else if (e.key === "Home" && mod) goTo(1);
    else if (e.key === "End" && mod) goTo(sizes.length);
    else return;
    e.preventDefault();
  };

  /* -------------------------------------------------------------- find */
  // Page texts for counting matches: the stored extraction, else read them now.
  useEffect(() => {
    if (!findOpen || pageTexts || !pdf) return;
    let live = true;
    (async () => {
      let texts = await api.getPdfText(docId).catch(() => [] as string[]);
      if (texts.length !== pdf.numPages) {
        texts = [];
        for (let n = 1; n <= pdf.numPages; n++) texts.push(await pageText(await pdf.getPage(n)).catch(() => ""));
      }
      if (live) setPageTexts(texts.map((t) => t.replace(/\s+/g, " ")));
    })();
    return () => void (live = false);
  }, [findOpen, pdf]);

  const q = findOpen ? query.trim() : "";
  /** All matches in reading order as [page, index within the page]. */
  const matches = useMemo(() => {
    if (!q || !pageTexts) return [];
    const needle = q.toLowerCase();
    const out: [number, number][] = [];
    pageTexts.forEach((t, i) => {
      const hay = t.toLowerCase();
      for (let at = hay.indexOf(needle), k = 0; at >= 0; at = hay.indexOf(needle, at + needle.length), k++) out.push([i + 1, k]);
    });
    return out;
  }, [q, pageTexts]);
  const match = matches[Math.min(matchIdx, matches.length - 1)];
  useEffect(() => setMatchIdx(0), [q]);
  // A new current match on a far page: scroll there; the page then centres the mark itself.
  useEffect(() => {
    if (match && (match[0] < first || match[0] > lastVisible)) goTo(match[0]);
  }, [match?.[0], match?.[1]]);
  const stepMatch = (d: number) => matches.length && setMatchIdx((i) => (i + d + matches.length) % matches.length);
  const openFind = () => {
    setFindOpen(true);
    window.setTimeout(() => (findInput.current?.focus(), findInput.current?.select()));
  };

  /* ------------------------------------------------------- annotations */
  const byPage = useMemo(() => {
    const m = new Map<number, Ann[]>();
    for (const a of store.anns) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return m;
  }, [store.anns]);

  const patch = (a: Ann, change: Partial<Ann> & { data?: AnnData }) => store.commit([{ id: a.id, before: a, after: { ...a, ...change } }]);
  const remove = (a: Ann) =>
    requestDelete({
      app: "notes",
      kind: "undoable",
      title: a.kind === "sticky" ? "This note" : "This annotation",
      run: () => {
        store.commit([{ id: a.id, before: a, after: null }]);
        setSelectedId(null);
        setEditingId(null);
      },
    });

  /** The current text selection → one markup annotation per page it touches. */
  const markSelection = (kind: PdfAnnotationKind) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const made: Ann[] = [];
    scroller.current?.querySelectorAll<HTMLElement>(".oc-pdf-page").forEach((el) => {
      const layer = el.querySelector(".textLayer");
      if (!layer || !range.intersectsNode(layer)) return;
      // Clip the range to this page for its rects and text.
      const sub = range.cloneRange();
      const all = document.createRange();
      all.selectNodeContents(layer);
      if (sub.compareBoundaryPoints(Range.START_TO_START, all) < 0) sub.setStart(all.startContainer, all.startOffset);
      if (sub.compareBoundaryPoints(Range.END_TO_END, all) > 0) sub.setEnd(all.endContainer, all.endOffset);
      const rects = selectionRects(sub, el, scale);
      if (!rects.length) return;
      made.push({
        id: crypto.randomUUID(),
        docId,
        page: Number(el.dataset.page),
        kind,
        color: markColor,
        data: { rects, text: rangeText(sub, layer) },
      });
    });
    sel.removeAllRanges();
    setSelBar(null);
    if (made.length) store.commit(made.map((a) => ({ id: a.id, before: null, after: a })));
  };

  // Releasing a text selection: mark it up straight away with a markup tool, else offer the bar.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onUp = () =>
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !el.contains(sel.anchorNode)) return setSelBar(null);
        if (MARKUP.includes(tool as PdfAnnotationKind)) return markSelection(tool as PdfAnnotationKind);
        const rects = sel.getRangeAt(0).getClientRects();
        const last = rects[rects.length - 1];
        if (last) setSelBar({ x: Math.min(window.innerWidth - 220, last.right), y: last.bottom + 8 });
      });
    el.addEventListener("mouseup", onUp);
    return () => el.removeEventListener("mouseup", onUp);
  });
  useEffect(() => {
    const onSel = () => window.getSelection()?.isCollapsed && setSelBar(null);
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // Undo/redo, delete, escape: anywhere in the reader except text fields.
  const keyRef = useRef({ store, selectedId, remove, openFind });
  keyRef.current = { store, selectedId, remove, openFind };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") return (e.preventDefault(), k.openFind());
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable=true]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "f") k.openFind();
      else if (mod && key === "z" && !e.shiftKey) k.store.undo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) k.store.redo();
      else if ((e.key === "Delete" || e.key === "Backspace") && k.selectedId) {
        const a = k.store.anns.find((x) => x.id === k.selectedId);
        if (a) k.remove(a);
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setEditingId(null);
        setTool("select");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Undone or deleted: drop a stale selection.
  useEffect(() => {
    if (selectedId && !store.anns.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [store.anns, selectedId]);

  /** Toggle a flyout next to the clicked pill button (running `also` too, e.g. picking that tool). */
  const openFly = (kind: NonNullable<typeof fly>["kind"], also?: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    also?.();
    const r = e.currentTarget.getBoundingClientRect();
    const host = e.currentTarget.closest(".oc-pdf-reader")!.getBoundingClientRect();
    setFly((f) => (f?.kind === kind ? null : { kind, top: r.top - host.top + r.height / 2 }));
  };
  useEffect(() => {
    if (!fly) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!flyRef.current?.contains(t) && !t.closest(".oc-pdf-pill")) setFly(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [fly]);

  /** Save the original file, or a copy with every annotation drawn in. */
  const exportPdf = async (annotated: boolean) => {
    setFly(null);
    if (!doc) return;
    const target = await pickSaveTarget(annotated ? annotatedName(doc.name) : doc.name || "Document.pdf");
    if (!target) return;
    try {
      const original = await getPdfBytes(doc.assetPath);
      // What's on screen, including edits the debounced save hasn't written yet.
      await target.write(annotated ? await annotatedPdf(original, store.anns.map(toRecord)) : original);
      setToast(`Saved to ${target.label}`);
    } catch (e) {
      console.error("PDF export failed", e);
      setToast("Couldn't export this PDF");
    }
  };

  const quote = (a: Ann) => {
    const title = sendToNote({ docId, page: a.page, annotationId: a.id, text: a.data.text ?? "" });
    setToast(title ? `Quote added to “${title}”` : "Open this PDF from a note to send quotes to it");
  };

  const annMenu = (a: Ann, e: React.MouseEvent) =>
    openContextMenu(e, [
      ...(MARKUP.includes(a.kind) && a.data.text ? [{ label: "Send to note", icon: <Quote className="size-4" />, onSelect: () => quote(a) }] : []),
      ...(a.data.text ? [{ label: "Copy text", icon: <Copy className="size-4" />, onSelect: () => void navigator.clipboard.writeText(a.data.text!) }] : []),
      "divider" as const,
      { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => remove(a) },
    ]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <TriangleAlert className="size-8 text-amber-400" />
        <p className="max-w-sm text-sm text-neutral-300">{error}</p>
        <button type="button" className="rounded-md bg-white/[0.06] px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/[0.1]" onClick={onBack}>
          Back to note
        </button>
      </div>
    );
  }

  return (
    <div className="oc-pdf-reader relative h-full outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="oc-pdf-pill" onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
        <PillButton tip="Back to note" onClick={onBack}>
          <ArrowLeft size={17} />
        </PillButton>
        <i className="oc-pdf-pill-sep" />
        <PillButton tip="Previous page (Page Up)" disabled={current <= 1} onClick={() => goTo(current - 1)}>
          <ChevronUp size={17} />
        </PillButton>
        <form
          className="oc-pdf-pagebox"
          data-tip="Go to page"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageBox, 10);
            if (n) goTo(n);
            (document.activeElement as HTMLElement)?.blur();
          }}
        >
          <input value={pageBox} onChange={(e) => setPageBox(e.target.value.replace(/\D/g, ""))} onFocus={(e) => e.target.select()} onBlur={() => setPageBox(String(current))} />
          <span>{sizes.length || "–"}</span>
        </form>
        <PillButton tip="Next page (Page Down)" disabled={current >= sizes.length} onClick={() => goTo(current + 1)}>
          <ChevronDown size={17} />
        </PillButton>
        <i className="oc-pdf-pill-sep" />
        <PillButton tip="Zoom in (Ctrl +)" onClick={() => zoomBy(1)}>
          <ZoomIn size={17} />
        </PillButton>
        <button type="button" className={`oc-pdf-zoom ${fly?.kind === "zoom" ? "oc-pdf-tool-on" : ""}`} data-tip="Zoom and fit" onClick={openFly("zoom")}>
          {Math.round(scale * 100)}%
        </button>
        <PillButton tip="Zoom out (Ctrl -)" onClick={() => zoomBy(-1)}>
          <ZoomOut size={17} />
        </PillButton>
        <PillButton tip={dark ? "Show pages in their colours" : "Dark pages"} active={dark} onClick={() => setDark((v) => !v)}>
          <Moon size={17} />
        </PillButton>
        <PillButton tip="Find (Ctrl F)" active={findOpen} onClick={() => (findOpen ? setFindOpen(false) : openFind())}>
          <Search size={17} />
        </PillButton>
        <PillButton tip="Export" active={fly?.kind === "export"} onClick={openFly("export")}>
          <Download size={17} />
        </PillButton>
        <i className="oc-pdf-pill-sep" />
        <PillButton tip="Select (Esc)" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 size={17} />
        </PillButton>
        <PillButton tip={`${MARKUP_TOOLS[lastMarkup].tip} (more styles)`} active={MARKUP.includes(tool as PdfAnnotationKind)} onClick={openFly("markup", () => setTool(lastMarkup))}>
          {MARKUP_TOOLS[lastMarkup].icon}
          <i className="oc-pdf-more" />
        </PillButton>
        <PillButton tip="Pen" active={tool === "pen"} onClick={() => setTool("pen")}>
          <PenLine size={17} />
        </PillButton>
        <PillButton tip="Eraser (whole strokes)" active={tool === "eraser"} onClick={() => setTool("eraser")}>
          <Eraser size={17} />
        </PillButton>
        <PillButton tip={`${SHAPE_TOOLS[lastShape].tip} (more shapes)`} active={tool in SHAPE_TOOLS} onClick={openFly("shapes", () => setTool(lastShape))}>
          {SHAPE_TOOLS[lastShape].icon}
          <i className="oc-pdf-more" />
        </PillButton>
        <PillButton tip="Text box" active={tool === "text"} onClick={() => setTool("text")}>
          <Type size={17} />
        </PillButton>
        <PillButton tip="Sticky note" active={tool === "sticky"} onClick={() => setTool("sticky")}>
          <StickyNote size={17} />
        </PillButton>
        <PillButton tip={inkTool ? "Colour and thickness" : "Colour"} active={fly?.kind === "color"} onClick={openFly("color")}>
          <span className="oc-pdf-swatch oc-pdf-swatch-on" style={{ background: color }} />
        </PillButton>
        <i className="oc-pdf-pill-sep" />
        <PillButton tip="Undo (Ctrl Z)" disabled={!store.canUndo} onClick={() => store.undo()}>
          <Undo2 size={17} />
        </PillButton>
        <PillButton tip="Redo (Ctrl Y)" disabled={!store.canRedo} onClick={() => store.redo()}>
          <Redo2 size={17} />
        </PillButton>
      </div>
      {fly && (
        <div ref={flyRef} className="oc-pdf-fly oc-pop-in" style={{ top: fly.top }} onMouseDown={(e) => e.preventDefault()}>
          {fly.kind === "export" && (
            <>
              <button type="button" className="oc-pdf-bar-btn" onClick={() => void exportPdf(true)}>
                <FileDown size={14} /> PDF with annotations
              </button>
              <button type="button" className="oc-pdf-bar-btn" onClick={() => void exportPdf(false)}>
                <FileDown size={14} /> Original PDF
              </button>
            </>
          )}
          {fly.kind === "zoom" && (
            <>
              <button type="button" className={`oc-pdf-bar-btn ${zoom === "width" ? "oc-pdf-tool-on" : ""}`} onClick={() => (setZoom("width"), setFly(null))}>
                <Columns2 size={14} /> Fit width
              </button>
              <button type="button" className={`oc-pdf-bar-btn ${zoom === "page" ? "oc-pdf-tool-on" : ""}`} onClick={() => (setZoom("page"), setFly(null))}>
                <Maximize size={14} /> Fit page
              </button>
              <i className="oc-pdf-bar-sep" />
              {[50, 100, 150, 200].map((z) => (
                <button key={z} type="button" className={`oc-pdf-bar-btn ${zoom === z ? "oc-pdf-tool-on" : ""}`} onClick={() => (setZoom(z), setFly(null))}>
                  {z}%
                </button>
              ))}
            </>
          )}
          {(fly.kind === "markup" || fly.kind === "shapes") &&
            Object.entries(fly.kind === "markup" ? MARKUP_TOOLS : SHAPE_TOOLS).map(([t, v]) => (
              <button
                key={t}
                type="button"
                className={`oc-pdf-tool ${tool === t ? "oc-pdf-tool-on" : ""}`}
                data-tip={v.tip}
                onClick={() => {
                  setTool(t as Tool);
                  if (fly.kind === "markup") setLastMarkup(t as keyof typeof MARKUP_TOOLS);
                  else setLastShape(t as keyof typeof SHAPE_TOOLS);
                  setFly(null);
                }}
              >
                {v.icon}
              </button>
            ))}
          {fly.kind === "color" &&
            (inkTool ? (
              <div>
                <Swatches colors={INK_COLORS} value={inkColor} onPick={setInkColor} />
                <div className="mt-2 flex items-center gap-1">
                  {[1, 2, 4, 8].map((w) => (
                    <button key={w} type="button" className={`oc-pdf-bar-btn ${w === penWidth ? "oc-pdf-tool-on" : ""}`} data-tip={`${w} pt`} onClick={() => setPenWidth(w)}>
                      <i className="block rounded-full bg-current" style={{ width: 16, height: Math.max(1, w * 0.8) }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Swatches colors={HIGHLIGHT_COLORS} value={markColor} onPick={(c) => (setMarkColor(c), setFly(null))} />
            ))}
        </div>
      )}
      {findOpen && (
        <div className="oc-pdf-findbar oc-pop-in">
          <Search size={14} className="shrink-0 text-neutral-500" />
          <input
            ref={findInput}
            value={query}
            placeholder="Find in PDF"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1);
              else if (e.key === "Escape") setFindOpen(false);
              else return;
              e.preventDefault();
            }}
          />
          <span className="oc-pdf-findcount">{q ? (pageTexts ? (matches.length ? `${Math.min(matchIdx, matches.length - 1) + 1} / ${matches.length}` : "No matches") : "…") : ""}</span>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Previous (Shift Enter)" disabled={!matches.length} onClick={() => stepMatch(-1)}>
            <ChevronUp size={15} />
          </button>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Next (Enter)" disabled={!matches.length} onClick={() => stepMatch(1)}>
            <ChevronDown size={15} />
          </button>
          <button type="button" className="oc-pdf-bar-btn" data-tip="Close (Esc)" onClick={() => setFindOpen(false)}>
            <X size={15} />
          </button>
        </div>
      )}
      {selBar && <SelectionBar x={selBar.x} y={selBar.y} color={markColor} onColor={setMarkColor} onMark={markSelection} />}

      <div ref={scroller} className={`oc-pdf-scroll scrollbar-thin ${dark ? "oc-pdf-dark" : ""}`}>
        {pdf && (
          <div className="oc-pdf-pages" style={{ paddingTop: PAD, paddingBottom: PAD, minWidth: maxW * scale + PAD * 2 }}>
            {sizes.map((s, i) => {
              const n = i + 1;
              const anns = byPage.get(n) ?? [];
              const sel = anns.find((a) => a.id === selectedId);
              const editing = anns.find((a) => a.id === editingId);
              return (
                <PdfPage
                  key={i}
                  pdf={pdf}
                  n={n}
                  size={s}
                  scale={scale}
                  live={n >= first - 2 && n <= lastVisible + 2}
                  query={q}
                  activeMatch={match?.[0] === n ? match[1] : -1}
                >
                  <AnnotationLayer
                    page={n}
                    size={s}
                    scale={scale}
                    docId={docId}
                    anns={anns}
                    tool={tool}
                    color={color}
                    width={penWidth}
                    selectedId={selectedId}
                    editingId={editingId}
                    flashId={flashId}
                    onSelect={setSelectedId}
                    onEdit={setEditingId}
                    onPreview={store.preview}
                    onCommit={store.commit}
                    onContextMenu={annMenu}
                  />
                  {sel && !editing && <AnnBar a={sel} scale={scale} onColor={(color) => patch(sel, { color })} onDelete={() => remove(sel)} />}
                  {editing?.kind === "text" && (
                    <TextBoxEditor a={editing} scale={scale} onDone={(text) => (setEditingId(null), patch(editing, { data: { ...editing.data, text } }))} />
                  )}
                  {editing?.kind === "sticky" && (
                    <StickyPopover
                      key={editing.id}
                      a={editing}
                      scale={scale}
                      pageWidth={s.w}
                      onText={(text) => text !== (editing.data.text ?? "") && patch(editing, { data: { ...editing.data, text } })}
                      onDelete={() => remove(editing)}
                      onClose={() => setEditingId(null)}
                    />
                  )}
                </PdfPage>
              );
            })}
          </div>
        )}
      </div>
      {doc && <div className="oc-pdf-title">{doc.name}</div>}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} duration={3000} />}
    </div>
  );
}
