import { registerSaver } from "../lib/embedSource";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  House,
  Grid3x3, History, Rows3, Ruler, AlignCenter, AlignLeft, AlignRight, Bold, Italic, Maximize, Underline, ZoomIn, ZoomOut,
  ArrowRight, Brush, Circle, ClipboardPaste, Copy, Crop, Droplet, Eraser, Eye, EyeOff, FlipHorizontal, FlipVertical, Hand, Highlighter,
  Layers, Minus, MousePointer2, PaintBucket, Pencil, Pipette, Plus, Redo2, RotateCcw, RotateCw, Save, Scaling, Scissors, Slash, Square, SprayCan,
  LassoSelect, Trash2, Triangle, Type, Undo2, ArrowUp, ArrowDown, Merge, CopyPlus,
} from "lucide-react";
import { WindowControls } from "../components/TitleBar";
import { Modal, ModalButton } from "../components/Modal";
import { SketchDoc, ctx2d, drawShape, floodFill, makeCanvas, rgbToHex, type Rect, type ShapeKind } from "./engine";
import { drawSegment, drawStroke, type Stroke } from "./ink";
import { NewCanvasDialog } from "./SketchHome";
import { SlidePill } from "../components/SlidePill";
import {
  forgetSketch, isUnsavedSketch, markSketchDirty, pickImage, pickSketchSavePath, readImageFile, refreshSketches, sketchTitle, touchRecentSketch,
  untitledSketch, useSketch, writeImageFile, pickImageCanvas, newSketch,
} from "./store";
import { isAndroid } from "../mobile/formFactor";

type Tool = "select" | "lasso" | "pencil" | "brush" | "marker" | "airbrush" | "eraser" | "fill" | "picker" | "text" | "hand" | "sticker" | ShapeKind;
type Pt = { x: number; y: number };
/** A lifted piece: drawn at (x, y) sized w × h, rotated `rot` radians about its centre. */
type Floating = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; rot: number };
type Handle = "move" | "rot" | [number, number];
/** Live text box (editable while the sketch is open; flattened into saved images). */
type TextObj = { id: number; x: number; y: number; w: number; value: string; font: string; size: number; b: boolean; i: boolean; u: boolean; align: "left" | "center" | "right"; color: string; bg: string | null };
type TextStyle = Omit<TextObj, "id" | "x" | "y" | "w" | "value">;
const FONTS: Record<string, string> = { Sans: 'Inter, "Segoe UI", sans-serif', Serif: "Georgia, serif", Mono: "Consolas, monospace", Hand: '"Segoe Print", "Comic Sans MS", cursive' };
const TEXT_SIZES = [12, 16, 24, 32, 48, 72];
const cssFont = (t: TextStyle, z = 1) => `${t.i ? "italic " : ""}${t.b ? "bold " : ""}${t.size * z}px ${FONTS[t.font]}`;
type Tab = "home" | "draw" | "text" | "shapes" | "view";
const TABS: [Tab, string][] = [["home", "Home"], ["draw", "Draw"], ["text", "Text"], ["shapes", "Shapes"], ["view", "View"]];
const TAB_TOOL: Partial<Record<Tab, Tool>> = { home: "select", draw: "brush", text: "text", shapes: "rect" };
type Preset = { tool: Tool; size: number; color: string } | null;
const PRESETS_KEY = "oceanic:sketch-pen-presets";
const loadPresets = (): Preset[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "null");
    if (Array.isArray(v) && v.length === 3) return v;
  } catch {}
  return [null, null, null];
};

/** Word-wrap `value` to `w` px with the context's current font. */
function wrapLines(g: CanvasRenderingContext2D, value: string, w: number) {
  const out: string[] = [];
  for (const para of value.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (line && g.measureText(line + word).width > w && word.trim()) (out.push(line.trimEnd()), (line = word.trimStart()));
      else line += word;
    }
    out.push(line);
  }
  return out;
}
/** Paint text boxes onto a flattened image (same layout as the on-screen boxes). */
function drawTexts(g: CanvasRenderingContext2D, texts: TextObj[]) {
  const PAD = 4;
  for (const t of texts) {
    if (!t.value.trim()) continue;
    g.save();
    g.font = cssFont(t);
    g.textBaseline = "top";
    const lh = t.size * 1.25;
    const lines = wrapLines(g, t.value, t.w - PAD * 2);
    if (t.bg) (g.fillStyle = t.bg), g.fillRect(t.x, t.y, t.w, lines.length * lh + PAD * 2);
    g.fillStyle = t.color;
    g.strokeStyle = t.color;
    g.lineWidth = Math.max(1, t.size / 14);
    lines.forEach((line, k) => {
      const lw = g.measureText(line).width;
      const x = t.align === "left" ? t.x + PAD : t.align === "center" ? t.x + (t.w - lw) / 2 : t.x + t.w - PAD - lw;
      const y = t.y + PAD + k * lh + (lh - t.size) / 2;
      g.fillText(line, x, y);
      if (t.u) g.beginPath(), g.moveTo(x, y + t.size * 1.02), g.lineTo(x + lw, y + t.size * 1.02), g.stroke();
    });
    g.restore();
  }
}
/** Point p in a floating piece's own (unrotated, centre-origin) frame. */
const toLocal = (f: Floating, p: Pt) => {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2, c = Math.cos(-f.rot), s = Math.sin(-f.rot);
  return { x: (p.x - cx) * c - (p.y - cy) * s, y: (p.x - cx) * s + (p.y - cy) * c };
};
/** Clear pixels close to `bg` (transparent selection, like Paint). */
function dropColour(c: HTMLCanvasElement, bg: string) {
  const g = ctx2d(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  for (let i = 0; i < img.data.length; i += 4)
    if (Math.abs(img.data[i] - r) + Math.abs(img.data[i + 1] - gr) + Math.abs(img.data[i + 2] - b) < 24) img.data[i + 3] = 0;
  g.putImageData(img, 0, 0);
}

const STICKERS = ["✔️", "❌", "⭐", "❤️", "➡️", "⬅️", "⚠️", "❓", "❗", "💡", "📌", "✅", "🔥", "👍", "🎯", "📝"];
const CUSTOM_KEY = "oceanic:sketch-custom-colours";
const TOOL_LABEL: Record<string, string> = { select: "Move", lasso: "Move", pencil: "Pencil", brush: "Brush", marker: "Marker", airbrush: "Airbrush", eraser: "Eraser", fill: "Fill", text: "Text", sticker: "Sticker" };
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
const TOOL_KEYS: Record<string, Tool> = { s: "select", q: "lasso", p: "pencil", b: "brush", e: "eraser", g: "fill", i: "picker", t: "text", h: "hand", l: "line", u: "rect" };

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
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [transparentSel, setTransparentSel] = useState(false);
  // Brush feel (brush, marker, airbrush) and straight-line mode.
  const [opacity, setOpacity] = useState(100);
  const [hardness, setHardness] = useState(100);
  const [straight, setStraight] = useState(false);
  const [sticker, setSticker] = useState(STICKERS[2]);
  const [histOpen, setHistOpen] = useState(false);
  const [editColours, setEditColours] = useState(false);
  const [custom, setCustom] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]"); } catch { return []; }
  });
  const addCustom = (c: string) => {
    const next = [c, ...custom.filter((x) => x !== c)].slice(0, 10);
    setCustom(next);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
  };
  // Palm rejection: while a pen is down, touches are ignored.
  const penId = useRef<number | null>(null);
  // Pen options only show once a pen or touchscreen is seen.
  const [penSeen, setPenSeen] = useState(() => navigator.maxTouchPoints > 0);
  const [pressureOn, setPressureOn] = useState(true);
  const [palmOn, setPalmOn] = useState(true);
  const [tab, setTab] = useState<Tab>("draw");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent((r) => [color1, ...r.filter((c) => c !== color1)].slice(0, 8)), [color1]);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const savePreset = (i: number) => {
    const next = presets.map((p, k) => (k === i ? { tool, size, color: color1 } : p));
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
  };
  // Text boxes: `active` is the selected one, `editing` when its textarea is open.
  // Text boxes live on the doc so undo/redo snapshots include them.
  const texts = (docRef.current?.texts ?? []) as TextObj[];
  const setTexts = (fn: (ts: TextObj[]) => TextObj[]) => {
    const d = docRef.current;
    if (!d) return;
    d.texts = fn(d.texts as TextObj[]);
    textsRef.current = d.texts as TextObj[];
    rerender();
  };
  /** Undo step for a text change (keeps vector ink). */
  const mark = () => docRef.current?.checkpoint(true, "Text");
  const [activeText, setActiveText] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState<TextStyle>({ font: "Sans", size: 28, b: false, i: false, u: false, align: "left", color: "#000000", bg: null });
  const textId = useRef(1);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const activeObj = texts.find((t) => t.id === activeText) ?? null;
  // Focus the text box once it's in the page (autoFocus loses to the canvas click).
  useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing, activeText]);
  const [showLayers, setShowLayers] = useState(!isAndroid);
  const [dialog, setDialog] = useState<null | "new" | "resize">(null);
  const [menu, setMenu] = useState(false);
  // Image import: the picked image waits for "insert" or "open as a new canvas".
  const [imported, setImported] = useState<HTMLCanvasElement | null>(null);
  const importImage = () => void pickImageCanvas().then((c) => c && setImported(c));
  // Touch dock (Android): open popover; the dock hides while drawing.
  const [pop, setPop] = useState<null | "draw" | "pick" | "shape" | "colour" | "size" | "file">(null);
  const [drawing, setDrawing] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(makeCanvas(1, 1));
  const saveTimer = useRef(0);
  const prevTool = useRef<Tool>("brush");
  const doc = docRef.current;
  if (doc) doc.label = TOOL_LABEL[toolNow] ?? (SHAPE_KINDS.includes(toolNow) ? "Shape" : "Edit");

  /* ------------------------------------------------------------ load */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (isUnsavedSketch(path)) {
          const u = untitledSketch(path);
          docRef.current = new SketchDoc(u?.w ?? 1280, u?.h ?? 720);
          if (u?.img) docRef.current.ctx.drawImage(u.img, 0, 0);
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
    }
    const ov = overlay.current;
    if (ov.width !== doc.w || ov.height !== doc.h) (ov.width = doc.w), (ov.height = doc.h);
    ov.className = "pointer-events-none absolute inset-0 h-full w-full";
    stack.replaceChildren(...doc.layers.map((l) => l.canvas), ov);
  });

  /* ------------------------------------------------------------ saving */
  /** The image as saved: layers plus text boxes. */
  const composite = (jpg = false) => {
    const c = docRef.current!.flatten(jpg);
    drawTexts(ctx2d(c), textsRef.current);
    return c;
  };
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
  const edit = (fn: (d: SketchDoc) => void, label?: string) => {
    const d = docRef.current;
    if (!d) return;
    commitFloating();
    d.checkpoint(false, label);
    fn(d);
    changed();
  };

  /* ------------------------------------------------------------ selection / clipboard */
  /** Stamp a floating piece onto the layer (with its scale and rotation). */
  const stamp = (f: Floating) => {
    const g = docRef.current!.ctx;
    g.save();
    g.translate(f.x + f.w / 2, f.y + f.h / 2);
    g.rotate(f.rot);
    g.drawImage(f.canvas, -f.w / 2, -f.h / 2, f.w, f.h);
    g.restore();
  };
  const commitFloating = (f = floating) => {
    if (!f || !docRef.current) return;
    stamp(f);
    setFloating(null);
    changed();
  };
  const selCanvas = (r: Rect) => {
    const c = makeCanvas(r.w, r.h);
    ctx2d(c).drawImage(docRef.current!.layer.canvas, -r.x, -r.y);
    return c;
  };
  const clearRect = (d: SketchDoc, r: Rect) => {
    if (d.active === 0) (d.ctx.fillStyle = color2), d.ctx.fillRect(r.x, r.y, r.w, r.h);
    else d.ctx.clearRect(r.x, r.y, r.w, r.h);
  };
  /** Lift a rectangle, or a free-form loop inside it, off the layer into a floating piece. */
  const lift = (r: Rect, loop?: Pt[]) => {
    const d = docRef.current!;
    if (r.w < 1 || r.h < 1) return;
    d.checkpoint();
    let c = selCanvas(r);
    if (loop) {
      const path = new Path2D();
      loop.forEach((q, i) => (i ? path.lineTo(q.x - r.x, q.y - r.y) : path.moveTo(q.x - r.x, q.y - r.y)));
      path.closePath();
      const m = makeCanvas(r.w, r.h);
      const mg = ctx2d(m);
      mg.fill(path);
      mg.globalCompositeOperation = "source-in";
      mg.drawImage(c, 0, 0);
      c = m;
      const g = d.ctx;
      g.save();
      g.translate(r.x, r.y);
      if (d.active === 0) (g.fillStyle = color2), g.fill(path);
      else (g.globalCompositeOperation = "destination-out"), g.fill(path);
      g.restore();
    } else clearRect(d, r);
    if (transparentSel) dropColour(c, color2);
    setFloating({ canvas: c, x: r.x, y: r.y, w: r.w, h: r.h, rot: 0 });
    setSelection(null);
    rerender();
  };
  const internalClip = useRef<HTMLCanvasElement | null>(null);
  const copySel = async () => {
    const d = docRef.current;
    if (!d) return;
    const c = floating?.canvas ?? (selection ? selCanvas(selection) : composite());
    internalClip.current = c;
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {}
  };
  const cutSel = async () => {
    if (!selection && !floating) return;
    await copySel();
    if (floating) return setFloating(null), changed();
    edit((d) => clearRect(d, selection!));
  };
  const removeText = (id: number) => (mark(), setTexts((ts) => ts.filter((t) => t.id !== id)), setActiveText(null), setEditing(false), changed());
  const deleteSel = () => {
    if (activeText !== null && !editing) return removeText(activeText);
    if (floating) return setFloating(null), changed();
    if (selection) edit((d) => clearRect(d, selection));
  };
  /** Ctrl+D: leave a copy behind and keep moving the piece (or text box). */
  const duplicateSel = () => {
    if (activeObj) {
      const t = { ...activeObj, id: textId.current++, x: activeObj.x + 12, y: activeObj.y + 12 };
      return mark(), setTexts((ts) => [...ts, t]), setActiveText(t.id), changed();
    }
    if (!floating) return;
    docRef.current!.checkpoint();
    stamp(floating);
    setFloating({ ...floating, x: floating.x + 12, y: floating.y + 12 });
    changed();
  };
  const nudge = (dx: number, dy: number) => {
    if (activeObj && !editing) return mark(), setTexts((ts) => ts.map((t) => (t.id === activeObj.id ? { ...t, x: t.x + dx, y: t.y + dy } : t))), changed();
    if (floating) setFloating({ ...floating, x: floating.x + dx, y: floating.y + dy });
  };
  const pasteCanvas = (c: HTMLCanvasElement) => {
    const d = docRef.current;
    if (!d) return;
    commitFloating();
    d.checkpoint();
    // Paste bigger than the canvas grows it, like Paint.
    if (c.width > d.w || c.height > d.h) d.resizeCanvas(Math.max(d.w, c.width), Math.max(d.h, c.height));
    setTool("select");
    setFloating({ canvas: c, x: 0, y: 0, w: c.width, h: c.height, rot: 0 });
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

  const tabOf = (t: Tool): Tab => (t === "select" || t === "lasso" ? "home" : t === "text" ? "text" : SHAPE_KINDS.includes(t) || t === "sticker" ? "shapes" : "draw");
  const setTool = (t: Tool) => {
    commitFloating();
    commitText();
    if (t !== "select") setSelection(null);
    if (t !== "picker") prevTool.current = t;
    setToolState(t);
    setTab(tabOf(t));
  };
  const pickTab = (t: Tab) => (TAB_TOOL[t] && TAB_TOOL[t] !== tool ? setTool(TAB_TOOL[t]!) : setTab(t));

  /* ------------------------------------------------------------ text */
  /** Close the open text box; an empty one is dropped. */
  const commitText = () => {
    if (!editing) return setActiveText(null);
    const t = textsRef.current.find((x) => x.id === activeText);
    setEditing(false);
    setActiveText(null);
    if (t && !t.value.trim()) setTexts((ts) => ts.filter((x) => x.id !== t.id));
    changed();
  };
  const patchText = (id: number, patch: Partial<TextObj>) => setTexts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  /** Text tab controls: change the default style and the selected box. */
  const styleText = (patch: Partial<TextStyle>) => {
    setTxt((s) => ({ ...s, ...patch }));
    if (activeText !== null) (mark(), patchText(activeText, patch), changed());
  };
  const newText = (p: Pt) => {
    const t: TextObj = { ...txt, color: color1, id: textId.current++, x: p.x, y: p.y, w: Math.max(160, 300 / zoom), value: "" };
    mark();
    setTexts((ts) => [...ts, t]);
    setActiveText(t.id);
    setEditing(true);
  };

  /* ------------------------------------------------------------ pointer */
  const drag = useRef<{
    start: Pt; last: Pt; button: number; color: string; resize?: boolean; pan?: Pt; spray?: number;
    id?: number; tool?: Tool; ink?: Stroke; loop?: Pt[]; ov?: "line" | "free"; xf?: { h: Handle; from: Floating }; textMove?: { id: number; from: Pt; moved: boolean; width?: boolean };
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
  const pressure = (e: React.PointerEvent) => (e.pointerType === "pen" && pressureOn ? Math.max(0.05, e.pressure || 0.5) : 1);
  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const r = stackRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const stroke = (from: Pt, to: Pt, color: string, g: CanvasRenderingContext2D) => {
    g.save();
    g.strokeStyle = color;
    // Soft edge: a same-colour glow (pencil stays hard).
    if (hardness < 100 && tool !== "pencil") (g.shadowColor = color), (g.shadowBlur = (size * (100 - hardness)) / 100);
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
    g.save();
    g.fillStyle = color;
    g.globalAlpha = opacity / 100;
    for (let i = 0; i < size * 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size;
      g.fillRect(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1, 1);
    }
    g.restore();
  };

  const onDown = (e: React.PointerEvent) => {
    const d = docRef.current;
    if (e.pointerType !== "mouse" && !penSeen) setPenSeen(true);
    if (e.pointerType === "touch" && palmOn && penId.current !== null) return;
    // Pen side button or eraser end: button 5 / buttons bit 32; PC tablet drivers send the side button as right-click.
    const penErase = e.pointerType === "pen" && (e.button === 5 || e.button === 2 || (e.buttons & 34) !== 0);
    if (!d || (e.button !== 0 && e.button !== 2 && e.button !== 1 && !penErase) || drag.current) return;
    if (e.pointerType === "pen") penId.current = e.pointerId;
    const tool: Tool = penErase ? "eraser" : toolNow;
    if (editing && tool !== "text") commitText();
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
    if (tool === "sticker") {
      const px = Math.max(40, size * 6);
      return edit((doc) => {
        const g = doc.ctx;
        g.font = `${px}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(sticker, p.x, p.y);
      }, "Sticker");
    }
    if (tool === "text") {
      // Keep the browser from moving focus to the canvas after the box mounts.
      e.preventDefault();
      if (editing) return commitText();
      return newText(p);
    }
    if (tool === "select" || tool === "lasso") {
      if (floating) {
        const l = toLocal(floating, p);
        if (Math.abs(l.x) <= floating.w / 2 && Math.abs(l.y) <= floating.h / 2) {
          drag.current = { start: p, last: p, button: 0, color, id: e.pointerId, tool, xf: { h: "move", from: floating } };
          return;
        }
      }
      commitFloating();
      setSelection(null);
      drag.current = { start: p, last: p, button: 0, color, id: e.pointerId, tool, loop: tool === "lasso" ? [p] : undefined };
      return;
    }
    const pen = tool === "pencil" || tool === "brush" || tool === "marker";
    // Straight mode / Shift, soft or see-through brush: draw on the overlay, stamp on release.
    const ov = pen && (straight || e.shiftKey) ? "line" : tool === "brush" && (opacity < 100 || hardness < 100) ? "free" : undefined;
    const isInk = (tool === "pencil" || tool === "brush") && !ov;
    d.checkpoint(isInk);
    drag.current = { start: p, last: p, button: e.button, color, id: e.pointerId, tool, ov };
    if (ov) stroke(p, p, color, ctx2d(overlay.current));
    else if (isInk) {
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
    if (st.xf) {
      const { h, from } = st.xf;
      if (h === "move") return setFloating({ ...from, x: from.x + p.x - st.start.x, y: from.y + p.y - st.start.y });
      const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
      if (h === "rot") {
        let rot = from.rot + Math.atan2(p.y - cy, p.x - cx) - Math.atan2(st.start.y - cy, st.start.x - cx);
        if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
        return setFloating({ ...from, rot });
      }
      // Resize in the piece's own frame; the opposite edge stays put.
      const [hx, hy] = h;
      const l = toLocal(from, p);
      let w = hx ? Math.max(4, hx * l.x + from.w / 2) : from.w;
      let ht = hy ? Math.max(4, hy * l.y + from.h / 2) : from.h;
      if (e.shiftKey && hx && hy) {
        const k = Math.max(w / from.w, ht / from.h);
        (w = from.w * k), (ht = from.h * k);
      }
      const ox = (hx * (w - from.w)) / 2, oy = (hy * (ht - from.h)) / 2;
      const c = Math.cos(from.rot), sn = Math.sin(from.rot);
      const ncx = cx + ox * c - oy * sn, ncy = cy + ox * sn + oy * c;
      return setFloating({ ...from, w, h: ht, x: ncx - w / 2, y: ncy - ht / 2 });
    }
    if (st.textMove) {
      const tm = st.textMove;
      const dx = p.x - st.start.x, dy = p.y - st.start.y;
      if (!tm.moved && Math.hypot(dx, dy) * zoom < 3) return;
      if (!tm.moved) mark();
      tm.moved = true;
      if (tm.width) return patchText(tm.id, { w: Math.max(40, tm.from.x + dx) });
      return patchText(tm.id, { x: tm.from.x + dx, y: tm.from.y + dy });
    }
    if (tool === "select" && !st.loop) {
      const x = Math.max(0, Math.min(st.start.x, p.x));
      const y = Math.max(0, Math.min(st.start.y, p.y));
      setSelection({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(d.w, Math.max(st.start.x, p.x)) - x), h: Math.round(Math.min(d.h, Math.max(st.start.y, p.y)) - y) });
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
      const q = { ...p, p: pressure(e) };
      drawSegment(d.ctx, st.ink, st.ink.pts[st.ink.pts.length - 1], q);
      st.ink.pts.push(q);
      st.last = p;
      return;
    }
    if (SHAPE_KINDS.includes(tool)) {
      og.clearRect(0, 0, d.w, d.h);
      let end = p;
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
    if (st.ov === "line") {
      og.clearRect(0, 0, d.w, d.h);
      stroke(st.start, p, st.color, og);
      st.last = p;
      return;
    }
    if (tool === "marker" || st.ov) stroke(st.last, p, st.color, og);
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
    if (st.ink) return d.layer.strokes.push(st.ink), changed();
    if (st.loop) {
      ctx2d(overlay.current).clearRect(0, 0, d.w, d.h);
      if (st.loop.length < 3) return;
      const xs = st.loop.map((q) => q.x), ys = st.loop.map((q) => q.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(d.w, Math.ceil(Math.max(...xs))), y1 = Math.min(d.h, Math.ceil(Math.max(...ys)));
      return lift({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, st.loop);
    }
    if (st.xf) return rerender();
    if (st.textMove) {
      if (st.textMove.moved) return changed();
      // A click without a drag opens the box for typing.
      if (tool === "text" || e.detail > 1) (mark(), setEditing(true));
      return;
    }
    if (st.spray) window.clearInterval(st.spray);
    if (st.pan) return;
    if (st.resize && selection) {
      const r = selection;
      setSelection(null);
      return edit((doc) => doc.resizeCanvas(r.w, r.h));
    }
    if (tool === "select") {
      if (selection && selection.w > 1 && selection.h > 1) lift(selection);
      else setSelection(null);
      return;
    }
    const og = ctx2d(overlay.current);
    if (tool === "marker" || SHAPE_KINDS.includes(tool) || st.ov) {
      d.ctx.save();
      d.ctx.globalAlpha = tool === "marker" ? 0.45 * (opacity / 100) : st.ov && tool === "brush" ? opacity / 100 : 1;
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
      if (mod && k === "s") return handled(), void save();
      if (mod && k === "n") return handled(), setDialog("new");
      if (mod && k === "o") return handled(), void pickImage().then((p) => p && onOpen(p));
      if (mod && k === "c") return handled(), void copySel();
      if (mod && k === "x") return handled(), void cutSel();
      if (mod && k === "a") return handled(), setTool("select"), lift({ x: 0, y: 0, w: d.w, h: d.h });
      if (mod && (k === "=" || k === "+")) return handled(), setZoom((z) => Math.min(8, z * 1.25));
      if (mod && k === "-") return handled(), setZoom((z) => Math.max(0.05, z / 1.25));
      if (mod && k === "0") return handled(), fitZoom();
      if (k === "delete") return handled(), deleteSel();
      if (mod && k === "d") return handled(), duplicateSel();
      if (mod && e.altKey && /^Digit[1-5]$/.test(e.code)) return handled(), pickTab(TABS[Number(e.code[5]) - 1][0]);
      const arrow = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (arrow && (floating || activeObj)) return handled(), nudge(arrow[0] * (e.shiftKey ? 10 : 1), arrow[1] * (e.shiftKey ? 10 : 1));
      if (k === "escape") return commitFloating(), setSelection(null), commitText();
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
  /** Swap the Background layer's backdrop (old background colour is lifted off, drawing kept). */
  const setBackground = (kind: "colour" | "clear" | "grid" | "lines", c = color2) =>
    edit((d) => {
      const bg = d.layers[0].canvas;
      const g = ctx2d(bg);
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
      dropColour(bg, rgbToHex(r, gr, b));
      if (kind === "clear") return;
      g.save();
      g.globalCompositeOperation = "destination-over";
      if (kind !== "colour") {
        g.strokeStyle = "#c7d3e6";
        g.lineWidth = 1;
        g.beginPath();
        for (let y = 32; y < d.h; y += 32) g.moveTo(0, y + 0.5), g.lineTo(d.w, y + 0.5);
        if (kind === "grid") for (let x = 32; x < d.w; x += 32) g.moveTo(x + 0.5, 0), g.lineTo(x + 0.5, d.h);
        g.stroke();
      }
      g.fillStyle = kind === "colour" ? c : "#ffffff";
      g.fillRect(0, 0, d.w, d.h);
      g.restore();
    }, "Background");
  const crop = () => {
    const r = floating ? { x: Math.round(floating.x), y: Math.round(floating.y), w: Math.round(floating.w), h: Math.round(floating.h) } : selection;
    if (r) setSelection(null), edit((d) => d.crop(r), "Crop");
  };
  const copyImage = async () => {
    const blob = await new Promise<Blob | null>((r) => composite().toBlob(r, "image/png"));
    if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
  };

  if (status === "error") return <div className="grid h-full place-items-center text-[14px] text-red-400">Couldn't open this image.</div>;
  if (!doc) return <div className="h-full" />;

  /* ------------------------------------------------------------ UI pieces */
  const T = ({ t, icon, label, keyHint }: { t: Tool; icon: ReactNode; label: string; keyHint?: string }) => (
    <IBtn tip={keyHint ? `${label} (${keyHint})` : label} on={tool === t} onClick={() => setTool(t)}>
      {icon}
    </IBtn>
  );
  const drawTools = (
    <>
      <T t="select" icon={<MousePointer2 />} label="Select" keyHint="S" />
      <T t="lasso" icon={<LassoSelect />} label="Free-form select" keyHint="Q" />
      <T t="pencil" icon={<Pencil />} label="Pencil" keyHint="P" />
      <T t="brush" icon={<Brush />} label="Brush" keyHint="B" />
      <T t="marker" icon={<Highlighter />} label="Marker" />
      <T t="airbrush" icon={<SprayCan />} label="Airbrush" />
      <T t="eraser" icon={<Eraser />} label="Eraser" keyHint="E" />
      <T t="fill" icon={<PaintBucket />} label="Fill" keyHint="G" />
      <T t="picker" icon={<Pipette />} label="Colour picker" keyHint="I" />
      <T t="text" icon={<Type />} label="Text" keyHint="T" />
      <T t="hand" icon={<Hand />} label="Pan" keyHint="H" />
    </>
  );
  const shapeTools = SHAPES.map((s) => <T key={s.kind} t={s.kind} icon={s.icon} label={s.label} />);
  const shapeStyle = (
    <Seg value={shapeMode} onChange={(v) => setShapeMode(v as typeof shapeMode)} options={[["outline", "Outline"], ["fill", "Fill"], ["both", "Both"]]} />
  );
  const sizeCtl = (
    <label className="flex items-center gap-2 text-[12px] text-neutral-400" data-tip="Size ([ / ])">
      <span className="grid size-7 place-items-center"><span className="rounded-full bg-neutral-200" style={{ width: Math.max(2, Math.min(24, size / 2)), height: Math.max(2, Math.min(24, size / 2)) }} /></span>
      <Slider value={size} min={1} max={100} unit="px" width={72} onChange={setSize} />
    </label>
  );
  const pick1 = (c: string) => (setColor1(c), activeText !== null && (mark(), patchText(activeText, { color: c }), changed()));
  const colours = (
    <div className="flex items-center gap-2">
      <div className="relative size-10 shrink-0" data-tip="Colour 1 (left click) · Colour 2 (right click)">
        <label className="absolute left-0 top-0 size-7 cursor-pointer rounded-md border-2 border-neutral-200 shadow" style={{ background: color1 }}>
          <input type="color" value={color1} onChange={(e) => pick1(e.target.value)} className="sr-only" />
        </label>
        <label className="absolute bottom-0 right-0 size-6 cursor-pointer rounded-md border-2 border-neutral-500" style={{ background: color2 }}>
          <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} className="sr-only" />
        </label>
      </div>
      <button type="button" data-tip="Swap colours" onClick={() => (setColor1(color2), setColor2(color1))} className="cursor-pointer text-neutral-400 hover:text-neutral-100">⇄</button>
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-10 gap-[5px]">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick1(c)}
              onContextMenu={(e) => (e.preventDefault(), setColor2(c))}
              className={`size-4 cursor-pointer rounded-full border transition-transform hover:scale-110 ${c === color1 ? "border-white ring-1 ring-[color:var(--oc-sketch)]" : "border-white/20"}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="grid grid-cols-10 gap-[5px]" data-tip="Custom colours (Edit colours adds here)">
          {Array.from({ length: 10 }, (_, i) => custom[i]).map((c, i) =>
            c ? (
              <button key={i} type="button" onClick={() => pick1(c)} onContextMenu={(e) => (e.preventDefault(), setColor2(c))} className="size-4 cursor-pointer rounded-full border border-white/20 hover:scale-110" style={{ background: c }} />
            ) : (
              <span key={i} className="size-4 rounded-full border border-dashed border-white/15" />
            ),
          )}
        </div>
      </div>
      <div className="relative">
        <button type="button" data-tip="Edit colours" onClick={() => setEditColours((v) => !v)} className="grid size-8 cursor-pointer place-items-center rounded-md hover:bg-white/[0.07]">
          <span className="size-6 rounded-full" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
        </button>
        {editColours && <EditColours start={color1} onClose={() => setEditColours(false)} onPick={(c) => (pick1(c), addCustom(c), setEditColours(false))} />}
      </div>
      {recent.length > 1 && (
        <div className="grid grid-cols-4 gap-1" data-tip="Recent colours">
          {recent.map((c) => (
            <button key={c} type="button" onClick={() => pick1(c)} className="size-4 cursor-pointer rounded-full border border-white/15 hover:scale-125" style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  );
  const imageTools = (
    <>
      <IBtn tip="Crop to selection" disabled={!selection && !floating} onClick={crop}><Crop /></IBtn>
      <IBtn tip="Resize image" onClick={() => setDialog("resize")}><Scaling /></IBtn>
      <IBtn tip="Rotate left" onClick={() => edit((d) => d.rotate(-90), "Rotate")}><RotateCcw /></IBtn>
      <IBtn tip="Rotate right" onClick={() => edit((d) => d.rotate(90), "Rotate")}><RotateCw /></IBtn>
      <IBtn tip="Flip horizontal" onClick={() => edit((d) => d.flip(true), "Flip")}><FlipHorizontal /></IBtn>
      <IBtn tip="Flip vertical" onClick={() => edit((d) => d.flip(false), "Flip")}><FlipVertical /></IBtn>
    </>
  );
  const clipboard = (
    <>
      <IBtn tip="Paste (Ctrl+V)" onClick={() => void pasteFromClipboard()}><ClipboardPaste /></IBtn>
      <IBtn tip="Cut (Ctrl+X)" disabled={!selection && !floating} onClick={() => void cutSel()}><Scissors /></IBtn>
      <IBtn tip="Copy (Ctrl+C)" onClick={() => void copySel()}><Copy /></IBtn>
      <IBtn tip="Duplicate (Ctrl+D)" disabled={!floating && !activeObj} onClick={duplicateSel}><CopyPlus /></IBtn>
      <IBtn tip="Delete (Del)" disabled={!floating && !selection && !activeObj} onClick={deleteSel}><Trash2 /></IBtn>
    </>
  );
  const st = activeObj ?? txt;
  const textOpts = (
    <>
      <Group label="Font">
        <select value={st.font} onChange={(e) => styleText({ font: e.target.value })} className="h-7 rounded-md border border-white/[0.1] bg-[var(--oc-surface)] px-1.5 text-[12.5px] text-neutral-100 outline-none">
          {Object.keys(FONTS).map((f) => <option key={f} value={f} style={{ fontFamily: FONTS[f] }}>{f}</option>)}
        </select>
        <input type="number" min={6} max={300} value={st.size} onChange={(e) => styleText({ size: Math.max(6, Number(e.target.value) || 6) })} data-tip="Text size" className="h-7 w-14 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[12.5px] text-neutral-100 outline-none" />
        <div className="flex gap-0.5">
          {TEXT_SIZES.map((n) => (
            <button key={n} type="button" onClick={() => styleText({ size: n })} className={`h-7 min-w-7 cursor-pointer rounded-md px-1 text-[11.5px] tabular-nums ${st.size === n ? "bg-[color:var(--oc-sketch)]/20 text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:bg-white/[0.07]"}`}>{n}</button>
          ))}
        </div>
      </Group>
      <Group label="Style">
        <IBtn tip="Bold (Ctrl+B)" on={st.b} onClick={() => styleText({ b: !st.b })}><Bold /></IBtn>
        <IBtn tip="Italic (Ctrl+I)" on={st.i} onClick={() => styleText({ i: !st.i })}><Italic /></IBtn>
        <IBtn tip="Underline (Ctrl+U)" on={st.u} onClick={() => styleText({ u: !st.u })}><Underline /></IBtn>
        <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
        <IBtn tip="Align left" on={st.align === "left"} onClick={() => styleText({ align: "left" })}><AlignLeft /></IBtn>
        <IBtn tip="Align centre" on={st.align === "center"} onClick={() => styleText({ align: "center" })}><AlignCenter /></IBtn>
        <IBtn tip="Align right" on={st.align === "right"} onClick={() => styleText({ align: "right" })}><AlignRight /></IBtn>
        <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
        <IBtn tip="Background fill (colour 2)" on={!!st.bg} onClick={() => styleText({ bg: st.bg ? null : color2 })}><PaintBucket /></IBtn>
      </Group>
    </>
  );
  const optionsFor = SHAPE_KINDS.includes(tool) ? shapeStyle : tool === "text" ? <div className="flex gap-2">{textOpts}</div> : null;
  const presetRow = (
    <div className="flex gap-1">
      {presets.map((pr, i) => (
        <button
          key={i}
          type="button"
          data-tip={pr ? `Preset ${i + 1}: ${pr.tool}, ${pr.size}px · right-click to replace` : `Save current pen as preset ${i + 1}`}
          onClick={() => (pr ? (setTool(pr.tool), setSize(pr.size), setColor1(pr.color)) : savePreset(i))}
          onContextMenu={(e) => (e.preventDefault(), savePreset(i))}
          className="grid size-8 cursor-pointer place-items-center rounded-md border border-white/[0.08] hover:bg-white/[0.07]"
        >
          {pr ? <span className="rounded-full" style={{ background: pr.color, width: Math.max(4, Math.min(20, pr.size / 2)), height: Math.max(4, Math.min(20, pr.size / 2)) }} /> : <Plus className="size-3.5 text-neutral-500" />}
        </button>
      ))}
    </div>
  );
  const penOpts = penSeen && (
    <Group label="Pen">
      <div className="flex flex-col gap-0.5 text-[12px] text-neutral-300">
        <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={pressureOn} onChange={(e) => setPressureOn(e.target.checked)} className="accent-[var(--oc-sketch)]" />Pressure</label>
        <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={palmOn} onChange={(e) => setPalmOn(e.target.checked)} className="accent-[var(--oc-sketch)]" />Palm rejection</label>
      </div>
    </Group>
  );
  const tabsBar = (
      <div className="ml-2 flex w-fit gap-0.5 rounded-lg p-0.5">
        <SlidePill className="rounded-md !bg-[color:var(--oc-sketch)]/20" />
        {TABS.map(([t, l], i) => (
          <button key={t} type="button" aria-pressed={tab === t} data-tip={`${l} (Ctrl+Alt+${i + 1})`} onClick={() => pickTab(t)} className={`h-7 cursor-pointer rounded-md px-3 text-[12.5px] font-medium ${tab === t ? "text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:text-neutral-200"}`}>
            {l}
          </button>
        ))}
      </div>
  );
  const ribbon = (
    <div className="oc-sketch-ribbon oc-docs-enter shrink-0 px-2 pb-2">
      <div key={tab} className="oc-fade-in flex min-h-[83px] items-stretch gap-1 overflow-x-auto">
        {tab === "home" && (
          <>
            <Group label="Clipboard">{clipboard}</Group>
            <Group label="Select">
              <T t="select" icon={<MousePointer2 />} label="Rectangle select" keyHint="S" />
              <T t="lasso" icon={<LassoSelect />} label="Free-form select" keyHint="Q" />
              <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-neutral-300" data-tip="Leave colour 2 behind when moving">
                <input type="checkbox" checked={transparentSel} onChange={(e) => setTransparentSel(e.target.checked)} className="accent-[var(--oc-sketch)]" />Transparent
              </label>
            </Group>
            <Group label="Image">{imageTools}</Group>
            <Group label="Background">
              <IBtn tip="Solid colour (colour 2)" onClick={() => setBackground("colour")}><span className="size-4 rounded border border-white/40" style={{ background: color2 }} /></IBtn>
              <IBtn tip="Transparent" onClick={() => setBackground("clear")}><span className="oc-checker size-4 rounded border border-white/40" /></IBtn>
              <IBtn tip="Grid paper" onClick={() => setBackground("grid")}><Grid3x3 /></IBtn>
              <IBtn tip="Lined paper" onClick={() => setBackground("lines")}><Rows3 /></IBtn>
            </Group>
            <Group label="Colours">{colours}</Group>
          </>
        )}
        {tab === "draw" && (
          <>
            <Group label="Tools">
              <div className="flex gap-0.5">
                <T t="pencil" icon={<Pencil />} label="Pencil" keyHint="P" />
                <T t="brush" icon={<Brush />} label="Brush" keyHint="B" />
                <T t="marker" icon={<Highlighter />} label="Marker" />
                <T t="airbrush" icon={<SprayCan />} label="Airbrush" />
                <T t="eraser" icon={<Eraser />} label="Eraser" keyHint="E" />
                <T t="fill" icon={<PaintBucket />} label="Fill" keyHint="G" />
                <T t="picker" icon={<Pipette />} label="Colour picker" keyHint="I" />
                <T t="hand" icon={<Hand />} label="Pan" keyHint="H" />
              </div>
            </Group>
            <Group label="Size">{sizeCtl}</Group>
            <Group label="Brush">
              <div className="flex flex-col gap-0.5 text-[11.5px] text-neutral-400">
                <label className="flex items-center justify-between gap-1.5" data-tip="Opacity (brush, marker, airbrush)">Opacity<Slider value={opacity} min={5} max={100} unit="%" width={76} onChange={setOpacity} /></label>
                <label className="flex items-center justify-between gap-1.5" data-tip="Hardness: lower is a softer edge">Hardness<Slider value={hardness} min={0} max={100} unit="%" width={76} onChange={setHardness} /></label>
              </div>
              <span className="oc-checker grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10" data-tip="Brush preview">
                <span
                  className="rounded-full"
                  style={{
                    width: Math.max(2, Math.min(30, size)),
                    height: Math.max(2, Math.min(30, size)),
                    background: color1,
                    opacity: opacity / 100,
                    filter: hardness < 100 ? `blur(${(Math.min(30, size) * (100 - hardness)) / 400}px)` : undefined,
                  }}
                />
              </span>
              <IBtn tip="Straight lines (or hold Shift)" on={straight} onClick={() => setStraight((v) => !v)}><Ruler /></IBtn>
            </Group>
            <Group label="Presets">{presetRow}</Group>
            {penOpts}
            <Group label="Colours">{colours}</Group>
          </>
        )}
        {tab === "text" && (
          <>
            {textOpts}
            <Group label="Colour">{colours}</Group>
          </>
        )}
        {tab === "shapes" && (
          <>
            <Group label="Shapes"><div className="grid grid-cols-6 gap-0.5">{shapeTools}</div></Group>
            <Group label="Style">{shapeStyle}</Group>
            <Group label="Stickers">
              <div className="grid grid-cols-8 gap-0.5">
                {STICKERS.map((k) => (
                  <button key={k} type="button" data-tip="Click, then click the canvas" onClick={() => (setSticker(k), setTool("sticker"))} className={`grid size-6 cursor-pointer place-items-center rounded-md text-[14px] hover:bg-white/[0.07] ${tool === "sticker" && sticker === k ? "bg-[color:var(--oc-sketch)]/20" : ""}`}>{k}</button>
                ))}
              </div>
            </Group>
            <Group label="Width">{sizeCtl}</Group>
            <Group label="Colours">{colours}</Group>
          </>
        )}
        {tab === "view" && (
          <>
            <Group label="Panels"><IBtn tip="Layers" on={showLayers} onClick={() => setShowLayers((v) => !v)}><Layers /></IBtn></Group>
          </>
        )}
        <Group label="Zoom">
          <IBtn tip="Zoom out (Ctrl+-)" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}><ZoomOut /></IBtn>
          <button type="button" data-tip="Actual size" onClick={() => setZoom(1)} className="h-7 w-12 cursor-pointer rounded-md text-[12px] tabular-nums text-neutral-300 hover:bg-white/[0.07]">{Math.round(zoom * 100)}%</button>
          <IBtn tip="Zoom in (Ctrl+=)" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}><ZoomIn /></IBtn>
          <IBtn tip="Fit (Ctrl+0)" onClick={fitZoom}><Maximize /></IBtn>
        </Group>
      </div>
    </div>
  );

  const layersPanel = (
    <LayersPanel
      doc={doc}
      onSelect={(i) => ((doc.active = i), rerender())}
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
            <MItem label="Import image…" onClick={importImage} />
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
    <div data-tauri-drag-region className="oc-docs-chrome oc-docs-enter relative z-30 flex h-10 shrink-0 items-center gap-1 pl-2">
      <IBtn tip="Sketch Home" onClick={onHome}><House /></IBtn>
      <span className="mx-0.5 h-5 w-px bg-white/[0.08]" />
      {fileMenu}
      <IBtn tip="Save (Ctrl+S)" onClick={() => void save()}><Save /></IBtn>
      <IBtn tip="Undo (Ctrl+Z)" disabled={!doc.canUndo} onClick={() => (commitFloating(), doc.undo(), changed())}><Undo2 /></IBtn>
      <IBtn tip="Redo (Ctrl+Y)" disabled={!doc.canRedo} onClick={() => (doc.redo(), changed())}><Redo2 /></IBtn>
      <div className="relative">
        <IBtn tip="History" on={histOpen} disabled={!doc.canUndo} onClick={() => setHistOpen((v) => !v)}><History /></IBtn>
        {histOpen && (
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setHistOpen(false)} />
            <div className="oc-docs-pop absolute left-0 top-full z-50 mt-1 max-h-80 w-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl">
              {doc.history.map((l, i, all) => ({ l, back: all.length - i - 1 })).reverse().map(({ l, back }, k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    commitFloating();
                    for (let n = 0; n < back; n++) doc.undo();
                    setHistOpen(false);
                    changed();
                  }}
                  className={`flex h-7 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-[12.5px] hover:bg-white/[0.06] ${back === 0 ? "text-[color:var(--oc-sketch-light)]" : "text-neutral-200"}`}
                >
                  <span className="flex-1">{l}</span>
                  {back === 0 && <span className="text-[10.5px] text-neutral-500">now</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {layout === "paint" && tabsBar}
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
            style={{ imageRendering: zoom > 2 ? "pixelated" : "auto", cursor: ringCursor() }}
            onPointerDown={(e) => (setDrawing(true), setPop(null), onDown(e))}
            onPointerMove={onMove}
            onPointerUp={(e) => (setDrawing(false), onUp(e))}
            onPointerCancel={(e) => (setDrawing(false), onUp(e))}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          {/* Floating piece with resize + rotate handles */}
          {floating && (
            <div
              className="oc-marquee pointer-events-none absolute"
              style={{ left: floating.x * zoom, top: floating.y * zoom, width: floating.w * zoom, height: floating.h * zoom, transform: `rotate(${floating.rot}rad)` }}
            >
              <canvas
                ref={(c) => {
                  if (!c) return;
                  if (c.width !== floating.canvas.width || c.height !== floating.canvas.height) (c.width = floating.canvas.width), (c.height = floating.canvas.height);
                  const g = ctx2d(c);
                  g.clearRect(0, 0, c.width, c.height);
                  g.drawImage(floating.canvas, 0, 0);
                }}
                className="absolute inset-0 h-full w-full"
              />
              {(["rot", [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] as Handle[]).map((h, i) => {
                const grab = (e: React.PointerEvent) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const p = toCanvas(e);
                  drag.current = { start: p, last: p, button: 0, color: "", id: e.pointerId, tool, xf: { h, from: floating } };
                };
                const at = h === "rot" ? { left: "50%", top: -26 } : h === "move" ? {} : { left: `${(h[0] + 1) * 50}%`, top: `${(h[1] + 1) * 50}%` };
                const cur = typeof h === "string" ? "grab" : h[0] === 0 ? "ns-resize" : h[1] === 0 ? "ew-resize" : h[0] === h[1] ? "nwse-resize" : "nesw-resize";
                return (
                  <span
                    key={i}
                    onPointerDown={grab}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    className={`pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-neutral-500 bg-white ${h === "rot" ? "rounded-full" : "rounded-sm"}`}
                    style={{ ...at, cursor: cur }}
                    data-tip={h === "rot" ? "Rotate (Shift snaps 15°)" : undefined}
                  />
                );
              })}
            </div>
          )}
          {selection && !floating && (
            <div className="oc-marquee pointer-events-none absolute" style={{ left: selection.x * zoom, top: selection.y * zoom, width: selection.w * zoom, height: selection.h * zoom }} />
          )}
          {/* Text boxes */}
          {texts.map((t) => {
            const on = t.id === activeText;
            const box = { left: t.x * zoom, top: t.y * zoom, width: t.w * zoom, fontFamily: FONTS[t.font], fontSize: t.size * zoom, fontWeight: t.b ? 700 : 400, fontStyle: t.i ? "italic" : "normal", color: t.color, lineHeight: 1.25, textAlign: t.align, textDecoration: t.u ? "underline" : undefined, background: t.bg ?? "transparent", padding: 4 * zoom, minHeight: t.size * 1.25 * zoom + 8 * zoom } as const;
            const live = tool === "text" || tool === "select" || tool === "lasso";
            if (on && editing)
              return (
                <textarea
                  key={t.id}
                  ref={textRef}
                  value={t.value}
                  onChange={(e) => patchText(t.id, { value: e.target.value })}
                  onKeyDown={(e) => {
                    const k = e.key.toLowerCase() as "b" | "i" | "u";
                    if (e.key === "Escape") (e.preventDefault(), commitText());
                    if (e.ctrlKey && (k === "b" || k === "i" || k === "u")) (e.preventDefault(), styleText({ [k]: !t[k] }));
                    if (e.key === "Enter" && e.ctrlKey) commitText();
                  }}
                  className="absolute resize-none overflow-hidden border-0 outline outline-1 outline-dashed outline-[color:var(--oc-sketch)]"
                  style={{ ...box, fieldSizing: "content" } as React.CSSProperties}
                  placeholder="Type here"
                />
              );
            return (
              <div
                key={t.id}
                onPointerDown={(e) => {
                  if (!live || e.button !== 0) return;
                  e.stopPropagation();
                  commitFloating();
                  if (editing && !on) commitText();
                  setActiveText(t.id);
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const p = toCanvas(e);
                  drag.current = { start: p, last: p, button: 0, color: "", id: e.pointerId, tool, textMove: { id: t.id, from: { x: t.x, y: t.y }, moved: false } };
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={`absolute whitespace-pre-wrap break-words ${live ? "cursor-move" : "pointer-events-none"} ${on ? "outline outline-1 outline-dashed outline-[color:var(--oc-sketch)]" : live ? "hover:outline hover:outline-1 hover:outline-white/40" : ""}`}
                style={box}
              >
                {t.value}
                {on && (
                  <span
                    data-tip="Drag to change width"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      const p = toCanvas(e);
                      drag.current = { start: p, last: p, button: 0, color: "", id: e.pointerId, tool, textMove: { id: t.id, from: { x: t.w, y: 0 }, moved: false, width: true } };
                    }}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    className="absolute -right-1.5 top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-neutral-500 bg-white"
                  />
                )}
              </div>
            );
          })}
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
      <span className="tabular-nums">{selection ? `${selection.w} × ${selection.h}px selected` : ""}</span>
      <span className="tabular-nums">{doc.w} × {doc.h}px</span>
      <span className="flex-1" />
      <button type="button" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))} className="cursor-pointer hover:text-white"><Minus className="size-3.5" /></button>
      <Slider value={Math.round(zoom * 100)} min={5} max={800} unit="%" width={128} onChange={(v) => setZoom(v / 100)} />
      <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} className="cursor-pointer hover:text-white"><Plus className="size-3.5" /></button>
      <button type="button" data-tip="Fit (Ctrl+0)" onClick={fitZoom} className="cursor-pointer hover:text-white"><Maximize className="size-3.5" /></button>
    </div>
  );

  const importDialog = imported && (
    <Modal onClose={() => setImported(null)} className="w-[360px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">Import image</h2>
      <div className="flex flex-col gap-2">
        <ModalButton variant="primary" onClick={() => (pasteCanvas(imported), setImported(null))}>Insert into this canvas</ModalButton>
        <ModalButton onClick={() => (onOpen(newSketch(imported.width, imported.height, imported)), setImported(null))}>Open as a new canvas</ModalButton>
      </div>
    </Modal>
  );

  if (isAndroid) {
    // Touch: the canvas fills the screen; a glass dock floats at the bottom and hides while drawing or typing.
    const toolIcon: Partial<Record<Tool, ReactNode>> = {
      select: <MousePointer2 />, lasso: <LassoSelect />, pencil: <Pencil />, brush: <Brush />, marker: <Highlighter />, airbrush: <SprayCan />,
      ...Object.fromEntries(SHAPES.map((x) => [x.kind, x.icon])),
    };
    const pop1 = (id: NonNullable<typeof pop>, button: ReactNode, body: ReactNode, cls = "") => (
      <span className="relative flex">
        {button}
        {pop === id && <div className={`oc-dock-pop ${cls}`}>{body}</div>}
      </span>
    );
    const group = (id: "draw" | "pick" | "shape", tools: Tool[], fallback: ReactNode, items: ReactNode) =>
      pop1(id, <IBtn tip="" on={tools.includes(tool)} onClick={() => setPop(pop === id ? null : id)}>{tools.includes(tool) ? toolIcon[tool] : fallback}</IBtn>, <div className="flex items-center gap-1" onClick={() => setPop(null)}>{items}</div>);
    return (
      <div className="oc-sketch relative h-full" onMouseDown={(e) => editing && !(e.target as HTMLElement).closest("textarea") && !stackRef.current?.contains(e.target as Node) && commitText()}>
        <div className="flex h-full">
          {canvasArea}
          {showLayers && !drawing && <aside className="oc-dock-layers scrollbar-thin">{layersPanel}</aside>}
        </div>
        <div className={`oc-dock ocm-liquid${drawing || editing ? " hide" : ""}`}>
          <IBtn tip="Sketch Home" onClick={onHome}><House /></IBtn>
          <IBtn tip="Undo" disabled={!doc.canUndo} onClick={() => (commitFloating(), doc.undo(), changed())}><Undo2 /></IBtn>
          <IBtn tip="Redo" disabled={!doc.canRedo} onClick={() => (doc.redo(), changed())}><Redo2 /></IBtn>
          <span className="h-6 w-px bg-white/[0.1]" />
          {group("draw", ["pencil", "brush", "marker", "airbrush"], <Brush />, <><T t="pencil" icon={<Pencil />} label="Pencil" /><T t="brush" icon={<Brush />} label="Brush" /><T t="marker" icon={<Highlighter />} label="Marker" /><T t="airbrush" icon={<SprayCan />} label="Airbrush" /></>)}
          <T t="eraser" icon={<Eraser />} label="Eraser" />
          {group("pick", ["select", "lasso"], <MousePointer2 />, <><T t="select" icon={<MousePointer2 />} label="Select" /><T t="lasso" icon={<LassoSelect />} label="Lasso" /></>)}
          {group("shape", SHAPE_KINDS as Tool[], <Square />, <>{shapeTools}{shapeStyle}</>)}
          <T t="fill" icon={<PaintBucket />} label="Fill" />
          <T t="picker" icon={<Pipette />} label="Colour picker" />
          <T t="text" icon={<Type />} label="Text" />
          <T t="hand" icon={<Hand />} label="Pan" />
          <span className="h-6 w-px bg-white/[0.1]" />
          {pop1("colour", (
            <button type="button" aria-label="Colour" onClick={() => setPop(pop === "colour" ? null : "colour")} className="grid size-9 place-items-center">
              <span className="size-6 rounded-full border-2 border-white/70" style={{ background: color1 }} />
            </button>
          ), colours)}
          {pop1("size", (
            <button type="button" aria-label="Size" onClick={() => setPop(pop === "size" ? null : "size")} className="grid size-9 place-items-center">
              <span className="rounded-full bg-neutral-200" style={{ width: Math.max(3, Math.min(22, size / 2)), height: Math.max(3, Math.min(22, size / 2)) }} />
            </button>
          ), <div className="flex items-center gap-3">{sizeCtl}{optionsFor}</div>)}
          <span className="h-6 w-px bg-white/[0.1]" />
          <IBtn tip="Layers" on={showLayers} onClick={() => setShowLayers((v) => !v)}><Layers /></IBtn>
          {pop1("file", <IBtn tip="More" on={pop === "file"} onClick={() => setPop(pop === "file" ? null : "file")}><Save /></IBtn>, (
            <div className="w-52" onClick={() => setPop(null)}>
              <MItem label="Save" onClick={() => void save()} />
              <MItem label="Import image…" onClick={importImage} />
              <MItem label="New canvas…" onClick={() => setDialog("new")} />
              <MItem label="Fit to screen" onClick={fitZoom} />
              <MItem label="Resize image…" onClick={() => setDialog("resize")} />
              <MItem label="Copy image" onClick={() => void copyImage()} />
            </div>
          ), "end")}
        </div>
        {dialog === "new" && <NewCanvasDialog onClose={() => setDialog(null)} onCreate={(p) => (setDialog(null), onOpen(p))} />}
        {dialog === "resize" && <ResizeDialog w={doc.w} h={doc.h} onClose={() => setDialog(null)} onApply={(w, h) => (setDialog(null), edit((d) => d.scaleImage(w, h)))} />}
        {importDialog}
      </div>
    );
  }

  return (
    <div className="oc-sketch relative flex h-full flex-col">
      {titleStrip}
      {layout === "paint" ? (
        <>
          {/* Paint-style ribbon: tabs, then the tab's labelled groups */}
          {ribbon}
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
      {dialog === "resize" && <ResizeDialog w={doc.w} h={doc.h} onClose={() => setDialog(null)} onApply={(w, h) => (setDialog(null), edit((d) => d.scaleImage(w, h), "Resize"))} />}
      {importDialog}
    </div>
  );
}

/* ------------------------------------------------------------ pieces */
function IBtn({ tip, on, disabled, onClick, children }: { tip: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
      className={`oc-press grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors duration-150 disabled:cursor-default disabled:opacity-30 [&_svg]:size-[17px] ${on ? "bg-[color:var(--oc-sketch)]/20 text-[color:var(--oc-sketch-light)]" : "text-neutral-300 hover:bg-white/[0.07]"}`}
    >
      {children}
    </button>
  );
}
function Group({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <div className={`flex ${grow ? "min-w-fit flex-1" : "shrink-0"} flex-col justify-between rounded-lg bg-[var(--oc-raised)] px-2 pt-1.5`}>
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <span className="py-0.5 text-center text-[10.5px] text-neutral-500">{label}</span>
    </div>
  );
}
function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded-md border border-white/[0.08] p-0.5">
      <SlidePill className="rounded !bg-[color:var(--oc-sketch)]/20" />
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`h-6 cursor-pointer rounded px-2 text-[11.5px] ${value === v ? "text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:text-neutral-200"}`}>
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
  doc, onSelect, onToggle, onOpacity, onRename, onAction,
}: {
  doc: SketchDoc;
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
        <span className="flex-1" />
        <Slider value={Math.round(doc.layer.opacity * 100)} min={0} max={100} unit="%" width={110} onChange={(v) => onOpacity(v / 100)} />
      </label>
      <div className="mt-2 flex gap-1">
        <IBtn tip="Move layer up" onClick={() => onAction("up")}><ArrowUp /></IBtn>
        <IBtn tip="Move layer down" onClick={() => onAction("down")}><ArrowDown /></IBtn>
        <IBtn tip="Merge down" disabled={doc.active === 0} onClick={() => onAction("merge")}><Merge /></IBtn>
      </div>
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


/** Paint-style "Edit colours": spectrum picker plus a hex box; OK adds it to custom colours. */
function EditColours({ start, onPick, onClose }: { start: string; onPick: (c: string) => void; onClose: () => void }) {
  const [c, setC] = useState(start);
  const [hex, setHex] = useState(start);
  const ok = /^#[0-9a-f]{6}$/i.test(hex);
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div className="oc-docs-pop absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-3 shadow-xl">
        <input type="color" value={c} onChange={(e) => (setC(e.target.value), setHex(e.target.value))} className="h-24 w-full cursor-pointer rounded-md border-0 bg-transparent p-0" />
        <label className="mt-2 flex items-center gap-2 text-[12px] text-neutral-400">Hex
          <input value={hex} onChange={(e) => (setHex(e.target.value), /^#[0-9a-f]{6}$/i.test(e.target.value) && setC(e.target.value))} className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 font-mono text-[12px] text-neutral-100 outline-none" />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={() => ok && onPick(hex.toLowerCase())}>OK</ModalButton>
        </div>
      </div>
    </>
  );
}

/** Glass slider: filled track, click the value to type one, mouse wheel nudges (Shift = 10). */
function Slider({ value, min, max, unit = "", width, onChange }: { value: number; min: number; max: number; unit?: string; width: number; onChange: (v: number) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const done = () => (typing !== null && typing.trim() && !Number.isNaN(Number(typing)) && onChange(clamp(Number(typing))), setTyping(null));
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onWheel={(e) => onChange(clamp(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)))}
        className="oc-range"
        style={{ width, ["--p" as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      {typing !== null ? (
        <input
          autoFocus
          value={typing}
          onChange={(e) => setTyping(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={done}
          onKeyDown={(e) => (e.key === "Enter" ? done() : e.key === "Escape" && setTyping(null))}
          className="h-5 w-10 rounded border border-[color:var(--oc-sketch)] bg-white/[0.06] px-1 text-right text-[11.5px] tabular-nums text-neutral-100 outline-none"
        />
      ) : (
        <button type="button" data-tip="Click to type" onClick={(e) => (e.preventDefault(), setTyping(String(value)))} className="h-5 w-10 cursor-text rounded text-right text-[11.5px] tabular-nums text-neutral-300 hover:bg-white/[0.07]">
          {value}{unit}
        </button>
      )}
    </span>
  );
}
