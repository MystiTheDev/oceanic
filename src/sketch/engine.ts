/** Oceanic Sketch's drawing model: a stack of layer canvases plus undo history. */

export type Layer = { id: string; name: string; visible: boolean; opacity: number; canvas: HTMLCanvasElement };
export type Rect = { x: number; y: number; w: number; h: number };
type Snapshot = { w: number; h: number; active: number; layers: { id: string; name: string; visible: boolean; opacity: number; data: ImageData }[] };

let nextId = 1;
const lid = () => `l${nextId++}`;

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

export class SketchDoc {
  w: number;
  h: number;
  layers: Layer[] = [];
  active = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  onChange: () => void = () => {};

  constructor(w: number, h: number, background = "#ffffff") {
    this.w = w;
    this.h = h;
    const bg = this.addLayer("Background");
    const g = ctx2d(bg.canvas);
    g.fillStyle = background;
    g.fillRect(0, 0, w, h);
  }

  get layer() {
    return this.layers[this.active];
  }
  get ctx() {
    return ctx2d(this.layer.canvas);
  }

  addLayer(name = `Layer ${this.layers.length}`, at = this.layers.length) {
    const layer: Layer = { id: lid(), name, visible: true, opacity: 1, canvas: makeCanvas(this.w, this.h) };
    this.layers.splice(at, 0, layer);
    this.active = at;
    return layer;
  }

  /* ---------------------------------------------------------------- history */
  private snap(): Snapshot {
    return {
      w: this.w,
      h: this.h,
      active: this.active,
      layers: this.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, data: ctx2d(l.canvas).getImageData(0, 0, this.w, this.h) })),
    };
  }
  private restore(s: Snapshot) {
    this.w = s.w;
    this.h = s.h;
    this.layers = s.layers.map((l) => {
      const canvas = makeCanvas(s.w, s.h);
      ctx2d(canvas).putImageData(l.data, 0, 0);
      return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, canvas };
    });
    this.active = Math.min(s.active, this.layers.length - 1);
    this.onChange();
  }
  /** Call before any change; keeps the last 30 states. */
  checkpoint() {
    this.undoStack.push(this.snap());
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap());
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap());
    this.restore(s);
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /* ---------------------------------------------------------------- whole image */
  /** Rebuild every layer at a new size via `draw(oldCanvas, ctx)`. */
  private remap(w: number, h: number, draw: (src: HTMLCanvasElement, g: CanvasRenderingContext2D, isBottom: boolean) => void) {
    this.layers = this.layers.map((l, i) => {
      const c = makeCanvas(w, h);
      draw(l.canvas, ctx2d(c), i === 0);
      return { ...l, canvas: c };
    });
    this.w = w;
    this.h = h;
    this.onChange();
  }
  /** Canvas size change (no scaling): new area is white on the background. */
  resizeCanvas(w: number, h: number) {
    this.remap(w, h, (src, g, bottom) => {
      if (bottom) {
        g.fillStyle = "#fff";
        g.fillRect(0, 0, w, h);
      }
      g.drawImage(src, 0, 0);
    });
  }
  scaleImage(w: number, h: number) {
    this.remap(w, h, (src, g) => {
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, w, h);
    });
  }
  crop(r: Rect) {
    this.remap(r.w, r.h, (src, g) => g.drawImage(src, -r.x, -r.y));
  }
  rotate(deg: 90 | -90 | 180) {
    const [w, h] = deg === 180 ? [this.w, this.h] : [this.h, this.w];
    this.remap(w, h, (src, g) => {
      g.translate(w / 2, h / 2);
      g.rotate((deg * Math.PI) / 180);
      g.drawImage(src, -src.width / 2, -src.height / 2);
    });
  }
  flip(horizontal: boolean) {
    this.remap(this.w, this.h, (src, g) => {
      g.translate(horizontal ? this.w : 0, horizontal ? 0 : this.h);
      g.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      g.drawImage(src, 0, 0);
    });
  }

  /** All visible layers composited (white under a JPG). */
  flatten(opaque = false) {
    const c = makeCanvas(this.w, this.h);
    const g = ctx2d(c);
    if (opaque) {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, this.w, this.h);
    }
    for (const l of this.layers) {
      if (!l.visible) continue;
      g.globalAlpha = l.opacity;
      g.drawImage(l.canvas, 0, 0);
    }
    return c;
  }

  /* ---------------------------------------------------------------- layers */
  duplicateLayer() {
    const src = this.layer;
    const l = this.addLayer(`${src.name} copy`, this.active + 1);
    ctx2d(l.canvas).drawImage(src.canvas, 0, 0);
    l.opacity = src.opacity;
  }
  deleteLayer() {
    if (this.layers.length < 2) return;
    this.layers.splice(this.active, 1);
    this.active = Math.max(0, this.active - 1);
  }
  moveLayer(dir: 1 | -1) {
    const to = this.active + dir;
    if (to < 0 || to >= this.layers.length) return;
    [this.layers[this.active], this.layers[to]] = [this.layers[to], this.layers[this.active]];
    this.active = to;
  }
  mergeDown() {
    if (this.active === 0) return;
    const top = this.layer;
    const below = this.layers[this.active - 1];
    const g = ctx2d(below.canvas);
    g.globalAlpha = top.opacity;
    g.drawImage(top.canvas, 0, 0);
    g.globalAlpha = 1;
    this.deleteLayer();
  }
}

/* ------------------------------------------------------------------ pixels */
export function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}
export const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Scanline flood fill with a small colour tolerance. */
export function floodFill(g: CanvasRenderingContext2D, x0: number, y0: number, color: string, tolerance = 32) {
  const { width: w, height: h } = g.canvas;
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const i0 = (y0 * w + x0) * 4;
  const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const fill = hexToRgba(color);
  if (target.every((v, k) => Math.abs(v - fill[k]) <= 2)) return;
  const near = (i: number) =>
    Math.abs(d[i] - target[0]) <= tolerance && Math.abs(d[i + 1] - target[1]) <= tolerance && Math.abs(d[i + 2] - target[2]) <= tolerance && Math.abs(d[i + 3] - target[3]) <= tolerance;
  const seen = new Uint8Array(w * h);
  const stack: [number, number][] = [[x0, y0]];
  while (stack.length) {
    const [sx, y] = stack.pop()!;
    let x = sx;
    while (x >= 0 && !seen[y * w + x] && near((y * w + x) * 4)) x--;
    x++;
    let up = false;
    let down = false;
    while (x < w && !seen[y * w + x] && near((y * w + x) * 4)) {
      const i = (y * w + x) * 4;
      seen[y * w + x] = 1;
      d[i] = fill[0];
      d[i + 1] = fill[1];
      d[i + 2] = fill[2];
      d[i + 3] = 255;
      if (y > 0) {
        const n = ((y - 1) * w + x) * 4;
        const ok = !seen[(y - 1) * w + x] && near(n);
        if (ok && !up) stack.push([x, y - 1]);
        up = ok;
      }
      if (y < h - 1) {
        const n = ((y + 1) * w + x) * 4;
        const ok = !seen[(y + 1) * w + x] && near(n);
        if (ok && !down) stack.push([x, y + 1]);
        down = ok;
      }
      x++;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Shape outline/fill on a context; `a` = start, `b` = end point. */
export type ShapeKind = "line" | "rect" | "roundrect" | "ellipse" | "triangle" | "arrow";
export function drawShape(
  g: CanvasRenderingContext2D,
  kind: ShapeKind,
  a: { x: number; y: number },
  b: { x: number; y: number },
  opts: { stroke: string; fill: string; width: number; mode: "outline" | "fill" | "both" },
) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  g.save();
  g.lineWidth = opts.width;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = opts.stroke;
  g.fillStyle = opts.mode === "fill" ? opts.stroke : opts.fill;
  g.beginPath();
  if (kind === "line" || kind === "arrow") {
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    if (kind === "arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.max(10, opts.width * 4);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
      g.stroke();
    }
    g.restore();
    return;
  }
  if (kind === "rect") g.rect(x, y, w, h);
  else if (kind === "roundrect") g.roundRect(x, y, w, h, Math.min(w, h) * 0.15);
  else if (kind === "ellipse") g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (kind === "triangle") {
    g.moveTo(x + w / 2, y);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.closePath();
  }
  if (opts.mode !== "outline") g.fill();
  if (opts.mode !== "fill") g.stroke();
  g.restore();
}
