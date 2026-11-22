import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowUpRight, Check, Circle, Copy, Crop, Download, Droplets, Eraser, Hand, Hash, Highlighter, ImageIcon, Maximize, Minus, Pencil, Plus, Redo2, Square, Type, Undo2, X,
} from "lucide-react";
import { api } from "../data/api";
import { uploadFile } from "../editor/audio";
import { copyImageToClipboard } from "../lib/clipboard";
import { save as saveDialog } from "../lib/dialog";

/**
 * Picture annotation for images in notes. Marks are drawn onto the image and
 * saved as a new picture (so copy/paste carries them), while the original and
 * the editable marks are kept so "Annotate" can reopen and change them.
 */
type Pt = { x: number; y: number };
type Mark =
  | { kind: "pen" | "highlight"; pts: Pt[]; color: string; size: number }
  | { kind: "line" | "arrow" | "rect" | "ellipse"; a: Pt; b: Pt; color: string; size: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number }
  | { kind: "callout"; at: Pt; n: number; color: string; size: number }
  | { kind: "blur"; a: Pt; b: Pt };
type Tool = "pen" | "highlight" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text" | "callout" | "blur" | "crop";
type Saved = { original: string; marks: Mark[]; crop: { a: Pt; b: Pt } | null };

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#111111"];
const key = (url: string) => `imgAnn:${url}`;

/** Draw marks (in image pixels) onto a context. */
function render(g: CanvasRenderingContext2D, img: HTMLImageElement, marks: Mark[]) {
  g.drawImage(img, 0, 0);
  for (const m of marks) {
    g.save();
    if (m.kind === "blur") {
      const x = Math.min(m.a.x, m.b.x), y = Math.min(m.a.y, m.b.y), w = Math.abs(m.b.x - m.a.x), h = Math.abs(m.b.y - m.a.y);
      if (w > 2 && h > 2) {
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.filter = `blur(${Math.max(6, Math.min(w, h) / 12)}px)`;
        g.drawImage(img, 0, 0);
      }
      g.restore();
      continue;
    }
    g.strokeStyle = g.fillStyle = m.color;
    g.lineWidth = m.size;
    g.lineCap = g.lineJoin = "round";
    if (m.kind === "pen" || m.kind === "highlight") {
      if (m.kind === "highlight") (g.globalAlpha = 0.35), (g.lineWidth = m.size * 4), (g.lineCap = "square");
      g.beginPath();
      m.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    } else if (m.kind === "text") {
      g.font = `600 ${m.size * 6}px Inter, "Segoe UI", sans-serif`;
      g.textBaseline = "top";
      m.text.split("\n").forEach((l, i) => g.fillText(l, m.at.x, m.at.y + i * m.size * 7.5));
    } else if (m.kind === "callout") {
      const r = m.size * 4;
      g.beginPath();
      g.arc(m.at.x, m.at.y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = m.color === "#ffffff" ? "#111" : "#fff";
      g.font = `700 ${r * 1.1}px Inter, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(m.n), m.at.x, m.at.y + 1);
    } else {
      const { a, b } = m as Extract<Mark, { a: Pt }>;
      g.beginPath();
      if (m.kind === "line" || m.kind === "arrow") {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        if (m.kind === "arrow") {
          const ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.max(12, m.size * 4);
          g.moveTo(b.x, b.y);
          g.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
          g.moveTo(b.x, b.y);
          g.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
        }
      } else if (m.kind === "rect") g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      else g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
}

/** Rough hit test for the eraser (removes whole marks). */
function hits(m: Mark, p: Pt, r: number) {
  const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y) < r;
  if (m.kind === "pen" || m.kind === "highlight") return m.pts.some(near);
  if (m.kind === "text" || m.kind === "callout") return near(m.at) || (m.kind === "text" && p.x >= m.at.x && p.y >= m.at.y && p.y <= m.at.y + m.size * 8 && p.x <= m.at.x + m.text.length * m.size * 3.5);
  const { a, b } = m as Extract<Mark, { a: Pt }>;
  const x0 = Math.min(a.x, b.x) - r, x1 = Math.max(a.x, b.x) + r, y0 = Math.min(a.y, b.y) - r, y1 = Math.max(a.y, b.y) + r;
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
}


/** Tool buttons for the floating bar: [tool, icon, label, shortcut key], grouped. */
const GROUPS: [Tool, ReactNode, string, string][][] = [
  [["pen", <Pencil />, "Pen", "P"], ["highlight", <Highlighter />, "Highlighter", "H"], ["eraser", <Eraser />, "Eraser (click a mark)", "E"]],
  [["arrow", <ArrowUpRight />, "Arrow", "A"], ["line", <Minus />, "Line", "L"], ["rect", <Square />, "Rectangle", "R"], ["ellipse", <Circle />, "Ellipse", "O"]],
  [["text", <Type />, "Text", "T"], ["callout", <Hash />, "Numbered callout", "N"]],
  [["blur", <Droplets />, "Blur area", "B"], ["crop", <Crop />, "Crop", "C"]],
];
const SHORTCUT = new Map(GROUPS.flat().map(([t, , , k]) => [k.toLowerCase(), t]));
const MAX_ZOOM = 8;

/**
 * Image viewer + annotator. Opens in View mode (zoom, pan, copy, save as) unless `edit`;
 * Annotate or a tool key switches to drawing.
 */
export function ImageAnnotator({ url, name, edit = false, readOnly = false, onSave, onClose }: { url: string; name?: string; edit?: boolean; /** View only: no Annotate. */ readOnly?: boolean; onSave: (newUrl: string) => void; onClose: () => void }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redo, setRedo] = useState<Mark[][]>([]);
  const [history, setHistory] = useState<Mark[][]>([]);
  const [crop, setCrop] = useState<{ a: Pt; b: Pt } | null>(null);
  /** null = View mode (hand: drag pans). */
  const [tool, setTool] = useState<Tool | null>(edit ? "pen" : null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [cropDraft, setCropDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [typing, setTyping] = useState<{ at: Pt; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = fit to window
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [space, setSpace] = useState(false);
  const [style, setStyle] = useState(false); // color/size popover
  const [confirm, setConfirm] = useState(false); // discard unsaved marks?
  const [toast, setToast] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; pan: Pt } | null>(null);
  const editing = tool !== null;

  // Reopen: an annotated picture remembers its original + marks.
  useEffect(() => {
    (async () => {
      const stored = await api.getSettings().then((s) => s[key(url)]).catch(() => undefined);
      const info: Saved = stored ? JSON.parse(stored) : { original: url, marks: [], crop: null };
      setSaved(info);
      setMarks(info.marks);
      setCrop(info.crop);
      // Load through a blob URL so the canvas isn't "tainted" and can be saved.
      const el = new Image();
      el.onload = () => setImg(el);
      el.src = await fetch(info.original)
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b))
        .catch(() => info.original);
    })();
  }, [url]);

  const all = draft ? [...marks, draft] : marks;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    render(c.getContext("2d")!, img, all);
  });

  const dirty = history.length > 0 || JSON.stringify(crop) !== JSON.stringify(saved?.crop ?? null);
  const close = () => (dirty ? setConfirm(true) : onClose());
  const flash = (t: string) => (setToast(t), setTimeout(() => setToast(""), 1600));

  /* ------------------------------------------------------------ zoom & pan */
  /** Layout width of the fitted image (before zoom), for % and overlay positions. */
  const fitW = () => canvas.current?.offsetWidth || 1;
  const pct = img ? Math.round(((zoom * fitW()) / img.naturalWidth) * 100) : 100;
  /** Zoom to `z`, keeping the screen point `at` (default: center) still. */
  const zoomTo = (z: number, at?: Pt) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const r = stage.current?.getBoundingClientRect();
    if (!r) return;
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const m = at ?? c;
    const k = next / zoom;
    setPan(next === 1 ? { x: 0, y: 0 } : { x: m.x - c.x - k * (m.x - c.x - pan.x), y: m.y - c.y - k * (m.y - c.y - pan.y) });
    setZoom(next);
  };
  const actual = () => (img ? img.naturalWidth / fitW() : 1); // zoom for 100%
  // Wheel: Ctrl/pinch zooms (also plain wheel in View mode). Native listener so preventDefault works.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && editing) return;
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /* ------------------------------------------------------------- keyboard */
  const undo = () => history.length && (setRedo((r) => [...r, marks]), setMarks(history.at(-1)!), setHistory((h) => h.slice(0, -1)));
  const redoStep = () => redo.length && (setHistory((h) => [...h, marks]), setMarks(redo.at(-1)!), setRedo((r) => r.slice(0, -1)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      const stop = () => (e.preventDefault(), e.stopPropagation());
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && !e.shiftKey && editing) (stop(), undo());
        else if ((k === "y" || (k === "z" && e.shiftKey)) && editing) (stop(), redoStep());
        else if (k === "s" && editing) (stop(), void save());
        else if (k === "0") (stop(), zoomTo(1));
        return;
      }
      if (k === "escape") {
        stop();
        if (confirm) setConfirm(false);
        else if (style) setStyle(false);
        else close();
      } else if (k === " " && !space) (stop(), setSpace(true));
      else if (k === "v") setTool(null);
      else if (SHORTCUT.has(k) && !readOnly) setTool(SHORTCUT.get(k)!);
      else if (k === "+" || k === "=") zoomTo(zoom * 1.25);
      else if (k === "-") zoomTo(zoom / 1.25);
    };
    const onUp = (e: KeyboardEvent) => e.key === " " && setSpace(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    return () => (window.removeEventListener("keydown", onKey, true), window.removeEventListener("keyup", onUp, true));
  });

  /* -------------------------------------------------------------- drawing */
  const commit = (next: Mark[]) => (setHistory((h) => [...h, marks]), setRedo([]), setMarks(next));
  const toImg = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * img!.naturalWidth, y: ((e.clientY - r.top) / r.height) * img!.naturalHeight };
  };
  const scale = () => (img ? img.naturalWidth / canvas.current!.getBoundingClientRect().width : 1);

  const down = (e: React.PointerEvent) => {
    if (!img) return;
    setStyle(false);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!editing || space || e.button === 1) return void (panning.current = { x: e.clientX, y: e.clientY, pan });
    if (e.button !== 0) return;
    const p = toImg(e);
    const s = size * scale();
    if (tool === "eraser") return void commit(marks.filter((m) => !hits(m, p, 12 * scale())));
    if (tool === "text") return setTyping({ at: p, text: "" });
    if (tool === "callout") return commit([...marks, { kind: "callout", at: p, n: marks.filter((m) => m.kind === "callout").length + 1, color, size: s }]);
    if (tool === "crop") return setCropDraft({ a: p, b: p });
    if (tool === "pen" || tool === "highlight") return setDraft({ kind: tool, pts: [p], color, size: s });
    if (tool === "blur") return setDraft({ kind: "blur", a: p, b: p });
    setDraft({ kind: tool, a: p, b: p, color, size: s });
  };
  const move = (e: React.PointerEvent) => {
    if (!img) return;
    const g = panning.current;
    if (g) return setPan({ x: g.pan.x + e.clientX - g.x, y: g.pan.y + e.clientY - g.y });
    const p = toImg(e);
    if (cropDraft) return setCropDraft({ ...cropDraft, b: p });
    if (!draft) return;
    if (draft.kind === "pen" || draft.kind === "highlight") setDraft({ ...draft, pts: [...draft.pts, p] });
    else if ("b" in draft) setDraft({ ...draft, b: p });
  };
  const up = () => {
    panning.current = null;
    if (cropDraft) {
      if (Math.abs(cropDraft.b.x - cropDraft.a.x) > 8 && Math.abs(cropDraft.b.y - cropDraft.a.y) > 8) setCrop(cropDraft);
      setCropDraft(null);
    }
    if (draft) (commit([...marks, draft]), setDraft(null));
  };

  /* ---------------------------------------------------------------- output */
  /** The picture with marks and crop applied, as PNG. */
  const flatten = async () => {
    const full = document.createElement("canvas");
    full.width = img!.naturalWidth;
    full.height = img!.naturalHeight;
    render(full.getContext("2d")!, img!, marks);
    let out = full;
    if (crop) {
      const x = Math.round(Math.min(crop.a.x, crop.b.x)), y = Math.round(Math.min(crop.a.y, crop.b.y));
      const w = Math.round(Math.abs(crop.b.x - crop.a.x)), h = Math.round(Math.abs(crop.b.y - crop.a.y));
      out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      out.getContext("2d")!.drawImage(full, -x, -y);
    }
    return (await new Promise<Blob | null>((r) => out.toBlob(r, "image/png")))!;
  };
  const save = async () => {
    if (!img || !saved || busy) return;
    setBusy(true);
    try {
      const newUrl = await uploadFile(new File([await flatten()], "annotated.png", { type: "image/png" }));
      await api.setSetting(key(newUrl), JSON.stringify({ original: saved.original, marks, crop } satisfies Saved));
      onSave(newUrl);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await copyImageToClipboard(URL.createObjectURL(await flatten()));
      flash("Copied");
    } catch {
      flash("Couldn't copy");
    }
  };
  const saveAs = async () => {
    const blob = await flatten();
    const file = `${(name || "image").replace(/\.[a-z0-9]+$/i, "")}.png`;
    if (!isTauri()) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file;
      return a.click();
    }
    const path = await saveDialog({ defaultPath: file, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    await invoke("write_export_file", { path, data: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    flash("Saved");
  };

  /* -------------------------------------------------------------------- ui */
  const k = img ? fitW() / img.naturalWidth : 1; // image px → layout px (inside the zoomed wrapper)
  const box = (c: { a: Pt; b: Pt }, cls: string) =>
    img && <div className={`pointer-events-none absolute ${cls}`} style={{ left: Math.min(c.a.x, c.b.x) * k, top: Math.min(c.a.y, c.b.y) * k, width: Math.abs(c.b.x - c.a.x) * k, height: Math.abs(c.b.y - c.a.y) * k }} />;
  const Icon = ({ title, onClick, disabled, children, on }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode; on?: boolean }) => (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`grid size-8 cursor-pointer place-items-center rounded-lg transition-colors [&_svg]:size-[17px] disabled:cursor-default disabled:opacity-30 ${on ? "bg-sky-500/20 text-sky-300" : "text-neutral-300 hover:bg-white/[0.08] hover:text-white"}`}>
      {children}
    </button>
  );
  const cursor = panning.current ? "cursor-grabbing" : !editing || space ? "cursor-grab" : tool === "eraser" ? "cursor-cell" : tool === "text" ? "cursor-text" : "cursor-crosshair";

  return createPortal(
    <div className="oc-fade-in fixed inset-0 z-[90] flex flex-col bg-neutral-950/85 backdrop-blur-xl">
      {/* Top bar: what this is on the left, actions on the right. */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-neutral-300"><ImageIcon className="size-4" /></span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-medium text-neutral-100">{name || "Image"}</p>
            <p className="text-[11px] text-neutral-500">{img ? `${img.naturalWidth} × ${img.naturalHeight}` : "Loading…"}{editing ? " · Annotating" : ""}</p>
          </div>
        </div>
        <span className="flex-1" />
        {editing ? (
          <>
            <Icon title="Undo (Ctrl+Z)" disabled={!history.length} onClick={undo}><Undo2 /></Icon>
            <Icon title="Redo (Ctrl+Y)" disabled={!redo.length} onClick={redoStep}><Redo2 /></Icon>
            {(marks.length > 0 || crop) && (
              <button type="button" onClick={() => (commit([]), setCrop(null))} className="h-8 cursor-pointer rounded-lg px-2.5 text-[13px] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-200">Clear all</button>
            )}
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button type="button" onClick={close} className="h-8 cursor-pointer rounded-lg px-3 text-[13px] text-neutral-300 hover:bg-white/[0.08]">Cancel</button>
            <button type="button" disabled={busy || !img || !dirty} onClick={() => void save()} title="Save (Ctrl+S)" className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 text-[13px] font-medium text-white shadow-sm hover:bg-sky-500 disabled:cursor-default disabled:opacity-40">
              <Check className="size-4" /> {busy ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <>
            <Icon title="Copy image" disabled={!img} onClick={() => void copy()}><Copy /></Icon>
            <Icon title="Save as…" disabled={!img} onClick={() => void saveAs()}><Download /></Icon>
            {!readOnly && <button type="button" disabled={!img} onClick={() => setTool("pen")} title="Annotate (P)" className="ml-1 flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-[13px] font-medium text-neutral-100 hover:bg-white/[0.14] disabled:opacity-40">
              <Pencil className="size-4" /> Annotate
            </button>}
            <span className="mx-1 h-5 w-px bg-white/10" />
            <Icon title="Close (Esc)" onClick={close}><X /></Icon>
          </>
        )}
      </div>

      {/* Stage */}
      <div ref={stage} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden px-8 pb-24 pt-2">
        {!img ? (
          <p className="text-[13px] text-neutral-400">Loading picture…</p>
        ) : (
          <div className="relative" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: panning.current ? "none" : "transform 120ms ease-out" }}>
            <canvas
              ref={canvas}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onDoubleClick={() => !editing && (zoom > 1.01 ? zoomTo(1) : zoomTo(actual()))}
              className={`block max-h-[calc(100vh-170px)] max-w-[calc(100vw-64px)] rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10 ${cursor}`}
            />
            {crop && box(crop, "outline outline-2 outline-dashed outline-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]")}
            {cropDraft && box(cropDraft, "outline outline-2 outline-dashed outline-sky-300")}
            {typing && (
              <textarea
                autoFocus
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onBlur={() => (typing.text.trim() && commit([...marks, { kind: "text", at: typing.at, text: typing.text, color, size: size * scale() }]), setTyping(null))}
                onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setTyping(null))}
                placeholder="Type, then click away"
                className="absolute min-w-40 resize rounded border border-dashed border-sky-400 bg-black/40 p-1 text-white outline-none"
                style={{ left: typing.at.x * k, top: typing.at.y * k, color, font: `600 ${size * scale() * 6 * k}px Inter, sans-serif` }}
              />
            )}
          </div>
        )}

        {/* Zoom pill (bottom right) */}
        {img && (
          <div className="absolute bottom-5 right-5 flex items-center gap-0.5 rounded-xl border border-white/10 bg-neutral-900/80 p-1 shadow-lg backdrop-blur">
            <Icon title="Zoom out (−)" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.25)}><Minus /></Icon>
            <button type="button" title="Actual size" onClick={() => zoomTo(actual())} className="h-8 min-w-12 cursor-pointer rounded-lg px-1 text-[12px] tabular-nums text-neutral-300 hover:bg-white/[0.08]">{pct}%</button>
            <Icon title="Zoom in (+)" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * 1.25)}><Plus /></Icon>
            <Icon title="Fit to window (Ctrl+0)" disabled={zoom === 1} onClick={() => zoomTo(1)}><Maximize /></Icon>
          </div>
        )}

        {/* Floating tool bar (Annotate mode) */}
        {editing && img && (
          <div className="oc-fade-in absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/85 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <Icon title="Move (V, or hold Space)" on={tool === null} onClick={() => setTool(null)}><Hand /></Icon>
            {GROUPS.map((g, i) => (
              <div key={i} className="flex items-center gap-0.5 border-l border-white/10 pl-1">
                {g.map(([t, icon, label, key]) => (
                  <Icon key={t} title={`${label} (${key})`} on={tool === t} onClick={() => setTool(t)}>{icon}</Icon>
                ))}
              </div>
            ))}
            <div className="relative border-l border-white/10 pl-1.5">
              <button type="button" title="Color and size" onClick={() => setStyle(!style)} className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 transition-colors ${style ? "bg-white/[0.1]" : "hover:bg-white/[0.08]"}`}>
                <span className="size-[18px] rounded-full ring-2 ring-white/25" style={{ background: color }} />
                <span className="grid w-4 place-items-center"><span className="rounded-full bg-neutral-200" style={{ width: 3 + size * 0.6, height: 3 + size * 0.6 }} /></span>
              </button>
              {style && (
                <div className="oc-fade-in absolute bottom-[calc(100%+12px)] right-0 w-60 rounded-xl border border-white/10 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-xl">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Color</p>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button key={c} type="button" title={c} onClick={() => setColor(c)} className={`size-7 cursor-pointer rounded-full ring-1 ring-white/20 transition-transform hover:scale-110 ${color === c ? "outline outline-2 outline-offset-2 outline-sky-400" : ""}`} style={{ background: c }} />
                    ))}
                    <label title="Custom color" className={`relative size-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-white/20 transition-transform hover:scale-110 ${COLORS.includes(color) ? "" : "outline outline-2 outline-offset-2 outline-sky-400"}`} style={{ background: COLORS.includes(color) ? "conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)" : color }}>
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                    </label>
                  </div>
                  <div className="mb-2 mt-4 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                    <span>Size</span>
                    <span className="tabular-nums normal-case text-neutral-300">{size}px</span>
                  </div>
                  <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} className="oc-range w-full" style={{ ["--oc-range-fill" as string]: `${((size - 1) / 19) * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {crop && editing && <p className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] text-neutral-300">The dashed area is kept when you save. Clear all removes the crop.</p>}
        {toast && <p className="oc-fade-in absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-[12px] font-medium text-neutral-900 shadow">{toast}</p>}

        {/* Unsaved-changes warning */}
        {confirm && (
          <div className="oc-fade-in absolute inset-0 grid place-items-center bg-black/50">
            <div className="w-80 rounded-xl border border-white/10 bg-neutral-900 p-4 shadow-2xl">
              <p className="text-[14px] font-medium text-neutral-100">Discard your changes?</p>
              <p className="mt-1 text-[13px] text-neutral-400">Your marks on this picture haven't been saved.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" autoFocus onClick={() => setConfirm(false)} className="h-8 cursor-pointer rounded-lg px-3 text-[13px] text-neutral-300 hover:bg-white/[0.08]">Keep editing</button>
                <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-lg bg-red-600 px-3 text-[13px] font-medium text-white hover:bg-red-500">Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
