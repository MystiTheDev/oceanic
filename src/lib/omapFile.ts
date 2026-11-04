import { api } from "../data/api";

/** Oceanic's mindmap file (.omap): the map's title, subject and every node with its layout and style. */
type OmapFile = { format: "oceanic-mindmap"; version: 1; title: string; subjectTag: string; nodes: Awaited<ReturnType<typeof api.getMindmapById>> extends infer M ? (M extends { nodes: infer N } ? N : never) : never };

export async function buildOmap(id: string): Promise<Uint8Array> {
  const m = await api.getMindmapById(id);
  if (!m) throw new Error("Mindmap not found");
  const file: OmapFile = { format: "oceanic-mindmap", version: 1, title: m.title, subjectTag: m.subjectTag, nodes: m.nodes };
  return new TextEncoder().encode(JSON.stringify(file));
}

/** Creates a mindmap from a .omap file (fresh node ids). A map with the same
    title already in Oceanic is returned instead (`existing: true`), not duplicated. */
export async function importOmap(bytes: Uint8Array): Promise<{ id: string; existing: boolean; title: string }> {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as OmapFile;
  if (file.format !== "oceanic-mindmap") throw new Error("Not an Oceanic mindmap file");
  const same = (await api.getAllMindmaps()).find((m) => m.title.trim().toLowerCase() === file.title.trim().toLowerCase());
  if (same) return { id: same.id, existing: true, title: same.title };
  const created = await api.createMindmap(file.title, file.subjectTag);
  const ids = new Map(file.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const nodes = file.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, parentNodeId: n.parentNodeId ? (ids.get(n.parentNodeId) ?? null) : null, linkedPageId: null }));
  await api.saveMindmap(created.id, file.title, file.subjectTag, nodes);
  return { id: created.id, existing: false, title: file.title };
}
