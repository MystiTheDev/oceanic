/**
 * Vector ink: pen strokes kept as point lists so they can be selected, moved and
 * resized. Plain data with no DOM state, so ink blocks and handwriting
 * recognition can reuse it.
 */
import type { Rect, StrokePt } from "./engine";

/** `width` is the full-pressure width; each point's `p` (0..1) scales it. */
export type Stroke = { pts: StrokePt[]; color: string; width: number; cap: CanvasLineCap };

/** Width of the segment ending at `q`. */
export const segWidth = (s: Stroke, q: StrokePt) => Math.max(0.5, s.width * q.p);

/** Draw one segment; live drawing and redraws both use this so they match. */
export function drawSegment(g: CanvasRenderingContext2D, s: Stroke, a: StrokePt, b: StrokePt) {
  g.save();
  g.strokeStyle = s.color;
  g.lineWidth = segWidth(s, b);
  g.lineCap = s.cap;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
  g.restore();
}

export function drawStroke(g: CanvasRenderingContext2D, s: Stroke) {
  s.pts.forEach((q, i) => drawSegment(g, s, s.pts[Math.max(0, i - 1)], q));
}

export function strokesBounds(strokes: Stroke[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes)
    for (const q of s.pts) {
      const r = segWidth(s, q) / 2;
      x0 = Math.min(x0, q.x - r);
      y0 = Math.min(y0, q.y - r);
      x1 = Math.max(x1, q.x + r);
      y1 = Math.max(y1, q.y + r);
    }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function inPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Indexes of strokes with at least half their points inside the lasso loop. */
export function strokesInLasso(strokes: Stroke[], loop: { x: number; y: number }[]): number[] {
  if (loop.length < 3) return [];
  return strokes.flatMap((s, i) => (s.pts.filter((q) => inPolygon(q, loop)).length * 2 >= s.pts.length ? [i] : []));
}

/** Map a stroke from rect `from` onto rect `to` (move + resize); width scales too. */
export function fitStroke(s: Stroke, from: Rect, to: Rect): Stroke {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return {
    ...s,
    width: s.width * Math.sqrt(sx * sy),
    pts: s.pts.map((q) => ({ x: to.x + (q.x - from.x) * sx, y: to.y + (q.y - from.y) * sy, p: q.p })),
  };
}
