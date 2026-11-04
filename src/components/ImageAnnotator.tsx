import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight, Check, Circle, Crop, Droplets, Eraser, Hash, Highlighter, Minus, Pencil, Redo2, Square, Type, Undo2, X,
} from "lucide-react";
import { api } from "../data/api";
import { uploadFile } from "../editor/audio";

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

export function ImageAnnotator({ url, onSave, onClose }: { url: string; onSave: (newUrl: string) => void; onClose: () => void }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redo, setRedo] = useState<Mark[][]>([]);
  const [history, setHistory] = useState<Mark[][]>([]);
  const [crop, setCrop] = useState<{ a: Pt; b: Pt } | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [cropDraft, setCropDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [typing, setTyping] = useState<{ at: Pt; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

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

  const undo = () => history.length && (setRedo((r) => [...r, marks]), setMarks(history.at(-1)!), setHistory((h) => h.slice(0, -1)));
  const redoStep = () => redo.length && (setHistory((h) => [...h, marks]), setMarks(redo.at(-1)!), setRedo((r) => r.slice(0, -1)));
  // Ctrl+Z undo · Ctrl+Y / Ctrl+Shift+Z redo (not while typing a text mark).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) (e.preventDefault(), e.stopPropagation(), undo());
      else if (k === "y" || (k === "z" && e.shiftKey)) (e.preventDefault(), e.stopPropagation(), redoStep());
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const commit = (next: Mark[]) => (setHistory((h) => [...h, marks]), setRedo([]), setMarks(next));
  const toImg = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * img!.naturalWidth, y: ((e.clientY - r.top) / r.height) * img!.naturalHeight };
  };
  const scale = () => (img ? img.naturalWidth / canvas.current!.getBoundingClientRect().width : 1);

  const down = (e: React.PointerEvent) => {
    if (!img || e.button !== 0) return;
    const p = toImg(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
    const p = toImg(e);
    if (cropDraft) return setCropDraft({ ...cropDraft, b: p });
    if (!draft) return;
    if (draft.kind === "pen" || draft.kind === "highlight") setDraft({ ...draft, pts: [...draft.pts, p] });
    else if ("b" in draft) setDraft({ ...draft, b: p });
  };
  const up = () => {
    if (cropDraft) {
      if (Math.abs(cropDraft.b.x - cropDraft.a.x) > 8 && Math.abs(cropDraft.b.y - cropDraft.a.y) > 8) setCrop(cropDraft);
      setCropDraft(null);
    }
    if (draft) (commit([...marks, draft]), setDraft(null));
  };

  const save = async () => {
    if (!img || !saved) return;
    setBusy(true);
    try {
      const full = document.createElement("canvas");
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      render(full.getContext("2d")!, img, marks);
      let out = full;
      if (crop) {
        const x = Math.round(Math.min(crop.a.x, crop.b.x)), y = Math.round(Math.min(crop.a.y, crop.b.y));
        const w = Math.round(Math.abs(crop.b.x - crop.a.x)), h = Math.round(Math.abs(crop.b.y - crop.a.y));
        out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        out.getContext("2d")!.drawImage(full, -x, -y);
      }
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      const newUrl = await uploadFile(new File([blob!], "annotated.png", { type: "image/png" }));
      await api.setSetting(key(newUrl), JSON.stringify({ original: saved.original, marks, crop } satisfies Saved));
      onSave(newUrl);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const B = ({ t, icon, label }: { t: Tool; icon: ReactNode; label: string }) => (
    <button type="button" title={label} onClick={() => setTool(t)} className={`grid size-9 cursor-pointer place-items-center rounded-lg transition-colors [&_svg]:size-[18px] ${tool === t ? "bg-sky-500/20 text-sky-300" : "text-neutral-300 hover:bg-white/[0.08]"}`}>
      {icon}
    </button>
  );
  const box = (c: { a: Pt; b: Pt }, cls: string) => {
    if (!img || !canvas.current) return null;
    const k = canvas.current.getBoundingClientRect().width / img.naturalWidth;
    return <div className={`pointer-events-none absolute ${cls}`} style={{ left: Math.min(c.a.x, c.b.x) * k, top: Math.min(c.a.y, c.b.y) * k, width: Math.abs(c.b.x - c.a.x) * k, height: Math.abs(c.b.y - c.a.y) * k }} />;
  };

  return createPortal(
    <div className="oc-fade-in fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.08] bg-[var(--oc-surface)] px-3">
        <B t="pen" icon={<Pencil />} label="Pen" />
        <B t="highlight" icon={<Highlighter />} label="Highlighter" />
        <B t="eraser" icon={<Eraser />} label="Eraser (click a mark)" />
        <span className="mx-1 h-6 w-px bg-white/10" />
        <B t="arrow" icon={<ArrowUpRight />} label="Arrow" />
        <B t="line" icon={<Minus />} label="Line" />
        <B t="rect" icon={<Square />} label="Rectangle" />
        <B t="ellipse" icon={<Circle />} label="Ellipse" />
        <span className="mx-1 h-6 w-px bg-white/10" />
        <B t="text" icon={<Type />} label="Text" />
        <B t="callout" icon={<Hash />} label="Numbered callout" />
        <B t="blur" icon={<Droplets />} label="Blur area" />
        <B t="crop" icon={<Crop />} label="Crop" />
        <span className="mx-1 h-6 w-px bg-white/10" />
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} className={`size-6 cursor-pointer rounded-full border border-white/20 transition-transform hover:scale-110 ${color === c ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-[var(--oc-surface)]" : ""}`} style={{ background: c }} />
        ))}
        <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} className="ml-2 w-24 accent-sky-500" title="Size" />
        <span className="flex-1" />
        <button type="button" title="Undo (Ctrl+Z)" disabled={!history.length} onClick={undo} className="grid size-9 cursor-pointer place-items-center rounded-lg text-neutral-300 hover:bg-white/[0.08] disabled:opacity-30"><Undo2 className="size-[18px]" /></button>
        <button type="button" title="Redo (Ctrl+Y)" disabled={!redo.length} onClick={redoStep} className="grid size-9 cursor-pointer place-items-center rounded-lg text-neutral-300 hover:bg-white/[0.08] disabled:opacity-30"><Redo2 className="size-[18px]" /></button>
        {(marks.length > 0 || crop) && (
          <button type="button" onClick={() => (commit([]), setCrop(null))} className="h-8 cursor-pointer rounded-md px-2.5 text-[13px] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-200">Clear all</button>
        )}
        <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-md px-3 text-[13px] text-neutral-300 hover:bg-white/[0.08]"><X className="mr-1 inline size-4" />Cancel</button>
        <button type="button" disabled={busy || !img} onClick={() => void save()} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sky-600 px-3 text-[13px] font-medium text-white hover:bg-sky-500 disabled:opacity-50">
          <Check className="size-4" /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-6">
        {!img ? (
          <p className="text-[13px] text-neutral-400">Loading picture…</p>
        ) : (
          <div className="oc-docs-pop relative" style={{ maxWidth: "100%" }}>
            <canvas
              ref={canvas}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              className={`block max-h-[calc(100vh-140px)] max-w-full rounded-md shadow-2xl ${tool === "eraser" ? "cursor-cell" : tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
            />
            {crop && box(crop, "outline outline-2 outline-dashed outline-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]")}
            {cropDraft && box(cropDraft, "outline outline-2 outline-dashed outline-sky-300")}
            {typing && canvas.current && (
              <textarea
                autoFocus
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onBlur={() => (typing.text.trim() && commit([...marks, { kind: "text", at: typing.at, text: typing.text, color, size: size * scale() }]), setTyping(null))}
                onKeyDown={(e) => e.key === "Escape" && setTyping(null)}
                placeholder="Type, then click away"
                className="absolute min-w-40 resize border border-dashed border-sky-400 bg-black/40 p-1 text-white outline-none"
                style={{
                  left: (typing.at.x / img.naturalWidth) * canvas.current.getBoundingClientRect().width,
                  top: (typing.at.y / img.naturalHeight) * canvas.current.getBoundingClientRect().height,
                  color,
                  font: `600 ${size * 6 * (canvas.current.getBoundingClientRect().width / img.naturalWidth) * scale()}px Inter, sans-serif`,
                }}
              />
            )}
          </div>
        )}
      </div>
      {crop && <p className="pb-3 text-center text-[12px] text-neutral-400">The dashed area is kept when you save. Use Clear all to undo the crop.</p>}
    </div>,
    document.body,
  );
}
