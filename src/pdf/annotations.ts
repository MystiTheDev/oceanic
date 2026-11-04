/* ---------------------------------------------------------------------------
 * PDF annotation model. Every coordinate is in PDF points of its page with
 * the origin at the top-left (pdf.js viewport at scale 1), never pixels;
 * export flips y into PDF user space.
 * ------------------------------------------------------------------------ */
import type { PdfAnnotationKind, PdfAnnotationRecord } from "../data/api";
import { smoothPoints, strokePath, type StrokePt } from "../sketch/engine";

export type Box = { x: number; y: number; w: number; h: number };

export type AnnData = {
  /** highlight / underline / strike: one rect per line of the selection. */
  rects?: Box[];
  /** The selected text (markup) or the typed text (text box, sticky). */
  text?: string;
  /** ink: smoothed points with pressure 0–1. */
  points?: StrokePt[];
  /** rect / ellipse / text box / sticky anchor. */
  box?: Box;
  /** line / arrow. */
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  /** Stroke width (points); for text boxes, the font size. */
  width?: number;
};

export type Ann = { id: string; docId: string; page: number; kind: PdfAnnotationKind; color: string; data: AnnData; createdAt?: string };

export const MARKUP: PdfAnnotationKind[] = ["highlight", "underline", "strike"];
export const HIGHLIGHT_COLORS = ["#facc15", "#4ade80", "#60a5fa", "#f472b6", "#fb923c"];
export const INK_COLORS = [...HIGHLIGHT_COLORS, "#ef4444", "#111827"];
export const STICKY_SIZE = 22;

export const fromRecord = (r: PdfAnnotationRecord): Ann => {
  let data: AnnData = {};
  try {
    data = JSON.parse(r.dataJson);
  } catch {
    /* unreadable row: keep it, empty */
  }
  return { id: r.id, docId: r.docId, page: r.page, kind: r.kind, color: r.color, data, createdAt: r.createdAt };
};
export const toRecord = (a: Ann): PdfAnnotationRecord => ({
  id: a.id,
  docId: a.docId,
  page: a.page,
  kind: a.kind,
  color: a.color,
  dataJson: JSON.stringify(a.data),
  createdAt: a.createdAt ?? "",
  updatedAt: "",
});

const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};
/** Width/height may be negative while dragging; normalise. */
export const norm = (b: Box): Box => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) });

/** The annotation's bounds, for selection outlines, hit tests and resizing. */
export function bbox(a: Ann): Box {
  const d = a.data;
  if (d.rects?.length) return union(d.rects);
  if (d.points?.length) {
    const pad = (d.width ?? 2) / 2;
    return union(d.points.map((p) => ({ x: p.x - pad, y: p.y - pad, w: pad * 2, h: pad * 2 })));
  }
  if (d.from && d.to) return norm({ x: d.from.x, y: d.from.y, w: d.to.x - d.from.x, h: d.to.y - d.from.y });
  if (a.kind === "sticky" && d.box) return { x: d.box.x, y: d.box.y, w: STICKY_SIZE, h: STICKY_SIZE };
  return d.box ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** Map the annotation from bounds `a` onto bounds `b` (move = same size, resize = scaled). */
export function transform(ann: Ann, from: Box, to: Box): Ann {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const pt = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy });
  const box = (b: Box): Box => ({ ...pt(b), w: b.w * sx, h: b.h * sy });
  const d = ann.data;
  const data: AnnData = { ...d };
  if (d.rects) data.rects = d.rects.map(box);
  if (d.points) data.points = d.points.map(pt);
  if (d.from) data.from = pt(d.from);
  if (d.to) data.to = pt(d.to);
  if (d.box) data.box = ann.kind === "sticky" ? { ...d.box, ...pt(d.box) } : box(d.box);
  return { ...ann, data };
}

/** Clamp a box so it stays on the page. */
export const clampToPage = (b: Box, page: { w: number; h: number }): Box => ({
  ...b,
  x: Math.min(Math.max(0, b.x), Math.max(0, page.w - b.w)),
  y: Math.min(Math.max(0, b.y), Math.max(0, page.h - b.h)),
});

/* ------------------------------------------------------------------- ink */
/**
 * A pressure-sensitive stroke as a filled outline: each point offset either
 * side by half its width (thicker where the pen pressed harder).
 */
export function inkOutline(pts: StrokePt[], width: number): string {
  if (pts.length < 2) {
    const p = pts[0];
    if (!p) return "";
    const r = (width * (0.5 + p.p)) / 2;
    return `M${p.x - r} ${p.y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  }
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const r = (width * (0.35 + 0.65 * p.p)) / 2;
    left.push({ x: p.x + nx * r, y: p.y + ny * r });
    right.push({ x: p.x - nx * r, y: p.y - ny * r });
  });
  const end = pts[pts.length - 1];
  const start = pts[0];
  const rEnd = (width * (0.35 + 0.65 * end.p)) / 2;
  const rStart = (width * (0.35 + 0.65 * start.p)) / 2;
  return (
    strokePath(left) +
    ` A${rEnd} ${rEnd} 0 0 1 ${right[right.length - 1].x} ${right[right.length - 1].y}` +
    strokePath(right.reverse()).replace(/^M/, " L") +
    ` A${rStart} ${rStart} 0 0 1 ${left[0].x} ${left[0].y}Z`
  );
}

export const finishInk = (raw: StrokePt[]) => smoothPoints(raw, 0.6, 2);

/** Arrowhead triangle for a line from `a` to `b`. */
export function arrowHead(a: { x: number; y: number }, b: { x: number; y: number }, width: number): string {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.max(8, width * 4);
  const p1 = { x: b.x - len * Math.cos(ang - 0.45), y: b.y - len * Math.sin(ang - 0.45) };
  const p2 = { x: b.x - len * Math.cos(ang + 0.45), y: b.y - len * Math.sin(ang + 0.45) };
  return `M${b.x} ${b.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y}Z`;
}

/* --------------------------------------------------- text selection → rects */
/** The selected text of one text layer, with a space between its runs (pdf.js spans have none). */
export function rangeText(range: Range, layer: Element): string {
  const parts: string[] = [];
  layer.querySelectorAll("span:not(.markedContent)").forEach((span) => {
    if (!range.intersectsNode(span) || !span.textContent) return;
    const text = span.textContent;
    let from = 0;
    let to = text.length;
    if (range.startContainer.nodeType === Node.TEXT_NODE && span.contains(range.startContainer)) from = range.startOffset;
    if (range.endContainer.nodeType === Node.TEXT_NODE && span.contains(range.endContainer)) to = range.endOffset;
    parts.push(text.slice(from, to));
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Client rects of a DOM selection, per page, in page points. Rects on the
 * same line are merged so a highlight is one bar per line.
 */
export function selectionRects(range: Range, pageEl: HTMLElement, scale: number): Box[] {
  const pr = pageEl.getBoundingClientRect();
  const raw = [...range.getClientRects()]
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({
      left: Math.max(r.left, pr.left),
      right: Math.min(r.right, pr.right),
      top: Math.max(r.top, pr.top),
      bottom: Math.min(r.bottom, pr.bottom),
    }))
    .filter((r) => r.right > r.left && r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: typeof raw = [];
  for (const r of raw) {
    const h = r.bottom - r.top;
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - (r.top + r.bottom) / 2) < h * 0.5 && r.left <= l.right + h);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ ...r });
  }
  return lines.map((l) => ({ x: (l.left - pr.left) / scale, y: (l.top - pr.top) / scale, w: (l.right - l.left) / scale, h: (l.bottom - l.top) / scale }));
}
