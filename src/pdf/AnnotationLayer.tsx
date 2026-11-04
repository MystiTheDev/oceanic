/* ---------------------------------------------------------------------------
 * One page's SVG annotation layer. Its viewBox is the page in PDF points, so
 * shapes are drawn straight from stored geometry at any zoom. Handles
 * selecting, moving and resizing annotations, and the drawing tools.
 * ------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from "react";
import type { PdfAnnotationKind } from "../data/api";
import { STICKY_SIZE, arrowHead, bbox, clampToPage, finishInk, inkOutline, norm, transform, type Ann, type Box } from "./annotations";
import type { Change } from "./useAnnotations";
import type { StrokePt } from "../sketch/engine";

export type Tool = "select" | "highlight" | "underline" | "strike" | "pen" | "eraser" | "rect" | "ellipse" | "line" | "arrow" | "text" | "sticky";
export const DRAW_TOOLS: Tool[] = ["pen", "eraser", "rect", "ellipse", "line", "arrow", "text", "sticky"];

type Pt = { x: number; y: number };
type Drag =
  | { mode: "move" | "resize"; corner: number; start: Pt; orig: Ann; box: Box; moved: boolean }
  | { mode: "draw"; start: Pt; points: StrokePt[] }
  | { mode: "erase" };

export type LayerProps = {
  page: number;
  size: { w: number; h: number };
  scale: number;
  docId: string;
  anns: Ann[];
  tool: Tool;
  color: string;
  width: number;
  selectedId: string | null;
  editingId: string | null;
  flashId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onPreview: (ann: Ann) => void;
  onCommit: (changes: Change[]) => void;
  onContextMenu: (ann: Ann, e: React.MouseEvent) => void;
};

const newId = () => crypto.randomUUID();

/** Keep receiving moves outside the page while dragging (best effort). */
const capture = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already released */
  }
};

/** Distance from `p` to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Visual for one annotation (no interaction). */
export function AnnShape({ a, scale, editing }: { a: Ann; scale: number; editing?: boolean }) {
  const d = a.data;
  const w = d.width ?? 2;
  switch (a.kind) {
    case "highlight":
      return (
        <g style={{ mixBlendMode: "multiply" }}>
          {d.rects?.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={1} fill={a.color} fillOpacity={0.4} />)}
        </g>
      );
    case "underline":
    case "strike":
      return (
        <g>
          {d.rects?.map((r, i) => {
            const y = r.y + r.h * (a.kind === "underline" ? 0.94 : 0.55);
            return <line key={i} x1={r.x} x2={r.x + r.w} y1={y} y2={y} stroke={a.color} strokeWidth={Math.max(0.8, r.h * 0.08)} />;
          })}
        </g>
      );
    case "ink":
      return <path d={inkOutline(d.points ?? [], w)} fill={a.color} />;
    case "rect":
      return d.box ? <rect x={d.box.x} y={d.box.y} width={d.box.w} height={d.box.h} fill="none" stroke={a.color} strokeWidth={w} /> : null;
    case "ellipse":
      return d.box ? (
        <ellipse cx={d.box.x + d.box.w / 2} cy={d.box.y + d.box.h / 2} rx={d.box.w / 2} ry={d.box.h / 2} fill="none" stroke={a.color} strokeWidth={w} />
      ) : null;
    case "line":
    case "arrow":
      return d.from && d.to ? (
        <g>
          <line x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} stroke={a.color} strokeWidth={w} strokeLinecap="round" />
          {a.kind === "arrow" && <path d={arrowHead(d.from, d.to, w)} fill={a.color} />}
        </g>
      ) : null;
    case "text":
      return d.box && !editing ? (
        <foreignObject x={d.box.x} y={d.box.y} width={d.box.w} height={d.box.h}>
          <div className="oc-pdf-textbox" style={{ color: a.color, fontSize: d.width ?? 12 }}>
            {d.text || <span className="opacity-50">Text</span>}
          </div>
        </foreignObject>
      ) : null;
    case "sticky":
      return d.box ? (
        <g transform={`translate(${d.box.x} ${d.box.y})`}>
          <path d="M2 0h14l6 6v14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" fill={a.color} stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} />
          <path d="M16 0v6h6" fill="rgba(0,0,0,0.15)" />
          <path d="M5 9h11M5 13h11M5 17h7" stroke="rgba(0,0,0,0.45)" strokeWidth={1.2} strokeLinecap="round" />
        </g>
      ) : null;
    default:
      void scale;
      return null;
  }
}

/** Fat invisible strokes so thin lines are easy to click. */
function HitArea({ a }: { a: Ann }) {
  const d = a.data;
  const fat = Math.max(8, (d.width ?? 2) + 6);
  if (a.kind === "ink") return <path d={inkOutline(d.points ?? [], d.width ?? 2)} fill="transparent" stroke="transparent" strokeWidth={fat} />;
  if ((a.kind === "line" || a.kind === "arrow") && d.from && d.to)
    return <line x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} stroke="transparent" strokeWidth={fat} />;
  if ((a.kind === "rect" || a.kind === "ellipse") && d.box) {
    const b = d.box;
    return a.kind === "rect" ? (
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="transparent" strokeWidth={fat} />
    ) : (
      <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="none" stroke="transparent" strokeWidth={fat} />
    );
  }
  if (d.rects) return <g>{d.rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" />)}</g>;
  const b = bbox(a);
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />;
}

export function AnnotationLayer(p: LayerProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraftState] = useState<Ann | null>(null);
  // Read on pointerup, which can arrive before the last move re-rendered.
  const draftRef = useRef<Ann | null>(null);
  const setDraft = (a: Ann | null) => {
    draftRef.current = a;
    setDraftState(a);
  };

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / p.scale, y: (e.clientY - r.top) / p.scale };
  };
  const drawing = p.tool !== "select" && !["highlight", "underline", "strike"].includes(p.tool);

  // A finished draft becomes a real annotation (and is selected, except ink, so the pen keeps going).
  const create = (a: Ann) => {
    p.onCommit([{ id: a.id, before: null, after: a }]);
    if (a.kind === "text" || a.kind === "sticky") (p.onSelect(a.id), p.onEdit(a.id));
  };

  const eraseAt = (pt: Pt) => {
    const r = 6 / p.scale;
    const hit = [...p.anns].reverse().find((a) => {
      if (a.kind !== "ink" && !["rect", "ellipse", "line", "arrow"].includes(a.kind)) return false;
      if (a.kind === "ink") {
        const pts = a.data.points ?? [];
        const reach = r + (a.data.width ?? 2);
        return pts.some((q, i) => segDist(pt, pts[Math.max(0, i - 1)], q) < reach);
      }
      const b = bbox(a);
      return pt.x >= b.x - r && pt.x <= b.x + b.w + r && pt.y >= b.y - r && pt.y <= b.y + b.h + r;
    });
    if (hit) p.onCommit([{ id: hit.id, before: hit, after: null }]);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !drawing) return;
    e.preventDefault();
    capture(svg.current!, e.pointerId);
    const pt = toPt(e);
    p.onSelect(null);
    if (p.tool === "eraser") {
      drag.current = { mode: "erase" };
      eraseAt(pt);
      return;
    }
    if (p.tool === "sticky") {
      const box = clampToPage({ x: pt.x - STICKY_SIZE / 2, y: pt.y - STICKY_SIZE / 2, w: STICKY_SIZE, h: STICKY_SIZE }, p.size);
      create({ id: newId(), docId: p.docId, page: p.page, kind: "sticky", color: p.color, data: { box, text: "" } });
      return;
    }
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    drag.current = { mode: "draw", start: pt, points: [{ ...pt, p: pressure }] };
  };

  const onMove = (e: React.PointerEvent) => {
    const st = drag.current;
    if (!st) return;
    const pt = toPt(e);
    if (st.mode === "erase") return eraseAt(pt);
    if (st.mode === "draw") {
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      st.points.push({ ...pt, p: pressure });
      const kind = (p.tool === "pen" ? "ink" : p.tool) as PdfAnnotationKind;
      const base = { id: "draft", docId: p.docId, page: p.page, kind, color: p.color };
      let end = pt;
      if (e.shiftKey && (kind === "line" || kind === "arrow")) {
        const ang = Math.round(Math.atan2(pt.y - st.start.y, pt.x - st.start.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(pt.x - st.start.x, pt.y - st.start.y);
        end = { x: st.start.x + Math.cos(ang) * len, y: st.start.y + Math.sin(ang) * len };
      } else if (e.shiftKey && (kind === "rect" || kind === "ellipse")) {
        const m = Math.max(Math.abs(pt.x - st.start.x), Math.abs(pt.y - st.start.y));
        end = { x: st.start.x + Math.sign(pt.x - st.start.x) * m, y: st.start.y + Math.sign(pt.y - st.start.y) * m };
      }
      const box = norm({ x: st.start.x, y: st.start.y, w: end.x - st.start.x, h: end.y - st.start.y });
      if (kind === "ink") setDraft({ ...base, data: { points: st.points, width: p.width } });
      else if (kind === "line" || kind === "arrow") setDraft({ ...base, data: { from: st.start, to: end, width: p.width } });
      else if (kind === "text") setDraft({ ...base, kind: "rect", color: "#0ea5e9", data: { box, width: 0.8 } });
      else setDraft({ ...base, data: { box, width: p.width } });
      return;
    }
    // Move / resize the selected annotation.
    const dx = pt.x - st.start.x;
    const dy = pt.y - st.start.y;
    if (!st.moved && Math.hypot(dx, dy) * p.scale < 3) return;
    st.moved = true;
    let to: Box;
    if (st.mode === "move") to = clampToPage({ ...st.box, x: st.box.x + dx, y: st.box.y + dy }, p.size);
    else {
      const b = st.box;
      // Corners: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
      const left = st.corner === 0 || st.corner === 3;
      const top = st.corner === 0 || st.corner === 1;
      const x1 = left ? Math.min(b.x + dx, b.x + b.w - 4) : b.x;
      const x2 = left ? b.x + b.w : Math.max(b.x + b.w + dx, b.x + 4);
      const y1 = top ? Math.min(b.y + dy, b.y + b.h - 4) : b.y;
      const y2 = top ? b.y + b.h : Math.max(b.y + b.h + dy, b.y + 4);
      to = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    p.onPreview(transform(st.orig, st.box, to));
  };

  const onUp = () => {
    const st = drag.current;
    drag.current = null;
    if (!st) return;
    if (st.mode === "draw") {
      const d = draftRef.current;
      setDraft(null);
      if (!d) {
        // A click with the text tool drops a default-size box.
        if (p.tool === "text") {
          const box = clampToPage({ x: st.start.x, y: st.start.y, w: 160, h: 40 }, p.size);
          create({ id: newId(), docId: p.docId, page: p.page, kind: "text", color: p.color, data: { box, text: "", width: 12 } });
        } else if (p.tool === "pen") {
          create({ id: newId(), docId: p.docId, page: p.page, kind: "ink", color: p.color, data: { points: st.points, width: p.width } });
        }
        return;
      }
      const id = newId();
      if (d.kind === "ink") create({ ...d, id, data: { ...d.data, points: finishInk(d.data.points ?? []) } });
      else if (p.tool === "text") {
        const b = d.data.box!;
        create({ id, docId: p.docId, page: p.page, kind: "text", color: p.color, data: { box: { ...b, w: Math.max(40, b.w), h: Math.max(18, b.h) }, text: "", width: 12 } });
      } else {
        const b = bbox(d);
        if (b.w * p.scale > 3 || b.h * p.scale > 3) create({ ...d, id });
      }
      return;
    }
    if (st.mode === "erase") return;
    if (st.moved) {
      const now = p.anns.find((a) => a.id === st.orig.id);
      if (now) p.onCommit([{ id: now.id, before: st.orig, after: now }]);
    }
  };

  const startDrag = (e: React.PointerEvent, a: Ann, mode: "move" | "resize", corner = 0) => {
    if (e.button !== 0 || (drawing && p.tool !== "select")) return;
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    p.onSelect(a.id);
    if (p.editingId !== a.id) p.onEdit(null);
    capture(svg.current!, e.pointerId);
    drag.current = { mode, corner, start: toPt(e), orig: a, box: bbox(a), moved: false };
  };

  // Escape a half-drawn draft if the tool changes.
  useEffect(() => setDraft(null), [p.tool]);

  const sel = p.anns.find((a) => a.id === p.selectedId);
  const handle = 7 / p.scale;
  return (
    <svg
      ref={svg}
      className={`oc-pdf-ann ${drawing ? "oc-pdf-ann-draw" : ""} ${p.tool === "eraser" ? "oc-pdf-ann-erase" : ""}`}
      viewBox={`0 0 ${p.size.w} ${p.size.h}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {p.anns.map((a) => (
        <g
          key={a.id}
          className={`oc-pdf-ann-item ${p.flashId === a.id ? "oc-pdf-flash" : ""}`}
          onPointerDown={(e) => startDrag(e, a, "move")}
          onDoubleClick={() => (a.kind === "text" || a.kind === "sticky") && p.onEdit(a.id)}
          onClick={() => a.kind === "sticky" && !drag.current && p.onEdit(a.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            p.onSelect(a.id);
            p.onContextMenu(a, e);
          }}
        >
          <AnnShape a={a} scale={p.scale} editing={p.editingId === a.id && a.kind === "text"} />
          <HitArea a={a} />
        </g>
      ))}
      {draft && <AnnShape a={draft} scale={p.scale} />}
      {sel &&
        (() => {
          const b = bbox(sel);
          const pad = 2 / p.scale;
          const corners = [
            [b.x, b.y],
            [b.x + b.w, b.y],
            [b.x + b.w, b.y + b.h],
            [b.x, b.y + b.h],
          ];
          return (
            <g className="oc-pdf-sel">
              <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" strokeWidth={1.2 / p.scale} strokeDasharray={`${4 / p.scale} ${3 / p.scale}`} />
              {sel.kind !== "sticky" &&
                corners.map(([x, y], i) => (
                  <rect
                    key={i}
                    className={`oc-pdf-handle oc-pdf-handle-${i}`}
                    x={x - handle / 2}
                    y={y - handle / 2}
                    width={handle}
                    height={handle}
                    rx={1.5 / p.scale}
                    strokeWidth={1.2 / p.scale}
                    onPointerDown={(e) => startDrag(e, sel, "resize", i)}
                  />
                ))}
            </g>
          );
        })()}
    </svg>
  );
}
