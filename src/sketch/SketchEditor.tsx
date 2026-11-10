import { registerSaver } from "../lib/embedSource";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  House,
  ArrowRight, Brush, Circle, ClipboardPaste, Copy, Crop, Droplet, Eraser, Eye, EyeOff, FlipHorizontal, FlipVertical, Hand, Highlighter,
  Layers, Minus, MousePointer2, PaintBucket, Pencil, Pipette, Plus, Redo2, RotateCcw, RotateCw, Save, Scaling, Scissors, Slash, Square, SprayCan,
  Trash2, Triangle, Type, Undo2, ArrowUp, ArrowDown, Merge, CopyPlus,
} from "lucide-react";
import { WindowControls } from "../components/TitleBar";
import { Modal, ModalButton } from "../components/Modal";
import { SketchDoc, ctx2d, drawShape, floodFill, makeCanvas, rgbToHex, type Rect, type ShapeKind } from "./engine";
import { NewCanvasDialog } from "./SketchHome";
import {
  forgetSketch, isUnsavedSketch, markSketchDirty, pickImage, pickSketchSavePath, readImageFile, refreshSketches, sketchTitle, touchRecentSketch,
  untitledSketch, useSketch, writeImageFile,
} from "./store";

type Tool = "select" | "pencil" | "brush" | "marker" | "airbrush" | "eraser" | "fill" | "picker" | "text" | "hand" | ShapeKind;
type Pt = { x: number; y: number };
type Floating = { canvas: HTMLCanvasElement; x: number; y: number };

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
const TOOL_KEYS: Record<string, Tool> = { s: "select", p: "pencil", b: "brush", e: "eraser", g: "fill", i: "picker", t: "text", h: "hand", l: "line", u: "rect" };

type Status = "loading" | "saved" | "saving" | "unsaved" | "error";

/** Oceanic Sketch editor: layers, tools, history, real PNG/JPG files. */
export function SketchEditor({ path, onOpen, onSavedAs, onHome, onClose }: { path: string; onOpen: (p: string) => void; onSavedAs: (p: string) => void; onHome: () => void; onClose: () => void }) {
  const { layout } = useSketch();
  const docRef = useRef<SketchDoc | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [status, setStatus] = useState<Status>("loading");
  const [tool, setToolState] = useState<Tool>("brush");
  const [size, setSize] = useState(6);
  const [color1, setColor1] = useState("#000000");
  const [color2, setColor2] = useState("#ffffff");
  const [shapeMode, setShapeMode] = useState<"outline" | "fill" | "both">("outline");
  const [fontSize, setFontSize] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [text, setText] = useState<{ at: Pt; value: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Focus the new text box once it's in the page (autoFocus loses to the canvas click).
  useEffect(() => {
    if (text) textRef.current?.focus();
  }, [text?.at.x, text?.at.y]);
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
      const blob = await new Promise<Blob | null>((r) => d.flatten(jpg).toBlob(r, jpg ? "image/jpeg" : "image/png", 0.92));
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
  const edit = (fn: (d: SketchDoc) => void) => {
    const d = docRef.current;
    if (!d) return;
    commitFloating();
    d.checkpoint();
    fn(d);
    changed();
  };

  /* ------------------------------------------------------------ selection / clipboard */
  const commitFloating = (f = floating) => {
    const d = docRef.current;
    if (!f || !d) return;
    d.ctx.drawImage(f.canvas, Math.round(f.x), Math.round(f.y));
    setFloating(null);
    setSelection({ x: Math.round(f.x), y: Math.round(f.y), w: f.canvas.width, h: f.canvas.height });
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
    setFloating({ canvas: c, x: 0, y: 0 });
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
    commitText();
    if (t !== "select") setSelection(null);
    if (t !== "picker") prevTool.current = t;
    setToolState(t);
  };

  /* ------------------------------------------------------------ text */
  const commitText = () => {
    const d = docRef.current;
    if (!text || !d || !text.value.trim()) return setText(null);
    d.checkpoint();
    const g = d.ctx;
    g.fillStyle = color1;
    g.font = `${fontSize}px Inter, "Segoe UI", sans-serif`;
    g.textBaseline = "top";
    text.value.split("\n").forEach((line, i) => g.fillText(line, text.at.x, text.at.y + i * fontSize * 1.25));
    setText(null);
    changed();
  };

  /* ------------------------------------------------------------ pointer */
  const drag = useRef<{ start: Pt; last: Pt; button: number; color: string; moveSel?: Pt; resize?: boolean; pan?: Pt; spray?: number } | null>(null);
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
    if (!d || (e.button !== 0 && e.button !== 2 && e.button !== 1)) return;
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
      if (text) return commitText();
      return setText({ at: p, value: "" });
    }
    if (tool === "select") {
      if (floating && inRect(p, { x: floating.x, y: floating.y, w: floating.canvas.width, h: floating.canvas.height })) {
        drag.current = { start: p, last: p, button: 0, color, moveSel: { x: floating.x, y: floating.y } };
        return;
      }
      if (selection && inRect(p, selection)) {
        // Lift the selection into a floating piece and move it.
        d.checkpoint();
        const c = selCanvas(selection);
        clearRect(d, selection);
        setFloating({ canvas: c, x: selection.x, y: selection.y });
        drag.current = { start: p, last: p, button: 0, color, moveSel: { x: selection.x, y: selection.y } };
        return;
      }
      commitFloating();
      setSelection(null);
      drag.current = { start: p, last: p, button: 0, color };
      return;
    }
    d.checkpoint();
    drag.current = { start: p, last: p, button: e.button, color };
    if (tool === "airbrush") {
      spray(p, color);
      drag.current.spray = window.setInterval(() => drag.current && spray(drag.current.last, color), 30);
    } else if (["pencil", "brush", "eraser"].includes(tool)) dot(p, color);
    else if (tool === "marker") stroke(p, p, color, ctx2d(overlay.current));
    rerender();
  };
  const dot = (p: Pt, color: string) => {
    const d = docRef.current!;
    if (tool === "eraser") return erase(p, p);
    stroke(p, p, color, d.ctx);
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
    if (!st || !d) return;
    if (st.pan) {
      viewRef.current!.scrollBy(st.pan.x - e.clientX, st.pan.y - e.clientY);
      st.pan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (st.resize) {
      setSelection({ x: 0, y: 0, w: Math.max(1, Math.round(p.x)), h: Math.max(1, Math.round(p.y)) });
      return;
    }
    if (tool === "select") {
      if (st.moveSel && floating) setFloating({ ...floating, x: st.moveSel.x + p.x - st.start.x, y: st.moveSel.y + p.y - st.start.y });
      else if (!st.moveSel) {
        const x = Math.max(0, Math.min(st.start.x, p.x));
        const y = Math.max(0, Math.min(st.start.y, p.y));
        setSelection({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(d.w, Math.max(st.start.x, p.x)) - x), h: Math.round(Math.min(d.h, Math.max(st.start.y, p.y)) - y) });
      }
      return;
    }
    const og = ctx2d(overlay.current);
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
    if (tool === "marker") stroke(st.last, p, st.color, og);
    else if (tool === "eraser") erase(st.last, p);
    else if (tool === "pencil" || tool === "brush") stroke(st.last, p, st.color, d.ctx);
    st.last = p;
  };

  const onUp = () => {
    const st = drag.current;
    const d = docRef.current;
    drag.current = null;
    if (!st || !d) return;
    if (st.spray) window.clearInterval(st.spray);
    if (st.pan) return;
    if (st.resize && selection) {
      const r = selection;
      setSelection(null);
      return edit((doc) => doc.resizeCanvas(r.w, r.h));
    }
    if (tool === "select") {
      if (st.moveSel && floating) changed();
      return;
    }
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
      if (mod && k === "s") return handled(), void save();
      if (mod && k === "n") return handled(), setDialog("new");
      if (mod && k === "o") return handled(), void pickImage().then((p) => p && onOpen(p));
      if (mod && k === "c") return handled(), void copySel();
      if (mod && k === "x") return handled(), void cutSel();
      if (mod && k === "a") return handled(), setTool("select"), setSelection({ x: 0, y: 0, w: d.w, h: d.h });
      if (mod && (k === "=" || k === "+")) return handled(), setZoom((z) => Math.min(8, z * 1.25));
      if (mod && k === "-") return handled(), setZoom((z) => Math.max(0.05, z / 1.25));
      if (mod && k === "0") return handled(), fitZoom();
      if (k === "delete") return handled(), deleteSel();
      if (k === "escape") return commitFloating(), setSelection(null), setText(null);
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
    const blob = await new Promise<Blob | null>((r) => docRef.current!.flatten().toBlob(r, "image/png"));
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
      <input type="range" min={1} max={100} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-[var(--oc-sketch)]" />
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
  const optionsFor = SHAPE_KINDS.includes(tool) ? shapeStyle : tool === "text" ? (
    <label className="flex items-center gap-2 text-[12px] text-neutral-400">Text size
      <input type="number" min={6} max={300} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="h-7 w-16 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-neutral-100 outline-none" />
    </label>
  ) : null;

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
            style={{ imageRendering: zoom > 2 ? "pixelated" : "auto" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          {/* Selection marquee + floating piece */}
          {floating && (
            <canvas
              ref={(c) => {
                if (c && (c.width !== floating.canvas.width || c.height !== floating.canvas.height || !c.dataset.drawn)) {
                  c.width = floating.canvas.width;
                  c.height = floating.canvas.height;
                  ctx2d(c).drawImage(floating.canvas, 0, 0);
                  c.dataset.drawn = "1";
                }
              }}
              className="oc-marquee pointer-events-none absolute"
              style={{ left: floating.x * zoom, top: floating.y * zoom, width: floating.canvas.width * zoom, height: floating.canvas.height * zoom }}
            />
          )}
          {selection && !floating && (
            <div className="oc-marquee pointer-events-none absolute" style={{ left: selection.x * zoom, top: selection.y * zoom, width: selection.w * zoom, height: selection.h * zoom }} />
          )}
          {text && (
            <textarea
              ref={textRef}
              value={text.value}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setText(null);
                if (e.key === "Enter" && e.ctrlKey) commitText();
              }}
              className="absolute min-w-[120px] resize border border-dashed border-[color:var(--oc-sketch)] bg-transparent p-0 outline-none"
              style={{ left: text.at.x * zoom, top: text.at.y * zoom, font: `${fontSize * zoom}px Inter, "Segoe UI", sans-serif`, color: color1, lineHeight: 1.25 }}
              placeholder="Type, then click outside"
            />
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
      <span className="tabular-nums">{selection ? `${selection.w} × ${selection.h}px selected` : ""}</span>
      <span className="tabular-nums">{doc.w} × {doc.h}px</span>
      <span className="flex-1" />
      <button type="button" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))} className="cursor-pointer hover:text-white"><Minus className="size-3.5" /></button>
      <input type="range" min={5} max={800} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-32 accent-[var(--oc-sketch)]" />
      <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} className="cursor-pointer hover:text-white"><Plus className="size-3.5" /></button>
      <button type="button" data-tip="Fit (Ctrl+0)" onClick={fitZoom} className="w-12 cursor-pointer text-right hover:text-white">{Math.round(zoom * 100)}%</button>
    </div>
  );

  return (
    <div className="oc-sketch relative flex h-full flex-col" onMouseDown={(e) => text && !(e.target as HTMLElement).closest("textarea") && !stackRef.current?.contains(e.target as Node) && commitText()}>
      {titleStrip}
      {layout === "paint" ? (
        <>
          {/* Paint (Windows 11): one toolbar row of labelled groups */}
          <div className="oc-docs-chrome oc-docs-enter flex shrink-0 items-stretch gap-1 overflow-x-auto px-2 pb-2">
            <Group label="Clipboard">{clipboard}</Group>
            <Group label="Image">{imageTools}</Group>
            <Group label="Tools"><div className="grid grid-cols-5 gap-0.5">{drawTools}</div></Group>
            <Group label="Shapes"><div className="grid grid-cols-6 gap-0.5">{shapeTools}</div>{shapeStyle}</Group>
            <Group label="Size">{sizeCtl}</Group>
            {tool === "text" && <Group label="Text">{optionsFor}</Group>}
            <Group label="Colours">{colours}</Group>
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
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-between rounded-lg bg-[var(--oc-raised)] px-2 pt-1.5">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <span className="py-0.5 text-center text-[10.5px] text-neutral-500">{label}</span>
    </div>
  );
}
function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded-md border border-white/[0.08] p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`h-6 cursor-pointer rounded px-2 text-[11.5px] ${value === v ? "bg-[color:var(--oc-sketch)]/20 text-[color:var(--oc-sketch-light)]" : "text-neutral-400 hover:text-neutral-200"}`}>
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
        <input type="range" min={0} max={100} value={Math.round(doc.layer.opacity * 100)} onChange={(e) => onOpacity(Number(e.target.value) / 100)} className="flex-1 accent-[var(--oc-sketch)]" />
        <span className="w-8 text-right tabular-nums">{Math.round(doc.layer.opacity * 100)}%</span>
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

