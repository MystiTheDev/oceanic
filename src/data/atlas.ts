/**
 * Pure Atlas graph helpers over canvas edges. No storage or UI here: callers
 * pass the edges they already loaded.
 */
import type { CanvasEdge, RelType } from "./api";

/** Relationships that read the same both ways (drawn without an arrowhead). */
export const SYMMETRIC_TYPES: ReadonlySet<RelType> = new Set<RelType>(["contrasts", "related"]);

/** UI labels, read as "source <label> target". */
export const REL_LABELS: Record<RelType, string> = {
  depends_on: "Depends on",
  explains: "Explains",
  part_of: "Part of",
  example_of: "Example of",
  applied_in: "Applied in",
  contrasts: "Contrasts with",
  causes: "Causes",
  extends: "Extends",
  related: "Related to",
};

/** Default line color per relationship type (a color picked on the edge still wins). */
export const REL_COLORS: Record<RelType, string> = {
  depends_on: "#f59e0b",
  explains: "#38bdf8",
  part_of: "#a78bfa",
  example_of: "#2dd4bf",
  applied_in: "#4ade80",
  contrasts: "#fb7185",
  causes: "#fb923c",
  extends: "#818cf8",
  related: "#a3a3a3",
};

/** Lines of a relationship type switched off in the filter. */
export const MUTED_STROKE = "#525252";

export const isConceptId = (id: string) => id.startsWith("concept:");

/** Every node directly connected to `id`, in either direction. */
export function neighborIds(edges: CanvasEdge[], id: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.sourceId === id) out.add(e.targetId);
    else if (e.targetId === id) out.add(e.sourceId);
  }
  return out;
}

/**
 * Everything `target` depends on, directly or transitively, following only
 * `depends_on` edges (source depends on target). Returned in learning order:
 * a concept always comes after the ones it depends on. `cycle` lists the
 * nodes found on a dependency loop; they are skipped, never looped over.
 */
export function prerequisites(edges: CanvasEdge[], target: string): { order: string[]; cycle: string[] } {
  const deps = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relType !== "depends_on") continue;
    deps.set(e.sourceId, [...(deps.get(e.sourceId) ?? []), e.targetId]);
  }
  const order: string[] = [];
  const cycle = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    const at = stack.indexOf(id);
    if (at >= 0) {
      stack.slice(at).forEach((x) => cycle.add(x)); // every node on the loop
      return;
    }
    stack.push(id);
    for (const d of deps.get(id) ?? []) visit(d);
    stack.pop();
    done.add(id);
    if (id !== target) order.push(id);
  };
  visit(target);
  return { order, cycle: [...cycle] };
}
