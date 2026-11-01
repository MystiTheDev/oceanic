/* ---------------------------------------------------------------------------
 * Oceanic Mindmap: node model, Miro-style tree layout, presets, Mermaid.
 * ------------------------------------------------------------------------ */
import type { MindmapNodeRecord } from "../data/api";

export type NodeStyle = { color?: string; shape?: "pill" | "rounded" | "rect"; arrow?: boolean; collapsed?: boolean };

export type MNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  parentId: string | null;
  linkedPageId: string | null;
  style: NodeStyle;
};

export const ROOT = "root";
const GAP_X = 250;
const ROW_H = 64;

export const fromRecord = (n: MindmapNodeRecord): MNode => {
  let style: NodeStyle = {};
  try {
    style = JSON.parse(n.styleJson || "{}");
  } catch {
    /* keep default */
  }
  return { id: n.id, label: n.label, x: n.positionX, y: n.positionY, parentId: n.parentNodeId, linkedPageId: n.linkedPageId, style };
};

export const toRecord = (n: MNode): MindmapNodeRecord => ({
  id: n.id,
  label: n.label,
  positionX: n.x,
  positionY: n.y,
  parentNodeId: n.parentId,
  linkedPageId: n.linkedPageId,
  styleJson: JSON.stringify(n.style),
});

export const childrenOf = (nodes: MNode[], id: string) => nodes.filter((n) => n.parentId === id);

/** `id` plus every descendant. */
export function subtree(nodes: MNode[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) (out.add(n.id), (grew = true));
  }
  return out;
}

/** Which side of the root a branch grows on: 1 = right, -1 = left. */
export function sideOf(nodes: MNode[], n: MNode): 1 | -1 {
  const root = nodes.find((x) => x.id === ROOT);
  return root && n.x < root.x ? -1 : 1;
}

/**
 * Tidy up, like Miro's mind map: the root's branches alternate right/left, and
 * each subtree is stacked vertically by its height so nothing overlaps.
 */
export function layout(nodes: MNode[]): MNode[] {
  const pos = new Map<string, { x: number; y: number }>();
  const kids = (id: string) => childrenOf(nodes, id);
  const height = (id: string): number => {
    const c = kids(id);
    return c.length ? c.reduce((h, k) => h + height(k.id), 0) : ROW_H;
  };
  const place = (id: string, x: number, top: number, dir: 1 | -1) => {
    const h = height(id);
    pos.set(id, { x, y: top + h / 2 });
    let y = top;
    for (const k of kids(id)) {
      place(k.id, x + dir * GAP_X, y, dir);
      y += height(k.id);
    }
  };
  pos.set(ROOT, { x: 0, y: 0 });
  const branches = kids(ROOT);
  for (const dir of [1, -1] as const) {
    const side = branches.filter((_, i) => (i % 2 === 0 ? 1 : -1) === dir);
    const total = side.reduce((h, b) => h + height(b.id), 0);
    let y = -total / 2;
    for (const b of side) {
      place(b.id, dir * GAP_X, y, dir);
      y += height(b.id);
    }
  }
  return nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) }));
}

/** Spot for a new child of `parent`: beside it, below its last child. */
export function childSpot(nodes: MNode[], parent: MNode): { x: number; y: number } {
  const siblings = childrenOf(nodes, parent.id);
  const dir = parent.id === ROOT ? (siblings.length % 2 === 0 ? 1 : -1) : sideOf(nodes, parent);
  const same = siblings.filter((s) => Math.sign(s.x - parent.x) === dir);
  const last = same.reduce<MNode | null>((a, s) => (!a || s.y > a.y ? s : a), null);
  return { x: parent.x + dir * GAP_X, y: last ? last.y + ROW_H : parent.y };
}

/* ---------------------------------------------------------------- presets */
export const SUBJECTS: { id: string; label: string; icon: string; branches: string[] }[] = [
  { id: "", label: "Blank", icon: "🧠", branches: [] },
  { id: "physics", label: "Physics", icon: "⚛️", branches: ["Mechanics", "Waves & Optics", "Electricity & Magnetism", "Thermodynamics", "Modern Physics"] },
  { id: "chemistry", label: "Chemistry", icon: "🧪", branches: ["Physical", "Organic", "Inorganic", "Reactions", "Lab work"] },
  { id: "maths", label: "Maths", icon: "📐", branches: ["Algebra", "Calculus", "Geometry", "Trigonometry", "Statistics"] },
  { id: "cs", label: "Computer Science", icon: "💻", branches: ["Programming", "Data Structures", "Algorithms", "Databases", "Networks"] },
  { id: "literature", label: "Literature", icon: "📚", branches: ["Themes", "Characters", "Plot", "Setting", "Quotes"] },
];
export const subjectOf = (id: string) => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];

/* ---------------------------------------------------------------- mermaid */
export function toMermaid(nodes: MNode[]): string {
  const clean = (s: string) => (s || "Untitled").replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  const lines = ["mindmap"];
  const walk = (id: string, depth: number) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const pad = "  ".repeat(depth);
    lines.push(depth === 1 ? `${pad}root((${clean(n.label)}))` : `${pad}${clean(n.label)}`);
    for (const k of childrenOf(nodes, id).sort((a, b) => a.y - b.y)) walk(k.id, depth + 1);
  };
  walk(ROOT, 1);
  return lines.join("\n");
}
