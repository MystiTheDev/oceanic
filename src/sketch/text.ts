/**
 * Oceanic Sketch live text: a text box stays editable (move, scale, restyle)
 * until it is baked into its layer's pixels. One draw function serves the
 * on-screen preview, saving and baking, so they always match.
 */
import { ctx2d } from "./engine";

export type TextObj = {
  id: string;
  /** Layer id the text bakes into. */
  layer: string;
  x: number;
  y: number;
  value: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
  /** Outline colour, or null for none. */
  outline: string | null;
  /** Highlight box colour, or null for none. */
  bg: string | null;
  shadow: boolean;
};

/** Fonts every Windows PC has: no downloads. */
export const FONTS: { label: string; css: string }[] = [
  { label: "Sans", css: 'Inter, "Segoe UI", sans-serif' },
  { label: "Serif", css: 'Georgia, "Times New Roman", serif' },
  { label: "Mono", css: 'Consolas, "Courier New", monospace' },
  { label: "Handwritten", css: '"Segoe Print", "Bradley Hand", cursive' },
  { label: "Casual", css: '"Comic Sans MS", "Comic Neue", cursive' },
  { label: "Display", css: 'Impact, "Arial Black", sans-serif' },
];

export const fontCss = (t: TextObj) => `${t.italic ? "italic " : ""}${t.bold ? 700 : 400} ${t.size}px ${t.font}`;
export const lineH = (t: TextObj) => t.size * 1.25;
export const padOf = (t: TextObj) => (t.bg ? Math.round(t.size * 0.3) : 2);

const measurer = ctx2d(document.createElement("canvas"));
/** Box size of a text (no wrapping: lines come from Enter only). */
export function textBox(t: TextObj) {
  measurer.font = fontCss(t);
  const lines = (t.value || " ").split("\n");
  const pad = padOf(t);
  const w = Math.max(t.size * 0.6, ...lines.map((l) => measurer.measureText(l).width)) + pad * 2;
  return { lines, w: Math.ceil(w), h: Math.ceil(lines.length * lineH(t) + pad * 2), pad };
}

/** Paint the text at its own x/y on `g`. */
export function drawText(g: CanvasRenderingContext2D, t: TextObj) {
  const { lines, w, h, pad } = textBox(t);
  g.save();
  g.font = fontCss(t);
  g.textBaseline = "top";
  g.textAlign = t.align;
  if (t.shadow) {
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = t.size * 0.18;
    g.shadowOffsetY = t.size * 0.06;
  }
  if (t.bg) {
    g.fillStyle = t.bg;
    g.beginPath();
    g.roundRect(t.x, t.y, w, h, t.size * 0.2);
    g.fill();
    if (!t.outline) g.shadowColor = "transparent";
  }
  const ax = t.align === "left" ? t.x + pad : t.align === "center" ? t.x + w / 2 : t.x + w - pad;
  lines.forEach((line, i) => {
    const y = t.y + pad + i * lineH(t) + (lineH(t) - t.size) / 2;
    if (t.outline) {
      g.strokeStyle = t.outline;
      g.lineWidth = Math.max(1, t.size / 8);
      g.lineJoin = "round";
      g.strokeText(line, ax, y);
    }
    g.fillStyle = t.color;
    g.fillText(line, ax, y);
    if (t.underline && line) {
      const lw = g.measureText(line).width;
      const lx = t.align === "left" ? ax : t.align === "center" ? ax - lw / 2 : ax - lw;
      g.fillRect(lx, y + t.size * 1.02, lw, Math.max(1, t.size / 14));
    }
  });
  g.restore();
}
