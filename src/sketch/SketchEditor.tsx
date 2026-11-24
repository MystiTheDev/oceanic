import { registerSaver } from "../lib/embedSource";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  House,
  ArrowRight, Brush, Circle, ClipboardPaste, Copy, Crop, Droplet, Eraser, Eye, EyeOff, FlipHorizontal, FlipVertical, Hand, Highlighter,
  Layers, Minus, MousePointer2, PaintBucket, Pencil, Pipette, Plus, Redo2, RotateCcw, RotateCw, Save, Scaling, Scissors, Slash, Square, SprayCan,
  LassoSelect, Trash2, Triangle, Type, Undo2, ArrowUp, ArrowDown, Merge, CopyPlus,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Check, Grid3x3, Move, Sun,
} from "lucide-react";
import { WindowControls } from "../components/TitleBar";
import { Modal, ModalButton } from "../components/Modal";
import { SketchDoc, ctx2d, drawShape, floodFill, makeCanvas, rgbToHex, smoothPoints, type Blend, type Rect, type ShapeKind } from "./engine";
import { drawSegment, drawStroke, type Stroke } from "./ink";
import { FONTS, drawText, padOf, textBox, type TextObj } from "./text";
import { NewCanvasDialog } from "./SketchHome";
import { SlidePill } from "../components/SlidePill";
import {
  forgetSketch, isUnsavedSketch, markSketchDirty, pickImage, pickSketchSavePath, readImageFile, refreshSketches, sketchTitle, touchRecentSketch,
  untitledSketch, useSketch, writeImageFile,
} from "./store";

type Tool = "select" | "lasso" | "pencil" | "brush" | "marker" | "airbrush" | "eraser" | "fill" | "picker" | "text" | "hand" | ShapeKind;
type Pt = { x: number; y: number };
/** A lifted piece: drawn from `canvas` into box x/y/w/h, rotated `rot` (radians) about its centre, flipped by fx/fy. */
type Floating = { k: number; canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; rot: number; fx: 1 | -1; fy: 1 | -1; path?: Pt[] };
type TextStyle = Omit<TextObj, "id" | "layer" | "x" | "y" | "value">;
const GRID = 16;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const BLENDS: [Blend, string][] = [["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"], ["color-dodge", "Colour dodge"], ["color-burn", "Colour burn"]];
let floatKey = 0;

/** Paint a floating piece with its transform. */
function drawFloating(g: CanvasRenderingContext2D, f: Floating) {
  g.save();
  g.translate(f.x + f.w / 2, f.y + f.h / 2);
  g.rotate(f.rot);
  g.scale(f.fx, f.fy);
  g.drawImage(f.canvas, -f.w / 2, -f.h / 2, f.w, f.h);
  g.restore();
}

const PALETTE = [
  "#000000", "#7f7f7f", "#880015", "#ed1c24", "#ff7f27", "#fff200", "#22b14c", "#00a2e8", "#3f48cc", "#a349a4",
  "#ffffff", "#c3c3c3", "#b97a57", "#ffaec9", "#ffc90e", "#efe4b0", "#b5e61d", "#99d9ea", "#7092be", "#c8bfe7",
];
const SHAPES: { kind: ShapeKind; icon: ReactNode; label: string }[] = [
  { kind: "line", icon: <Slash />, label: "Line" },
  { kind: "rect", icon: <Square />, label: "Rectangle" },
  { kind: "roundrect", icon: <Square className="rounded-[5px]" />, label: "Rounded rectangle" },
  { kind: "ellipse", icon: <Circle />, label: "Ellipse" },
  { kind: "triangle", icon: <Triangle />, label: "Triangle" },
  { kind: "arrow", icon: <ArrowRight />, label: "Arrow" },
];
const SHAPE_KINDS = SHAPES.map((s) => s.kind) as string[];
const TOOL_KEYS: Record<string, Tool> = { s: "select", q: "lasso", p: "pencil", b: "brush", k: "marker", a: "airbrush", e: "eraser", g: "fill", i: "picker", t: "text", h: "hand", l: "line", u: "rect" };

type Status = "loading" | "saved" | "saving" | "unsaved" | "error";

/** Oceanic Sketch editor: layers, tools, history, real PNG/JPG files. */
export function SketchEditor({ path, onOpen, onSavedAs, onHome, onClose }: { path: string; onOpen: (p: string) => void; onSavedAs: (p: string) => void; onHome: () => void; onClose: () => void }) {
  const { layout } = useSketch();
  const docRef = useRef<SketchDoc | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [status, setStatus] = useState<Status>("loading");
  const [toolNow, setToolState] = useState<Tool>("brush");
  const tool = toolNow;
  const [size, setSize] = useState(6);
  const [color1, setColor1] = useState("#000000");
  const [color2, setColor2] = useState("#ffffff");
  const [shapeMode, setShapeMode] = useState<"outline" | "fill" | "both">("outline");
  const [textStyle, setTextStyle] = useState<TextStyle>({ font: FONTS[0].css, size: 28, color: "#000000", bold: false, italic: false, underline: false, align: "left", outline: null, bg: null, shadow: false });
  const [smooth, setSmooth] = useState(30);
  const [taper, setTaper] = useState(true);
  const [grid, setGrid] = useState(false);
  type BarTab = "draw" | "shapes" | "image" | "edit";
  const [barTab, setBarTab] = useState<BarTab>("draw");
  // The bar follows the active tool (pick a shape: Shapes tab; any other drawing tool: Draw).
  useEffect(() => { if (SHAPE_KINDS.includes(toolNow)) setBarTab("shapes"); else if (toolNow !== "select" && toolNow !== "lasso") setBarTab("draw"); }, [toolNow]);
  const snap = (p: Pt): Pt => (grid ? { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID } : p);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  // Palm rejection: while a pen is down, touches are ignored.
  const penId = useRef<number | null>(null);
  // Live text boxes: editable until baked into their layer.
  const [texts, setTexts] = useState<TextObj[]>([]);
  const [textSel, setTextSel] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [dialog, setDialog] = useState<null | "new" | "resize">(null);
  const [menu, setMenu] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(makeCanvas(1, 1));
  const saveTimer = useRef(0);
  const prevTool = useRef<Tool>("brush");
  const doc = docRef.current;

  /* ------------------------------------------------------------ load */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (isUnsavedSketch(path)) {
          const u = untitledSketch(path);
          docRef.current = new SketchDoc(u?.w ?? 1280, u?.h ?? 720);
          setStatus("unsaved");
        } else {
          const bytes = await readImageFile(path);
          const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
          if (!alive) return;
          const d = new SketchDoc(bmp.width, bmp.height);
          d.ctx.drawImage(bmp, 0, 0);
          docRef.current = d;
          touchRecentSketch(path);
          setStatus("saved");
        }
        docRef.current!.onChange = rerender;
        fitZoom();
        rerender();
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) (window.clearTimeout(saveTimer.current), void save());
    };
  }, [path]);

  const fitZoom = () => {
    const d = docRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    setZoom(Math.min(1, Math.max(0.05, Math.min((v.clientWidth - 80) / d.w, (v.clientHeight - 80) / d.h))));
  };

  /* ------------------------------------------------------------ layer DOM (canvases are live elements) */
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack || !doc) return;
    for (const l of doc.layers) {
      l.canvas.className = "absolute inset-0 h-full w-full";
      l.canvas.style.opacity = String(l.opacity);
      l.canvas.style.display = l.visible ? "" : "none";
      l.canvas.style.mixBlendMode = l.blend === "source-over" ? "normal" : l.blend;
    }
    const ov = overlay.current;
    if (ov.width !== doc.w || ov.height !== doc.h) (ov.width = doc.w), (ov.height = doc.h);
    ov.className = "pointer-events-none absolute inset-0 h-full w-full";
    stack.replaceChildren(...doc.layers.map((l) => l.canvas), ov);
  });

  /* ------------------------------------------------------------ saving */
  const save = async (): Promise<string | null> => {
    const d = docRef.current;
    if (!d) return null;
    const target = isUnsavedSketch(path) ? await pickSketchSavePath(sketchTitle(path)) : path;
    if (!target) return null;
    setStatus("saving");
    try {
      const jpg = /\.jpe?g$/i.test(target);
      const blob = await new Promise<Blob | null>((r) => composite(jpg).toBlob(r, jpg ? "image/jpeg" : "image/png", 0.92));
      await writeImageFile(target, new Uint8Array(await blob!.arrayBuffer()));
      void refreshSketches();
      if (target !== path) {
        forgetSketch(path);
        onSavedAs(target);
      } else setStatus("saved");
      return target;
    } catch {
      setStatus("error");
      return null;
    }
  };
  /** Everything on screen: layers, plus any floating piece and live text. */
  const composite = (opaque = false) => {
    const c = docRef.current!.flatten(opaque);
    const g = ctx2d(c);
    if (floating) drawFloating(g, floating);
    for (const t of texts) if (t.value.trim()) drawText(g, t);
    return c;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSaver(() => saveRef.current());
    return () => registerSaver(null);
  }, []);
  /** After every change: autosave real files, mark new ones unsaved. */
  const changed = () => {
    rerender();
    if (isUnsavedSketch(path)) return (markSketchDirty(path), setStatus("unsaved"));
    setStatus("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => ((saveTimer.current = 0), void save()), 1500);
  };
  const edit = (fn: (d: SketchDoc) => void) => {
    const d = docRef.current;
    if (!d) return;
    commitFloating();
    bakeTexts();
    d.checkpoint();
    fn(d);
    changed();
  };

  /* ------------------------------------------------------------ selection / clipboard */
  const commitFloating = (f = floating) => {
    const d = docRef.current;
    if (!f || !d) return;
    drawFloating(d.ctx, f);
    setFloating(null);
    setSelection(!f.rot && !f.path ? { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) } : null);
    changed();
  };
  /** Cut a rectangle out of the layer into a floating piece. */
  const lift = (r: Rect): Floating => {
    const d = docRef.current!;
    d.checkpoint();
    const c = selCanvas(r);
    clearRect(d, r);
    const f: Floating = { k: ++floatKey, canvas: c, x: r.x, y: r.y, w: r.w, h: r.h, rot: 0, fx: 1, fy: 1 };
    setFloating(f);
    setSelection(null);
    return f;
  };
  /** Point inside the (possibly rotated) floating box. */
  const inFloat = (p: Pt, f: Floating) => {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, c = Math.cos(-f.rot), sn = Math.sin(-f.rot);
    const lx = (p.x - cx) * c - (p.y - cy) * sn, ly = (p.x - cx) * sn + (p.y - cy) * c;
    return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.h / 2;
  };
  /** Stamp a copy down and keep the piece floating, nudged. */
  const duplicateFloat = () => {
    const d = docRef.current;
    const f = floating ?? (selection && lift(selection));
    if (!d || !f) return;
    drawFloating(d.ctx, f);
    setFloating({ ...f, x: f.x + 16, y: f.y + 16 });
    changed();
  };
  const nudge = (dx: number, dy: number) => {
    const f = floating ?? (selection && tool === "select" ? lift(selection) : null);
    if (f) setFloating({ ...f, x: f.x + dx, y: f.y + dy });
  };
  /* Handle drags: resize from any edge/corner (Shift keeps ratio), rotate from the knob (Shift snaps 15°). */
  const xf = useRef<{ h: string; start: Pt; o: Floating } | null>(null);
  const startXf = (e: React.PointerEvent, h: string) => {
    e.stopPropagation();
    e.preventDefault();
    const f = floating ?? (selection && lift(selection));
    if (!f) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    xf.current = { h, start: toCanvas(e), o: f };
  };
  const moveXf = (e: React.PointerEvent) => {
    const s = xf.current;
    if (!s) return;
    const p = toCanvas(e), o = s.o;
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    if (s.h === "rot") {
      let r = Math.atan2(p.y - cy, p.x - cx) + Math.PI / 2;
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      return setFloating({ ...o, rot: r });
    }
    const cos = Math.cos(o.rot), sin = Math.sin(o.rot);
    const dx = p.x - s.start.x, dy = p.y - s.start.y;
    const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
    const hx = s.h.includes("e") ? 1 : s.h.includes("w") ? -1 : 0;
    const hy = s.h.includes("s") ? 1 : s.h.includes("n") ? -1 : 0;
    let w = Math.max(4, o.w + hx * lx), h = Math.max(4, o.h + hy * ly);
    if (e.shiftKey && hx && hy) {
      const k = Math.max(w / o.w, h / o.h);
      (w = o.w * k), (h = o.h * k);
    }
    const ox = (hx * (w - o.w)) / 2, oy = (hy * (h - o.h)) / 2;
    const ncx = cx + ox * cos - oy * sin, ncy = cy + ox * sin + oy * cos;
    setFloating({ ...o, x: ncx - w / 2, y: ncy - h / 2, w, h });
  };
  const endXf = () => xf.current && ((xf.current = null), changed());
  const selCanvas = (r: Rect) => {
    const c = makeCanvas(r.w, r.h);
    ctx2d(c).drawImage(docRef.current!.layer.canvas, -r.x, -r.y);
    return c;
  };
  const clearRect = (d: SketchDoc, r: Rect) => {
    if (d.active === 0) (d.ctx.fillStyle = color2), d.ctx.fillRect(r.x, r.y, r.w, r.h);
    else d.ctx.clearRect(r.x, r.y, r.w, r.h);
  };
  const internalClip = useRef<HTMLCanvasElement | null>(null);
  const copySel = async () => {
    const d = docRef.current;
    if (!d) return;
    const c = floating?.canvas ?? (selection ? selCanvas(selection) : d.flatten());
    internalClip.current = c;
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {}
  };
  const cutSel = async () => {
    if (!selection && !floating) return;
    await copySel();
    if (floating) return setFloating(null), setSelection(null), changed();
    edit((d) => clearRect(d, selection!));
  };
  const deleteSel = () => {
    if (textSel && tool === "text") return deleteText(textSel);
    if (floating) return setFloating(null), setSelection(null), changed();
    if (selection) edit((d) => clearRect(d, selection));
  };
  const pasteCanvas = (c: HTMLCanvasElement) => {
    const d = docRef.current;
    if (!d) return;
    commitFloating();
    d.checkpoint();
    // Paste bigger than the canvas grows it, like Paint.
    if (c.width > d.w || c.height > d.h) d.resizeCanvas(Math.max(d.w, c.width), Math.max(d.h, c.height));
    setTool("select");
    setFloating({ k: ++floatKey, canvas: c, x: 0, y: 0, w: c.width, h: c.height, rot: 0, fx: 1, fy: 1 });
    setSelection(null);
  };
  const pasteFromClipboard = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const bmp = await createImageBitmap(await item.getType(type));
        const c = makeCanvas(bmp.width, bmp.height);
        ctx2d(c).drawImage(bmp, 0, 0);
        return pasteCanvas(c);
      }
    } catch {}
    if (internalClip.current) pasteCanvas(internalClip.current);
  };

  const setTool = (t: Tool) => {
    commitFloating();
    if (t !== "text") bakeTexts();
    if (t !== "select") setSelection(null);
    if (t !== "picker") prevTool.current = t;
    setToolState(t);
  };

  /* ------------------------------------------------------------ text */
  const patchText = (id: string, patch: Partial<TextObj>) => setTexts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const deleteText = (id: string) => (setTexts((ts) => ts.filter((t) => t.id !== id)), setTextSel(null));
  /** Drop the selection; empty boxes vanish. */
  const deselectText = () => (setTexts((ts) => ts.filter((t) => t.value.trim())), setTextSel(null));
  /** Paint every live text into its layer and forget them. */
  const bakeTexts = () => {
    const d = docRef.current;
    const live = texts.filter((t) => t.value.trim());
    setTexts([]);
    setTextSel(null);
    if (!d || !live.length) return;
    d.checkpoint();
    for (const t of live) drawText(ctx2d((d.layers.find((l) => l.id === t.layer) ?? d.layer).canvas), t);
    changed();
  };
  /** Text bar edits restyle the selected box and become the style for new ones. */
  const styleText = (patch: Partial<TextStyle>) => (setTextStyle((st) => ({ ...st, ...patch })), textSel && patchText(textSel, patch));

  /* ------------------------------------------------------------ pointer */
  const drag = useRef<{
    start: Pt; last: Pt; button: number; color: string; moveSel?: Pt; resize?: boolean; pan?: Pt; spray?: number;
    id?: number; tool?: Tool; ink?: Stroke; loop?: Pt[];
  } | null>(null);
  /** Brush-size ring (black with a white edge, visible on any background) for painting tools. */
  const ringCursor = () => {
    const w = { pencil: Math.max(1, Math.round(size / 3)), brush: size, marker: size, airbrush: size * 2, eraser: size * 2 }[tool as string];
    if (!w) return undefined;
    const d = Math.round(Math.min(120, Math.max(8, w * zoom + 4)));
    const c = d / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="none" stroke="white" stroke-width="3"/><circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="none" stroke="black" stroke-width="1"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
  };
  /** Pen pressure 0..1 (mouse and touch draw at full width). */
  const pressure = (e: React.PointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 1);
  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const r = stackRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

  const stroke = (from: Pt, to: Pt, color: string, g: CanvasRenderingContext2D) => {
    g.save();
    g.strokeStyle = color;
    g.lineWidth = tool === "pencil" ? Math.max(1, Math.round(size / 3)) : size;
    g.lineCap = tool === "pencil" ? "square" : "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke();
    g.restore();
  };
  const spray = (p: Pt, color: string) => {
    const g = docRef.current!.ctx;
    g.fillStyle = color;
    for (let i = 0; i < size * 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size;
      g.fillRect(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1, 1);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const d = docRef.current;
    if (e.pointerType === "touch" && penId.current !== null) return;
    // Pen side button or eraser end: button 5 / buttons bit 32; PC tablet drivers send the side button as right-click.
    const penErase = e.pointerType === "pen" && (e.button === 5 || e.button === 2 || (e.buttons & 34) !== 0);
    if (!d || (e.button !== 0 && e.button !== 2 && e.button !== 1 && !penErase) || drag.current) return;
    if (e.pointerType === "pen") penId.current = e.pointerId;
    const tool: Tool = penErase ? "eraser" : toolNow;
    const p = toCanvas(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Middle button or hand tool pans.
    if (e.button === 1 || tool === "hand") {
      drag.current = { start: p, last: p, button: e.button, color: "", pan: { x: e.clientX, y: e.clientY } };
      return;
    }
    const color = e.button === 2 ? color2 : color1;
    const ix = Math.floor(p.x);
    const iy = Math.floor(p.y);
    if (tool === "picker") {
      const px = ctx2d(d.flatten()).getImageData(Math.min(d.w - 1, Math.max(0, ix)), Math.min(d.h - 1, Math.max(0, iy)), 1, 1).data;
      (e.button === 2 ? setColor2 : setColor1)(rgbToHex(px[0], px[1], px[2]));
      setToolState(prevTool.current);
      return;
    }
    if (tool === "fill") return edit((doc) => floodFill(doc.ctx, ix, iy, color));
    if (tool === "text") {
      // Keep the browser from moving focus to the canvas after the box mounts.
      e.preventDefault();
      if (textSel) return deselectText();
      const t: TextObj = { ...textStyle, color: color1, id: crypto.randomUUID(), layer: d.layer.id, x: Math.round(p.x), y: Math.round(p.y), value: "" };
      setTexts((ts) => [...ts, t]);
      return setTextSel(t.id);
    }
    if ((tool === "select" || tool === "lasso") && floating) {
      if (inFloat(p, floating)) {
        drag.current = { start: p, last: p, button: 0, color, moveSel: { x: floating.x, y: floating.y } };
        return;
      }
      commitFloating();
    }
    if (tool === "lasso") {
      drag.current = { start: p, last: p, button: 0, color, id: e.pointerId, tool, loop: [p] };
      return;
    }
    if (tool === "select") {
      if (selection && inRect(p, selection)) {
        // Lift the selection into a floating piece and move it.
        const f = lift(selection);
        drag.current = { start: p, last: p, button: 0, color, moveSel: { x: f.x, y: f.y } };
        return;
      }
      setSelection(null);
      drag.current = { start: snap(p), last: p, button: 0, color };
      return;
    }
    const isInk = tool === "pencil" || tool === "brush";
    d.checkpoint(isInk);
    drag.current = { start: SHAPE_KINDS.includes(tool) ? snap(p) : p, last: p, button: e.button, color, id: e.pointerId, tool };
    if (isInk) {
      d.beginInk();
      const pencil = tool === "pencil";
      const ink: Stroke = { pts: [{ ...p, p: pressure(e) }], color, width: pencil ? Math.max(1, Math.round(size / 3)) : size, cap: pencil ? "square" : "round" };
      drag.current.ink = ink;
      drawStroke(d.ctx, ink);
    } else if (tool === "airbrush") {
      spray(p, color);
      drag.current.spray = window.setInterval(() => drag.current && spray(drag.current.last, color), 30);
    } else if (tool === "eraser") erase(p, p);
    else if (tool === "marker") stroke(p, p, color, ctx2d(overlay.current));
    rerender();
  };
  /** Eraser: paints colour 2 on the background, clears to transparent on layers above. */
  const erase = (a: Pt, b: Pt) => {
    const d = docRef.current!;
    const g = d.ctx;
    g.save();
    if (d.active > 0) g.globalCompositeOperation = "destination-out";
    g.strokeStyle = color2;
    g.lineWidth = size * 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.restore();
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toCanvas(e);
    setCursor({ x: Math.floor(p.x), y: Math.floor(p.y) });
    const st = drag.current;
    const d = docRef.current;
    if (!st || !d || (st.id !== undefined && st.id !== e.pointerId)) return;
    const tool = st.tool ?? toolNow;
    if (st.pan) {
      viewRef.current!.scrollBy(st.pan.x - e.clientX, st.pan.y - e.clientY);
      st.pan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (st.resize) {
      setSelection({ x: 0, y: 0, w: Math.max(1, Math.round(p.x)), h: Math.max(1, Math.round(p.y)) });
      return;
    }
    if (st.moveSel) {
      if (floating) setFloating({ ...floating, x: st.moveSel.x + p.x - st.start.x, y: st.moveSel.y + p.y - st.start.y });
      return;
    }
    if (tool === "select") {
      const q = snap(p);
      const x = Math.max(0, Math.min(st.start.x, q.x));
      const y = Math.max(0, Math.min(st.start.y, q.y));
      setSelection({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(d.w, Math.max(st.start.x, q.x)) - x), h: Math.round(Math.min(d.h, Math.max(st.start.y, q.y)) - y) });
      return;
    }
    const og = ctx2d(overlay.current);
    if (st.loop) {
      st.loop.push(p);
      og.clearRect(0, 0, d.w, d.h);
      og.save();
      og.setLineDash([5 / zoom, 4 / zoom]);
      og.lineWidth = 1.5 / zoom;
      og.strokeStyle = "#e8603c";
      og.beginPath();
      st.loop.forEach((q, i) => (i ? og.lineTo(q.x, q.y) : og.moveTo(q.x, q.y)));
      og.stroke();
      og.restore();
      return;
    }
    if (st.ink) {
      // Stabilizer: the nib trails the pointer by the smoothing amount.
      const last = st.ink.pts[st.ink.pts.length - 1];
      const k = 1 - smooth / 100;
      const q = { x: last.x + (p.x - last.x) * k, y: last.y + (p.y - last.y) * k, p: pressure(e) };
      drawSegment(d.ctx, st.ink, last, q);
      st.ink.pts.push(q);
      st.last = p;
      return;
    }
    if (SHAPE_KINDS.includes(tool)) {
      og.clearRect(0, 0, d.w, d.h);
      let end = snap(p);
      if (e.shiftKey) {
        // Shift: squares/circles, or lines snapped to 45°.
        const dx = p.x - st.start.x;
        const dy = p.y - st.start.y;
        if (tool === "line" || tool === "arrow") {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          end = { x: st.start.x + Math.cos(ang) * len, y: st.start.y + Math.sin(ang) * len };
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          end = { x: st.start.x + Math.sign(dx) * m, y: st.start.y + Math.sign(dy) * m };
        }
      }
      drawShape(og, tool as ShapeKind, st.start, end, { stroke: st.color, fill: st.button === 2 ? color1 : color2, width: size, mode: shapeMode });
      st.last = end;
      return;
    }
    if (tool === "marker") stroke(st.last, p, st.color, og);
    else if (tool === "eraser") erase(st.last, p);
    else if (tool === "pencil" || tool === "brush") stroke(st.last, p, st.color, d.ctx);
    st.last = p;
  };

  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId === penId.current) penId.current = null;
    const st = drag.current;
    const d = docRef.current;
    if (st?.id !== undefined && st.id !== e.pointerId) return;
    drag.current = null;
    if (!st || !d) return;
    const tool = st.tool ?? toolNow;
    if (st.ink) {
      // Settle the stroke: smooth it, and taper both ends.
      // The stabilizer trails the pointer: finish where the pen lifted.
      const end = st.ink.pts[st.ink.pts.length - 1];
      if (smooth && st.ink.pts.length > 1) st.ink.pts.push({ ...st.last, p: end.p });
      let pts = smooth ? smoothPoints(st.ink.pts, 0.8, 2) : st.ink.pts;
      if (taper && pts.length > 4) {
        const n = pts.length, k = Math.min(n / 3, 10);
        pts = pts.map((q, i) => ({ ...q, p: q.p * Math.min(1, (i + 1) / k, (n - i) / k) }));
      }
      st.ink.pts = pts;
      d.layer.strokes.push(st.ink);
      d.redrawInk();
      return changed();
    }
    if (st.loop) {
      // Lasso cuts the pixels inside the loop into a floating piece.
      ctx2d(overlay.current).clearRect(0, 0, d.w, d.h);
      const loop = st.loop;
      const xs = loop.map((q) => q.x), ys = loop.map((q) => q.y);
      const x0 = Math.floor(Math.max(0, Math.min(...xs))), y0 = Math.floor(Math.max(0, Math.min(...ys)));
      const w = Math.ceil(Math.min(d.w, Math.max(...xs))) - x0, h = Math.ceil(Math.min(d.h, Math.max(...ys))) - y0;
      if (loop.length < 3 || w < 2 || h < 2) return rerender();
      d.checkpoint();
      const local = loop.map((q) => ({ x: q.x - x0, y: q.y - y0 }));
      const path = new Path2D();
      local.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
      path.closePath();
      const c = makeCanvas(w, h);
      const g = ctx2d(c);
      g.clip(path);
      g.drawImage(d.layer.canvas, -x0, -y0);
      const lg = d.ctx;
      lg.save();
      lg.translate(x0, y0);
      if (d.active > 0) lg.globalCompositeOperation = "destination-out";
      else lg.fillStyle = color2;
      lg.fill(path);
      lg.restore();
      setFloating({ k: ++floatKey, canvas: c, x: x0, y: y0, w, h, rot: 0, fx: 1, fy: 1, path: local });
      return rerender();
    }
    if (st.moveSel) return void (floating && changed());
    if (st.spray) window.clearInterval(st.spray);
    if (st.pan) return;
    if (st.resize && selection) {
      const r = selection;
      setSelection(null);
      return edit((doc) => doc.resizeCanvas(r.w, r.h));
    }
    if (tool === "select") return;
    const og = ctx2d(overlay.current);
    if (tool === "marker" || SHAPE_KINDS.includes(tool)) {
      d.ctx.save();
      d.ctx.globalAlpha = tool === "marker" ? 0.45 : 1;
      d.ctx.drawImage(overlay.current, 0, 0);
      d.ctx.restore();
      og.clearRect(0, 0, d.w, d.h);
    }
    changed();
  };

  /* ------------------------------------------------------------ keyboard + paste */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const d = docRef.current;
      if (!d) return;
      const handled = () => (e.preventDefault(), e.stopPropagation());
      if (mod && k === "z") return handled(), commitFloating(), d.undo(), changed();
      if (mod && k === "y") return handled(), d.redo(), changed();
      if (mod && k === "d") return handled(), duplicateFloat();
      if (k.startsWith("arrow") && (floating || (selection && tool === "select"))) {
        const step = e.shiftKey ? 10 : 1;
        handled();
        return nudge(k === "arrowleft" ? -step : k === "arrowright" ? step : 0, k === "arrowup" ? -step : k === "arrowdown" ? step : 0);
      }
      if (mod && k === "s") return handled(), void save();
      if (mod && k === "n") return handled(), setDialog("new");
      if (mod && k === "o") return handled(), void pickImage().then((p) => p && onOpen(p));
      if (mod && k === "c") return handled(), void copySel();
      if (mod && k === "x") return handled(), void cutSel();
      if (mod && k === "a") return handled(), setTool("select"), setSelection({ x: 0, y: 0, w: d.w, h: d.h });
      if (mod && (k === "=" || k === "+")) return handled(), setZoom((z) => Math.min(8, z * 1.25));
      if (mod && k === "-") return handled(), setZoom((z) => Math.max(0.05, z / 1.25));
      if (mod && k === "0") return handled(), fitZoom();
      if (k === "delete" || k === "backspace") return handled(), deleteSel();
      if (k === "escape") return commitFloating(), setSelection(null), deselectText();
      if (k === "enter" && floating) return commitFloating();
      if (!mod && !e.altKey && TOOL_KEYS[k]) return setTool(TOOL_KEYS[k]);
      if (!mod && (k === "[" || k === "]")) return setSize((s) => Math.max(1, Math.min(100, s + (k === "]" ? 2 : -2))));
    };
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea")) return;
      e.preventDefault();
      void pasteFromClipboard();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    return () => (window.removeEventListener("keydown", onKey, true), window.removeEventListener("paste", onPaste));
  });

  /* ------------------------------------------------------------ actions */
  const crop = () => selection && (setSelection(null), edit((d) => d.crop(selection)));
  const copyImage = async () => {
    const blob = await new Promise<Blob | null>((r) => composite().toBlob(r, "image/png"));
    if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
  };

  if (status === "error") return <div className="grid h-full place-items-center text-[14px] text-red-400">Couldn't open this image.</div>;
  if (!doc) return <div className="h-full" />;

  /* ------------------------------------------------------------ UI pieces */
  const T = ({ t, icon, label, keyHint }: { t: Tool; icon: ReactNode; label: string; keyHint?: string }) => (
    <IBtn tip={keyHint ? `${label} (${keyHint})` : label} on={tool === t} big={layout === "paint"} onClick={() => setTool(t)}>
      {icon}
    </IBtn>
  );
  const drawTools = (
    <>
      <T t="select" icon={<MousePointer2 />} label="Select" keyHint="S" />
      <T t="lasso" icon={<LassoSelect />} label="Lasso" keyHint="Q" />
      <T t="pencil" icon={<Pencil />} label="Pencil" keyHint="P" />
      <T t="brush" icon={<Brush />} label="Brush" keyHint="B" />
      <T t="marker" icon={<Highlighter />} label="Marker" keyHint="K" />
      <T t="airbrush" icon={<SprayCan />} label="Airbrush" keyHint="A" />
      <T t="eraser" icon={<Eraser />} label="Eraser" keyHint="E" />
      <T t="fill" icon={<PaintBucket />} label="Fill" keyHint="G" />
      <T t="picker" icon={<Pipette />} label="Colour picker" keyHint="I" />
      <T t="text" icon={<Type />} label="Text" keyHint="T" />
      <T t="hand" icon={<Hand />} label="Pan" keyHint="H" />
    </>
  );
  const shapeTools = SHAPES.map((s) => <T key={s.kind} t={s.kind} icon={s.icon} label={s.label} />);
  const shapeStyle = (
    <Seg
      value={shapeMode}
      onChange={(v) => setShapeMode(v as typeof shapeMode)}
      options={[
        ["outline", <Square key="o" className="size-4" />, "Outline"],
        ["fill", <Square key="f" className="size-4" fill="currentColor" />, "Fill"],
        ["both", <Square key="b" className="size-4" fill="currentColor" fillOpacity={0.35} />, "Outline + fill"],
      ]}
    />
  );
  const sizeCtl = (
    <label className="flex items-center gap-2 text-[12px] text-neutral-400" data-tip="Size ([ / ])">
      <span className="grid size-7 place-items-center"><span className="rounded-full bg-neutral-200" style={{ width: Math.max(2, Math.min(24, size / 2)), height: Math.max(2, Math.min(24, size / 2)) }} /></span>
      <Range min={1} max={100} value={size} onChange={setSize} suffix="px" className="w-24" />
      <span className="w-8 tabular-nums text-neutral-300">{size}px</span>
    </label>
  );
  const colours = (
    <div className="flex items-center gap-2">
      <div className="relative size-10" data-tip="Colour 1 (left click) · Colour 2 (right click)">
        <label className="absolute left-0 top-0 size-7 cursor-pointer rounded-md border-2 border-neutral-200 shadow" style={{ background: color1 }}>
          <input type="color" value={color1} onChange={(e) => setColor1(e.target.value)} className="sr-only" />
        </label>
        <label className="absolute bottom-0 right-0 size-6 cursor-pointer rounded-md border-2 border-neutral-500" style={{ background: color2 }}>
          <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} className="sr-only" />
        </label>
      </div>
      <button type="button" data-tip="Swap colours" onClick={() => (setColor1(color2), setColor2(color1))} className="cursor-pointer text-neutral-400 hover:text-neutral-100">⇄</button>
      <div className="grid grid-cols-10 gap-[3px]">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor1(c)}
            onContextMenu={(e) => (e.preventDefault(), setColor2(c))}
            className="size-[18px] cursor-pointer rounded-sm border border-white/15 transition-transform hover:scale-125"
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
  const imageTools = (
    <>
      <IBtn tip="Crop to selection" disabled={!selection} onClick={crop}><Crop /></IBtn>
      <IBtn tip="Resize image" onClick={() => setDialog("resize")}><Scaling /></IBtn>
      <IBtn tip="Rotate left" onClick={() => edit((d) => d.rotate(-90))}><RotateCcw /></IBtn>
      <IBtn tip="Rotate right" onClick={() => edit((d) => d.rotate(90))}><RotateCw /></IBtn>
      <IBtn tip="Flip horizontal" onClick={() => edit((d) => d.flip(true))}><FlipHorizontal /></IBtn>
      <IBtn tip="Flip vertical" onClick={() => edit((d) => d.flip(false))}><FlipVertical /></IBtn>
    </>
  );
  const clipboard = (
    <>
      <IBtn tip="Paste (Ctrl+V)" onClick={() => void pasteFromClipboard()}><ClipboardPaste /></IBtn>
      <IBtn tip="Cut (Ctrl+X)" disabled={!selection && !floating} onClick={() => void cutSel()}><Scissors /></IBtn>
      <IBtn tip="Copy (Ctrl+C)" onClick={() => void copySel()}><Copy /></IBtn>
    </>
  );
  const curText = texts.find((t) => t.id === textSel);
  const ts = curText ?? textStyle;
  const field = "h-7 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[12px] text-neutral-100 outline-none focus:border-[color:var(--oc-sketch)]";
  const swatch = (value: string, on: (v: string) => void, tip: string) => (
    <label data-tip={tip} className="relative size-5 shrink-0 cursor-pointer rounded border border-white/30" style={{ background: value }}>
      <input type="color" value={value} onChange={(e) => on(e.target.value)} className="sr-only" />
    </label>
  );
  const textBar = (
    <div className="flex items-center gap-1.5">
      <select value={ts.font} onChange={(e) => styleText({ font: e.target.value })} className={`${field} w-32 cursor-pointer`} style={{ fontFamily: ts.font }}>
        {FONTS.map((f) => <option key={f.label} value={f.css} style={{ fontFamily: f.css }}>{f.label}</option>)}
      </select>
      <input type="number" min={6} max={400} value={ts.size} onChange={(e) => styleText({ size: Math.max(6, Number(e.target.value) || 6) })} className={`${field} w-14`} data-tip="Text size" />
      {swatch(ts.color, (v) => (styleText({ color: v }), setColor1(v)), "Text colour")}
      <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      <IBtn tip="Bold" on={ts.bold} onClick={() => styleText({ bold: !ts.bold })}><Bold /></IBtn>
      <IBtn tip="Italic" on={ts.italic} onClick={() => styleText({ italic: !ts.italic })}><Italic /></IBtn>
      <IBtn tip="Underline" on={ts.underline} onClick={() => styleText({ underline: !ts.underline })}><Underline /></IBtn>
      <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      <IBtn tip="Align left" on={ts.align === "left"} onClick={() => styleText({ align: "left" })}><AlignLeft /></IBtn>
      <IBtn tip="Align centre" on={ts.align === "center"} onClick={() => styleText({ align: "center" })}><AlignCenter /></IBtn>
      <IBtn tip="Align right" on={ts.align === "right"} onClick={() => styleText({ align: "right" })}><AlignRight /></IBtn>
      <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      <IBtn tip="Outline" on={!!ts.outline} onClick={() => styleText({ outline: ts.outline ? null : "#ffffff" })}><Type /></IBtn>
      {ts.outline && swatch(ts.outline, (v) => styleText({ outline: v }), "Outline colour")}
      <IBtn tip="Highlight box" on={!!ts.bg} onClick={() => styleText({ bg: ts.bg ? null : "#fff200" })}><Square /></IBtn>
      {ts.bg && swatch(ts.bg, (v) => styleText({ bg: v }), "Highlight colour")}
      <IBtn tip="Shadow" on={ts.shadow} onClick={() => styleText({ shadow: !ts.shadow })}><Sun /></IBtn>
      {curText && <IBtn tip="Delete text (Del)" onClick={() => deleteText(curText.id)}><Trash2 /></IBtn>}
      {!curText && <span className="ml-1 whitespace-nowrap text-[11.5px] text-neutral-500">Click the canvas to add text</span>}
    </div>
  );
  const inkBar = (
    <div className="flex items-center gap-3 text-[12px] text-neutral-400">
      <label className="flex items-center gap-2" data-tip="Stabilizer: higher is steadier, with more lag">
        Smoothing
        <Range min={0} max={90} value={smooth} onChange={setSmooth} suffix="%" className="w-20" />
        <span className="w-7 tabular-nums text-neutral-300">{smooth}%</span>
      </label>
      <label className="flex cursor-pointer items-center gap-1.5" data-tip="Thin the start and end of each stroke">
        <input type="checkbox" checked={taper} onChange={(e) => setTaper(e.target.checked)} className="accent-[var(--oc-sketch)]" /> Taper
      </label>
    </div>
  );
  const optionsFor = SHAPE_KINDS.includes(tool) ? shapeStyle : tool === "text" ? textBar : tool === "pencil" || tool === "brush" ? inkBar : null;

  const layersPanel = (
    <LayersPanel
      doc={doc}
      onSelect={(i) => (commitFloating(), bakeTexts(), (doc.active = i), rerender())}
      onBlend={(b) => ((doc.layer.blend = b), changed())}
      onToggle={(i) => edit((d) => (d.layers[i].visible = !d.layers[i].visible))}
      onOpacity={(o) => ((doc.layer.opacity = o), changed())}
      onRename={(i, n) => ((doc.layers[i].name = n), rerender())}
      onAction={(a) =>
        edit((d) =>
          a === "add" ? void d.addLayer(undefined, d.active + 1) : a === "dup" ? d.duplicateLayer() : a === "del" ? d.deleteLayer() : a === "up" ? d.moveLayer(1) : a === "down" ? d.moveLayer(-1) : d.mergeDown(),
        )
      }
    />
  );

  /* ------------------------------------------------------------ layout */
  const fileMenu = (
    <div className="relative">
      <button type="button" onClick={() => setMenu((v) => !v)} className="h-7 cursor-pointer rounded-md bg-[var(--oc-sketch)] px-3 text-[13px] font-semibold text-[#3a0f05] hover:brightness-110">
        File
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(false)} />
          <div className="oc-docs-pop absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl" onClick={() => setMenu(false)}>
            <MItem label="New…" hint="Ctrl+N" onClick={() => setDialog("new")} />
            <MItem label="Open…" hint="Ctrl+O" onClick={() => void pickImage().then((p) => p && onOpen(p))} />
            <MItem label="Save" hint="Ctrl+S" onClick={() => void save()} />
            <MItem label="Copy image (paste into Docs or notes)" onClick={() => void copyImage()} />
            <div className="my-1 h-px bg-white/[0.06]" />
            <MItem label="Close" onClick={onClose} />
            <MItem label="Back to Sketch Home" onClick={onHome} />
          </div>
        </>
      )}
    </div>
  );
  const titleStrip = (
    <div data-tauri-drag-region className="oc-docs-chrome oc-docs-enter flex h-10 shrink-0 items-center gap-1 pl-2">
      <IBtn tip="Sketch Home" onClick={onHome}><House /></IBtn>
      <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      {fileMenu}
      <IBtn tip="Save (Ctrl+S)" onClick={() => void save()}><Save /></IBtn>
      <IBtn tip="Undo (Ctrl+Z)" disabled={!doc.canUndo} onClick={() => (commitFloating(), doc.undo(), changed())}><Undo2 /></IBtn>
      <IBtn tip="Redo (Ctrl+Y)" disabled={!doc.canRedo} onClick={() => (doc.redo(), changed())}><Redo2 /></IBtn>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[13px]">
        <span className="truncate font-semibold text-neutral-100">{sketchTitle(path)}</span>
        <span className="text-neutral-500">·</span>
        <span className="text-[12px] text-neutral-500">{{ loading: "Opening…", saving: "Saving…", saved: "Saved", unsaved: "Not saved · Ctrl+S", error: "Couldn't save" }[status]}</span>
      </div>
      <IBtn tip="Layers" on={showLayers} onClick={() => setShowLayers((v) => !v)}><Layers /></IBtn>
      <span className="w-2" />
      <WindowControls />
    </div>
  );

  const box = floating ?? (selection && tool === "select" && selection.w > 1 && selection.h > 1 ? { ...selection, rot: 0 } : null);
  const canvasArea = (
    <div
      ref={viewRef}
      className="oc-sketch-desk scrollbar-thin relative min-h-0 flex-1 overflow-auto"
      onWheel={(e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setZoom((z) => Math.min(8, Math.max(0.05, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
      }}
    >
      <div className="grid min-h-full min-w-full place-items-center p-10" style={{ width: doc.w * zoom + 80, height: doc.h * zoom + 80 }}>
        <div className="oc-sketch-sheet relative" style={{ width: doc.w * zoom, height: doc.h * zoom }}>
          <div
            ref={stackRef}
            className={`oc-checker absolute inset-0 touch-none ${tool === "hand" ? "cursor-grab" : tool === "text" ? "cursor-text" : tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
            style={{ imageRendering: zoom > 2 ? "pixelated" : "auto", cursor: ringCursor(), isolation: "isolate" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          {grid && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: "linear-gradient(rgb(120 120 140 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(120 120 140 / 0.35) 1px, transparent 1px)", backgroundSize: `${GRID * zoom}px ${GRID * zoom}px` }}
            />
          )}
          {/* Selection / floating piece: one box, so handles survive the lift */}
          {box && (
            <>
              <div
                className="pointer-events-none absolute"
                style={{ left: box.x * zoom, top: box.y * zoom, width: box.w * zoom, height: box.h * zoom, transform: `rotate(${box.rot}rad)` }}
              >
                {floating && (
                  <canvas
                    key={floating.k}
                    ref={(c) => {
                      if (c && !c.dataset.drawn) {
                        c.width = floating.canvas.width;
                        c.height = floating.canvas.height;
                        ctx2d(c).drawImage(floating.canvas, 0, 0);
                        c.dataset.drawn = "1";
                      }
                    }}
                    className="absolute inset-0 h-full w-full"
                    style={{ transform: `scale(${floating.fx}, ${floating.fy})` }}
                  />
                )}
                {floating?.path ? (
                  <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${floating.canvas.width} ${floating.canvas.height}`} preserveAspectRatio="none" style={{ transform: `scale(${floating.fx}, ${floating.fy})` }}>
                    <polygon points={floating.path.map((q) => `${q.x},${q.y}`).join(" ")} className="oc-ants" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : (
                  <div className="oc-marquee absolute inset-0" />
                )}
                <span className="absolute -top-7 left-1/2 h-7 w-px -translate-x-1/2 bg-[color:var(--oc-sketch)]" />
                <span onPointerDown={(e) => startXf(e, "rot")} onPointerMove={moveXf} onPointerUp={endXf} data-tip="Rotate (Shift snaps)" className="oc-sk-handle pointer-events-auto absolute -top-9 left-1/2 size-3.5 -translate-x-1/2 cursor-grab rounded-full" />
                {HANDLES.map((h) => (
                  <span
                    key={h}
                    onPointerDown={(e) => startXf(e, h)}
                    onPointerMove={moveXf}
                    onPointerUp={endXf}
                    className="oc-sk-handle pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
                    style={{ left: h.includes("w") ? 0 : h.includes("e") ? "100%" : "50%", top: h.includes("n") ? 0 : h.includes("s") ? "100%" : "50%", cursor: `${h}-resize` }}
                  />
                ))}
              </div>
              {/* Action bar under the box */}
              <div className="oc-sk-actions absolute z-10 flex items-center gap-0.5 rounded-lg p-0.5" style={{ left: box.x * zoom, top: (box.y + box.h) * zoom + 14 }} onPointerDown={(e) => e.stopPropagation()}>
                <IBtn tip="Copy (Ctrl+C)" onClick={() => void copySel()}><Copy /></IBtn>
                <IBtn tip="Duplicate (Ctrl+D)" onClick={duplicateFloat}><CopyPlus /></IBtn>
                <IBtn tip="Flip horizontal" onClick={() => { const f = floating ?? (selection && lift(selection)); if (f) setFloating({ ...f, fx: f.fx === 1 ? -1 : 1 }); }}><FlipHorizontal /></IBtn>
                <IBtn tip="Flip vertical" onClick={() => { const f = floating ?? (selection && lift(selection)); if (f) setFloating({ ...f, fy: f.fy === 1 ? -1 : 1 }); }}><FlipVertical /></IBtn>
                <IBtn tip="Rotate 90°" onClick={() => { const f = floating ?? (selection && lift(selection)); if (f) setFloating({ ...f, rot: f.rot + Math.PI / 2 }); }}><RotateCw /></IBtn>
                {!floating && <IBtn tip="Crop to selection" onClick={crop}><Crop /></IBtn>}
                <IBtn tip="Delete (Del)" onClick={deleteSel}><Trash2 /></IBtn>
                {floating && <IBtn tip="Done (Enter)" onClick={() => commitFloating()}><Check /></IBtn>}
              </div>
            </>
          )}
          {texts.map((t) =>
            t.id === textSel ? (
              <TextEditor key={t.id} t={t} zoom={zoom} toCanvas={toCanvas} onChange={(p) => patchText(t.id, p)} onDone={deselectText} />
            ) : (
              <TextPreview key={t.id} t={t} zoom={zoom} live={tool === "text"} onPick={() => setTextSel(t.id)} />
            ),
          )}
          {/* Paint-style corner handle: drag to resize the canvas */}
          <span
            data-tip="Drag to resize the canvas"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, button: 0, color: "", resize: true };
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-neutral-400 bg-white"
          />
        </div>
      </div>
    </div>
  );

  const statusBar = (
    <div className="oc-docs-status oc-docs-enter-up flex h-7 shrink-0 items-center gap-5 px-3 text-[11.5px] text-neutral-300">
      <span className="w-28 tabular-nums">{cursor ? `${cursor.x}, ${cursor.y}px` : ""}</span>
      <span className="tabular-nums">{floating ? `${Math.round(floating.w)} × ${Math.round(floating.h)}px${floating.rot ? ` · ${Math.round((floating.rot * 180) / Math.PI) % 360}°` : ""}` : selection ? `${selection.w} × ${selection.h}px selected` : ""}</span>
      <span className="tabular-nums">{doc.w} × {doc.h}px</span>
      <span className="flex-1" />
      <button type="button" data-tip="Grid + snap" aria-pressed={grid} onClick={() => setGrid((v) => !v)} className={`flex cursor-pointer items-center gap-1 ${grid ? "text-[color:var(--oc-sketch-light)]" : "hover:text-white"}`}><Grid3x3 className="size-3.5" /> Grid</button>
      <button type="button" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))} className="cursor-pointer hover:text-white"><Minus className="size-3.5" /></button>
      <Range min={5} max={800} value={Math.round(zoom * 100)} onChange={(v) => setZoom(v / 100)} suffix="%" className="w-32" />
      <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} className="cursor-pointer hover:text-white"><Plus className="size-3.5" /></button>
      <button type="button" data-tip="Fit (Ctrl+0)" onClick={fitZoom} className="w-12 cursor-pointer text-right hover:text-white">{Math.round(zoom * 100)}%</button>
    </div>
  );

  return (
    <div className="oc-sketch relative flex h-full flex-col">
      {titleStrip}
      {layout === "paint" ? (
        <>
          {/* Paint (Windows 11): one toolbar row of labelled groups */}
          {/* Paint: tabs above one floating glass bar; each tab has its own tools */}
          <div className="oc-docs-chrome oc-docs-enter shrink-0 px-3 pb-2">
            <div className="relative mb-1.5 flex w-fit gap-0.5">
              <SlidePill className="rounded-md !bg-[color:var(--oc-sketch)]/15" />
              {(["draw", "shapes", "image", "edit"] as const).map((b) => (
                <button key={b} type="button" aria-selected={barTab === b} onClick={() => setBarTab(b)} className={`relative z-[1] h-7 cursor-pointer rounded-md px-3 text-[12.5px] font-medium capitalize transition-colors ${barTab === b ? "text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:text-neutral-200"}`}>
                  {b}
                </button>
              ))}
            </div>
            <div key={barTab} className="oc-sk-glass oc-fade-in flex min-h-[52px] flex-wrap items-center gap-2 rounded-2xl px-2 py-1.5">
              {barTab === "draw" && (
                <>
                  <div className="relative flex gap-0.5"><SlidePill className="rounded-md" />{drawTools}</div>
                  <Sep />
                  {sizeCtl}
                  {optionsFor && <><Sep />{optionsFor}</>}
                  <Sep />
                  {colours}
                </>
              )}
              {barTab === "shapes" && (
                <>
                  <div className="relative flex gap-0.5"><SlidePill className="rounded-md" />{shapeTools}</div>
                  <Sep />
                  {shapeStyle}
                  <Sep />
                  {sizeCtl}
                  <Sep />
                  {colours}
                </>
              )}
              {barTab === "image" && imageTools}
              {barTab === "edit" && (
                <>
                  <IBtn big tip="Undo (Ctrl+Z)" disabled={!doc.canUndo} onClick={() => (commitFloating(), doc.undo(), changed())}><Undo2 /></IBtn>
                  <IBtn big tip="Redo (Ctrl+Y)" disabled={!doc.canRedo} onClick={() => (doc.redo(), changed())}><Redo2 /></IBtn>
                  <Sep />
                  {clipboard}
                  <IBtn big tip="Select all (Ctrl+A)" onClick={() => (setTool("select"), setSelection({ x: 0, y: 0, w: doc.w, h: doc.h }))}><MousePointer2 /></IBtn>
                  <IBtn big tip="Delete selection (Del)" disabled={!selection && !floating} onClick={deleteSel}><Trash2 /></IBtn>
                </>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            {canvasArea}
            {showLayers && <aside className="oc-sketch-panel w-60 shrink-0 overflow-y-auto">{layersPanel}</aside>}
          </div>
        </>
      ) : (
        <>
          {/* Photoshop: options bar on top, tool rail left, panels right */}
          <div className="oc-docs-chrome oc-docs-enter flex h-11 shrink-0 items-center gap-3 overflow-x-auto px-3">
            {sizeCtl}
            {optionsFor}
            <span className="h-6 w-px bg-white/[0.08]" />
            {clipboard}
            <span className="h-6 w-px bg-white/[0.08]" />
            {imageTools}
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="oc-sketch-panel flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto py-2">
              {drawTools}
              <span className="my-1 h-px w-7 bg-white/[0.08]" />
              {shapeTools}
            </div>
            {canvasArea}
            {showLayers && (
              <aside className="oc-sketch-panel flex w-64 shrink-0 flex-col gap-3 overflow-y-auto p-3">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Colour</p>
                  {colours}
                </div>
                {layersPanel}
              </aside>
            )}
          </div>
        </>
      )}
      {statusBar}
      {dialog === "new" && <NewCanvasDialog onClose={() => setDialog(null)} onCreate={(p) => (setDialog(null), onOpen(p))} />}
      {dialog === "resize" && <ResizeDialog w={doc.w} h={doc.h} onClose={() => setDialog(null)} onApply={(w, h) => (setDialog(null), edit((d) => d.scaleImage(w, h)))} />}
    </div>
  );
}

/* ------------------------------------------------------------ pieces */
function IBtn({ tip, on, big, disabled, onClick, children }: { tip: string; on?: boolean; big?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-tip={tip}
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={`oc-press relative z-[1] grid ${big ? "size-9 [&_svg]:!size-[19px]" : "size-8"} shrink-0 cursor-pointer place-items-center rounded-md transition-colors duration-150 disabled:cursor-default disabled:opacity-30 [&_svg]:size-[17px] ${on ? "bg-[color:var(--oc-sketch)]/20 text-[color:var(--oc-sketch-light)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-sketch)_45%,transparent)]" : "text-neutral-300 hover:bg-white/[0.07] hover:text-neutral-100"}`}
    >
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-7 w-px shrink-0 bg-white/[0.09]" />;

/** Slider: track fills up to the thumb; a value bubble rides the thumb while dragging. */
function Range({ value, min, max, onChange, suffix = "", className = "" }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; className?: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <span className={`oc-range relative inline-flex items-center ${className}`} style={{ "--p": `${p}%`, "--f": p / 100 } as React.CSSProperties}>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={(e) => e.currentTarget.blur()} className="w-full" />
      <span className="oc-range-bubble">{value}{suffix}</span>
    </span>
  );
}
function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, ReactNode, string?][] }) {
  return (
    <div className="relative flex rounded-md border border-white/[0.08] p-0.5">
      <SlidePill className="rounded !bg-[color:var(--oc-sketch)]/20" />
      {options.map(([v, l, tip]) => (
        <button key={v} type="button" data-tip={tip} aria-pressed={value === v} onClick={() => onChange(v)} className={`relative z-[1] grid h-7 cursor-pointer place-items-center rounded px-2 text-[11.5px] ${value === v ? "text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:text-neutral-200"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
function MItem({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-[13px] text-neutral-200 hover:bg-white/[0.06]">
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-neutral-500">{hint}</span>}
    </button>
  );
}

function LayersPanel({
  doc, onSelect, onToggle, onOpacity, onBlend, onRename, onAction,
}: {
  doc: SketchDoc;
  onBlend: (b: Blend) => void;
  onSelect: (i: number) => void;
  onToggle: (i: number) => void;
  onOpacity: (o: number) => void;
  onRename: (i: number, name: string) => void;
  onAction: (a: "add" | "dup" | "del" | "up" | "down" | "merge") => void;
}) {
  const [renaming, setRenaming] = useState<number | null>(null);
  return (
    <div className="p-2">
      <div className="mb-2 flex items-center">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Layers</p>
        <IBtn tip="New layer" onClick={() => onAction("add")}><Plus /></IBtn>
        <IBtn tip="Duplicate layer" onClick={() => onAction("dup")}><CopyPlus /></IBtn>
        <IBtn tip="Delete layer" disabled={doc.layers.length < 2} onClick={() => onAction("del")}><Trash2 /></IBtn>
      </div>
      <div className="flex flex-col gap-1">
        {doc.layers
          .map((l, i) => ({ l, i }))
          .reverse()
          .map(({ l, i }) => (
            <div
              key={l.id}
              onClick={() => onSelect(i)}
              onDoubleClick={() => setRenaming(i)}
              className={`oc-fade-in flex cursor-pointer items-center gap-2 rounded-md border p-1.5 ${i === doc.active ? "border-[color:var(--oc-sketch)] bg-[color:var(--oc-sketch)]/10" : "border-transparent hover:bg-white/[0.04]"}`}
            >
              <LayerThumb canvas={l.canvas} />
              {renaming === i ? (
                <input
                  autoFocus
                  defaultValue={l.name}
                  onBlur={(e) => (onRename(i, e.target.value || l.name), setRenaming(null))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="h-6 min-w-0 flex-1 rounded border border-white/[0.1] bg-white/[0.04] px-1 text-[12px] text-neutral-100 outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-200">{l.name}</span>
              )}
              <button type="button" onClick={(e) => (e.stopPropagation(), onToggle(i))} className="cursor-pointer text-neutral-400 hover:text-neutral-100">
                {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
            </div>
          ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-neutral-400">
        <Droplet className="size-3.5" /> Opacity
        <Range min={0} max={100} value={Math.round(doc.layer.opacity * 100)} onChange={(v) => onOpacity(v / 100)} suffix="%" className="flex-1" />
        <span className="w-8 text-right tabular-nums">{Math.round(doc.layer.opacity * 100)}%</span>
      </label>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-neutral-400">
        Blend
        <select value={doc.layer.blend} onChange={(e) => onBlend(e.target.value as Blend)} className="h-7 flex-1 cursor-pointer rounded-md border border-white/[0.1] bg-white/[0.04] px-1.5 text-[12px] text-neutral-100 outline-none">
          {BLENDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="mt-2 flex gap-1">
        <IBtn tip="Move layer up" onClick={() => onAction("up")}><ArrowUp /></IBtn>
        <IBtn tip="Move layer down" onClick={() => onAction("down")}><ArrowDown /></IBtn>
        <IBtn tip="Merge down" disabled={doc.active === 0} onClick={() => onAction("merge")}><Merge /></IBtn>
      </div>
    </div>
  );
}

/** A live text box, painted with the same code that bakes it. */
function TextPreview({ t, zoom, live, onPick }: { t: TextObj; zoom: number; live: boolean; onPick: () => void }) {
  const { w, h } = textBox(t);
  const m = Math.ceil(t.size * 0.4);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const r = Math.min(4, Math.max(1, zoom * devicePixelRatio));
    c.width = Math.ceil((w + m * 2) * r);
    c.height = Math.ceil((h + m * 2) * r);
    const g = ctx2d(c);
    g.scale(r, r);
    g.translate(m - t.x, m - t.y);
    drawText(g, t);
  });
  return (
    <canvas
      ref={ref}
      onPointerDown={(e) => (e.stopPropagation(), e.preventDefault(), onPick())}
      className={`absolute ${live ? "cursor-text rounded-sm outline-dashed outline-1 outline-transparent hover:outline-[color:var(--oc-sketch)]" : "pointer-events-none"}`}
      style={{ left: (t.x - m) * zoom, top: (t.y - m) * zoom, width: (w + m * 2) * zoom, height: (h + m * 2) * zoom, padding: 0 }}
    />
  );
}

/** The selected text box: type in place, drag the grip to move, the corner to scale. */
function TextEditor({ t, zoom, toCanvas, onChange, onDone }: { t: TextObj; zoom: number; toCanvas: (e: { clientX: number; clientY: number }) => Pt; onChange: (p: Partial<TextObj>) => void; onDone: () => void }) {
  const { w, h } = textBox(t);
  const pad = padOf(t);
  const dragRef = useRef<{ mode: "move" | "scale"; start: Pt; o: TextObj; w: number } | null>(null);
  const down = (mode: "move" | "scale") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, start: toCanvas(e), o: t, w };
  };
  const move = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s) return;
    const p = toCanvas(e);
    if (s.mode === "move") onChange({ x: Math.round(s.o.x + p.x - s.start.x), y: Math.round(s.o.y + p.y - s.start.y) });
    else onChange({ size: Math.max(6, Math.min(400, Math.round((s.o.size * (s.w + p.x - s.start.x)) / s.w))) });
  };
  const up = () => (dragRef.current = null);
  return (
    <div className="absolute" style={{ left: t.x * zoom, top: t.y * zoom }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={(el) => { if (el && !el.dataset.focused) (el.dataset.focused = "1"), el.focus(); }}
        value={t.value}
        wrap="off"
        spellCheck={false}
        onChange={(e) => onChange({ value: e.target.value })}
        onKeyDown={(e) => (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) && onDone()}
        placeholder="Type…"
        className="block resize-none overflow-hidden rounded-[3px] border-0 outline-dashed outline-1 outline-offset-2 outline-[color:var(--oc-sketch)] placeholder:text-neutral-400"
        style={{
          fontFamily: t.font,
          fontSize: t.size * zoom,
          fontWeight: t.bold ? 700 : 400,
          fontStyle: t.italic ? "italic" : "normal",
          width: w * zoom + 4,
          height: h * zoom,
          padding: `${pad * zoom}px`,
          lineHeight: 1.25,
          color: t.color,
          textAlign: t.align,
          textDecoration: t.underline ? "underline" : "none",
          background: t.bg ?? "transparent",
          borderRadius: t.bg ? t.size * 0.2 * zoom : 3,
          WebkitTextStroke: t.outline ? `${Math.max(1, t.size / 8) * zoom}px ${t.outline}` : undefined,
          paintOrder: "stroke fill",
          textShadow: t.shadow ? `0 ${t.size * 0.06 * zoom}px ${t.size * 0.18 * zoom}px rgba(0,0,0,0.45)` : undefined,
          caretColor: t.color,
        }}
      />
      <span onPointerDown={down("move")} onPointerMove={move} onPointerUp={up} data-tip="Drag to move" className="oc-sk-handle absolute -left-7 top-0 grid size-5 cursor-move place-items-center rounded-md text-neutral-800 [&_svg]:size-3">
        <Move />
      </span>
      <span onPointerDown={down("scale")} onPointerMove={move} onPointerUp={up} data-tip="Drag to resize" className="oc-sk-handle absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-[3px]" />
    </div>
  );
}

/** Small live preview of a layer (refreshes on each render). */
function LayerThumb({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const s = Math.min(44 / canvas.width, 32 / canvas.height);
    c.width = Math.max(1, Math.round(canvas.width * s));
    c.height = Math.max(1, Math.round(canvas.height * s));
    ctx2d(c).drawImage(canvas, 0, 0, c.width, c.height);
  });
  return (
    <span className="oc-checker grid h-8 w-11 shrink-0 place-items-center overflow-hidden rounded border border-white/10">
      <canvas ref={ref} />
    </span>
  );
}

function ResizeDialog({ w, h, onApply, onClose }: { w: number; h: number; onApply: (w: number, h: number) => void; onClose: () => void }) {
  const [nw, setW] = useState(w);
  const [nh, setH] = useState(h);
  const [lock, setLock] = useState(true);
  const field = "h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none";
  return (
    <Modal onClose={onClose} className="w-[380px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">Resize image</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[12px] text-neutral-400">Width<input type="number" value={nw} onChange={(e) => (setW(Number(e.target.value)), lock && setH(Math.round((Number(e.target.value) * h) / w)))} className={`${field} mt-1`} /></label>
        <label className="text-[12px] text-neutral-400">Height<input type="number" value={nh} onChange={(e) => (setH(Number(e.target.value)), lock && setW(Math.round((Number(e.target.value) * w) / h)))} className={`${field} mt-1`} /></label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-neutral-300">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} className="accent-[var(--oc-sketch)]" /> Keep aspect ratio
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => nw > 0 && nh > 0 && onApply(Math.min(8000, nw), Math.min(8000, nh))}>OK</ModalButton>
      </div>
    </Modal>
  );
}

