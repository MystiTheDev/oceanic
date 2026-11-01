/* ---------------------------------------------------------------------------
 * Persistence API. Inside the desktop app every call goes to the Rust/SQLite
 * commands in src-tauri/src/db.rs; in a plain browser (vite preview) the same
 * calls are served from localStorage so the UI keeps working.
 * ------------------------------------------------------------------------ */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `PageSummary` in db.rs (camelCase over the wire). */
export type PageRecord = {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  isPinned: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  /** `YYYY-MM-DD` when scheduled. */
  dueDate: string | null;
  status: PageStatus | null;
  tags: string[];
};

/** A search match; `snippet` marks hits with …. */
export type SearchHit = { pageId: string; snippet: string; rank: number };

export type MindmapRecord = {
  id: string;
  title: string;
  subjectTag: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
};
export type MindmapNodeRecord = {
  id: string;
  label: string;
  positionX: number;
  positionY: number;
  parentNodeId: string | null;
  linkedPageId: string | null;
  /** JSON: { color?, shape?, arrow? } */
  styleJson: string;
};
export type MindmapWithNodes = MindmapRecord & { nodes: MindmapNodeRecord[] };

export type PageStatus = "not_started" | "in_progress" | "done";
export type PageProperties = Pick<PageRecord, "dueDate" | "status" | "tags">;

export type WorkspaceRecord = {
  id: string;
  name: string;
  icon: string;
  color: string;
  positionX: number;
  positionY: number;
};

/** Full page: summary plus the BlockNote document JSON (null until first save). */
export type PageWithContent = PageRecord & { content: string | null };

export type TabRecord = {
  id: string;
  history: string[];
  historyIndex: number;
  isActive: boolean;
};

/** An outgoing page reference found in a document (see lib/links.ts). */
export type PageLink = { targetId: string; snippet: string };
export type Backlink = {
  sourceId: string;
  snippet: string;
  /** "document" = a `[[page]]` chip; "canvas" = a connection drawn on the canvas. */
  via: "document" | "canvas";
  label: string;
};

export type EdgeColor =
  | "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
export type EdgeStyle = "solid" | "dashed" | "dotted";

/** A drawn connection (`manual`) or the styling of a document link. */
export type CanvasEdge = {
  sourceId: string;
  targetId: string;
  label: string;
  color: EdgeColor;
  style: EdgeStyle;
  manual: boolean;
};
export type LinkEdge = { sourceId: string; targetId: string };
export type CanvasPosition = { pageId: string; x: number; y: number };

export type Api = {
  getPages(): Promise<PageRecord[]>;
  getTrashedPages(): Promise<PageRecord[]>;
  getPage(id: string): Promise<PageWithContent | null>;
  createPage(parentId: string | null, workspaceId: string, dueDate?: string | null): Promise<PageRecord>;
  setPageProperties(id: string, props: PageProperties): Promise<string>;
  getPagesInRange(workspaceId: string, start: string, end: string): Promise<PageRecord[]>;
  getWorkspaces(): Promise<WorkspaceRecord[]>;
  createWorkspace(name: string, icon: string, color: string): Promise<WorkspaceRecord>;
  updateWorkspace(id: string, name: string, icon: string, color: string): Promise<void>;
  reorderWorkspaces(ids: string[]): Promise<void>;
  /** Top-level pages go to Trash; everything is reassigned to `fallbackId`. */
  deleteWorkspace(id: string, fallbackId: string): Promise<void>;
  movePageToWorkspace(id: string, workspaceId: string): Promise<string>;
  searchPages(query: string, titleOnly: boolean): Promise<SearchHit[]>;
  getAllMindmaps(): Promise<MindmapRecord[]>;
  getMindmapById(id: string): Promise<MindmapWithNodes | null>;
  createMindmap(title: string, subjectTag: string): Promise<MindmapWithNodes>;
  saveMindmap(id: string, title: string, subjectTag: string, nodes: MindmapNodeRecord[]): Promise<string>;
  deleteMindmap(id: string): Promise<void>;
  getSettings(): Promise<Record<string, string>>;
  setSetting(key: string, value: string): Promise<void>;
  getStoragePath(): Promise<string>;
  /** Copies the database to `dir` and restarts the app. */
  moveStorage(dir: string): Promise<void>;
  /** Stores the document and its outgoing links. Returns the new `updatedAt`. */
  savePage(id: string, title: string, content: string, links: PageLink[]): Promise<string>;
  renamePage(id: string, title: string): Promise<string>;
  setPageIcon(id: string, icon: string): Promise<string>;
  togglePinPage(id: string): Promise<boolean>;
  deletePage(id: string): Promise<void>;
  restorePage(id: string): Promise<void>;
  deletePageForever(id: string): Promise<void>;
  duplicatePage(id: string, content: string | null, links: PageLink[] | null): Promise<PageRecord>;
  /** Re-parent and/or reorder; `position` is the index among live siblings. Returns `updatedAt`. */
  updatePageParent(id: string, newParentId: string | null, position: number | null): Promise<string>;
  getBacklinks(id: string): Promise<Backlink[]>;
  getLinks(): Promise<LinkEdge[]>;
  getCanvasPositions(): Promise<CanvasPosition[]>;
  saveCanvasPositions(positions: CanvasPosition[]): Promise<void>;
  getCanvasEdges(): Promise<CanvasEdge[]>;
  connectPages(sourceId: string, targetId: string): Promise<CanvasEdge>;
  updateCanvasEdge(
    sourceId: string,
    targetId: string,
    edge: Pick<CanvasEdge, "label" | "color" | "style">,
  ): Promise<CanvasEdge>;
  deleteCanvasEdge(sourceId: string, targetId: string): Promise<void>;
  getTabs(): Promise<TabRecord[]>;
  saveTabs(tabs: TabRecord[]): Promise<void>;
};

/* ------------------------------------------------------------------ Tauri */
const tauriApi: Api = {
  getPages: () => invoke("get_pages"),
  getTrashedPages: () => invoke("get_trashed_pages"),
  getPage: (id) => invoke("get_page", { id }),
  createPage: (parentId, workspaceId, dueDate = null) =>
    invoke("create_page", { parentId, workspaceId, dueDate }),
  setPageProperties: (id, props) => invoke("set_page_properties", { id, ...props }),
  getPagesInRange: (workspaceId, start, end) => invoke("get_pages_in_range", { workspaceId, start, end }),
  getWorkspaces: () => invoke("get_workspaces"),
  createWorkspace: (name, icon, color) => invoke("create_workspace", { name, icon, color }),
  updateWorkspace: (id, name, icon, color) => invoke("update_workspace", { id, name, icon, color }),
  reorderWorkspaces: (ids) => invoke("reorder_workspaces", { ids }),
  deleteWorkspace: (id, fallbackId) => invoke("delete_workspace", { id, fallbackId }),
  movePageToWorkspace: (id, workspaceId) => invoke("move_page_to_workspace", { id, workspaceId }),
  searchPages: (query, titleOnly) => invoke("search_pages", { query, titleOnly }),
  getAllMindmaps: () => invoke("get_all_mindmaps"),
  getMindmapById: (id) => invoke("get_mindmap_by_id", { id }),
  createMindmap: (title, subjectTag) => invoke("create_mindmap", { title, subjectTag }),
  saveMindmap: (id, title, subjectTag, nodes) => invoke("save_mindmap", { id, title, subjectTag, nodes }),
  deleteMindmap: (id) => invoke("delete_mindmap", { id }),
  getSettings: () => invoke("get_settings"),
  setSetting: (key, value) => invoke("set_setting", { key, value }),
  getStoragePath: () => invoke("get_storage_path"),
  moveStorage: (dir) => invoke("move_storage", { dir }),
  savePage: (id, title, content, links) => invoke("save_page", { id, title, content, links }),
  renamePage: (id, title) => invoke("rename_page", { id, title }),
  setPageIcon: (id, icon) => invoke("set_page_icon", { id, icon }),
  togglePinPage: (id) => invoke("toggle_pin_page", { id }),
  deletePage: (id) => invoke("delete_page", { id }),
  restorePage: (id) => invoke("restore_page", { id }),
  deletePageForever: (id) => invoke("delete_page_forever", { id }),
  duplicatePage: (id, content, links) => invoke("duplicate_page", { id, content, links }),
  updatePageParent: (id, newParentId, position) =>
    invoke("update_page_parent", { id, newParentId, position }),
  getBacklinks: (id) => invoke("get_backlinks", { id }),
  getLinks: () => invoke("get_links"),
  getCanvasPositions: () => invoke("get_canvas_positions"),
  saveCanvasPositions: (positions) => invoke("save_canvas_positions", { positions }),
  getCanvasEdges: () => invoke("get_canvas_edges"),
  connectPages: (sourceId, targetId) => invoke("connect_pages", { sourceId, targetId }),
  updateCanvasEdge: (sourceId, targetId, edge) =>
    invoke("update_canvas_edge", { sourceId, targetId, ...edge }),
  deleteCanvasEdge: (sourceId, targetId) => invoke("delete_canvas_edge", { sourceId, targetId }),
  getTabs: () => invoke("get_tabs"),
  saveTabs: (tabs) => invoke("save_tabs", { tabs }),
};

/* ------------------------------------------------------- localStorage mirror */
type Row = PageWithContent & { isArchived: boolean; sortOrder: number };
type Store = {
  pages: Row[];
  tabs: TabRecord[];
  links?: (LinkEdge & { snippet: string })[];
  positions?: CanvasPosition[];
  edges?: CanvasEdge[];
  workspaces?: (WorkspaceRecord & { sortOrder: number })[];
  settings?: Record<string, string>;
  mindmaps?: MindmapWithNodes[];
};

const KEY = "oceanic.db";
const now = () => new Date().toISOString();

const starter = (): Row => ({
  id: "welcome",
  title: "Welcome",
  icon: "🌊",
  parentId: null,
  isPinned: true,
  isArchived: false,
  archivedAt: null,
  sortOrder: 0,
  content: null,
  createdAt: now(),
  updatedAt: now(),
  workspaceId: "general",
  dueDate: null,
  status: null,
  tags: [],
});

const GENERAL = { id: "general", name: "General", icon: "🌊", color: "blue", positionX: 0, positionY: 0, sortOrder: 0 };

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const store = JSON.parse(raw) as Store;
      store.links ??= [];
      store.positions ??= [];
      store.edges ??= [];
      store.workspaces ??= [GENERAL];
      store.settings ??= {};
      // Rows saved before workspaces / properties existed.
      for (const p of store.pages) {
        p.workspaceId ??= "general";
        p.dueDate ??= null;
        p.status ??= null;
        p.tags ??= [];
      }
      return store;
    }
  } catch {
    /* corrupt or blocked storage: start fresh */
  }
  return { pages: [starter()], tabs: [], links: [], positions: [], edges: [], workspaces: [GENERAL], settings: {} };
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked: keep running in memory */
  }
}

/** Run `fn` against the store, persist, and resolve like an IPC call would. */
function tx<T>(fn: (s: Store) => T): Promise<T> {
  const store = load();
  try {
    const out = fn(store);
    save(store);
    return Promise.resolve(out);
  } catch (e) {
    return Promise.reject(e);
  }
}

const summary = ({ content: _c, isArchived: _a, sortOrder: _o, ...rest }: Row): PageRecord => rest;
const find = (s: Store, id: string) => {
  const row = s.pages.find((p) => p.id === id);
  if (!row) throw new Error(`page ${id} not found`);
  return row;
};
const writeLinks = (s: Store, sourceId: string, links: PageLink[]) => {
  s.links = s.links!.filter((l) => l.sourceId !== sourceId);
  for (const l of links) {
    if (l.targetId !== sourceId) s.links.push({ sourceId, targetId: l.targetId, snippet: l.snippet });
  }
};
const bySort = (a: Row, b: Row) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);

const localApi: Api = {
  getPages: () => tx((s) => s.pages.filter((p) => !p.isArchived).sort(bySort).map(summary)),
  getTrashedPages: () =>
    tx((s) =>
      s.pages
        .filter((p) => p.isArchived)
        .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))
        .map(summary),
    ),
  getPage: (id) =>
    tx((s) => {
      const row = s.pages.find((p) => p.id === id);
      return row ? { ...summary(row), content: row.content } : null;
    }),
  createPage: (parentId, workspaceId, dueDate = null) =>
    tx((s) => {
      const siblings = s.pages.filter((p) => p.parentId === parentId);
      const parent = parentId ? s.pages.find((p) => p.id === parentId) : undefined;
      const row: Row = {
        ...starter(),
        id: crypto.randomUUID(),
        title: "Untitled",
        icon: "📄",
        isPinned: false,
        parentId,
        workspaceId: parent?.workspaceId ?? workspaceId,
        dueDate,
        sortOrder: Math.max(-1, ...siblings.map((p) => p.sortOrder)) + 1,
      };
      s.pages.push(row);
      return summary(row);
    }),
  savePage: (id, title, content, links) =>
    tx((s) => {
      writeLinks(s, id, links);
      return Object.assign(find(s, id), { title, content, updatedAt: now() }).updatedAt;
    }),
  renamePage: (id, title) => tx((s) => Object.assign(find(s, id), { title, updatedAt: now() }).updatedAt),
  setPageIcon: (id, icon) => tx((s) => Object.assign(find(s, id), { icon, updatedAt: now() }).updatedAt),
  togglePinPage: (id) =>
    tx((s) => {
      const row = find(s, id);
      row.isPinned = !row.isPinned;
      return row.isPinned;
    }),
  deletePage: (id) =>
    tx((s) => {
      Object.assign(find(s, id), { isArchived: true, archivedAt: now() });
    }),
  restorePage: (id) =>
    tx((s) => {
      Object.assign(find(s, id), { isArchived: false, archivedAt: null });
    }),
  deletePageForever: (id) =>
    tx((s) => {
      const gone = new Set([id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of s.pages) {
          if (p.parentId && gone.has(p.parentId) && !gone.has(p.id)) {
            gone.add(p.id);
            grew = true;
          }
        }
      }
      s.pages = s.pages.filter((p) => !gone.has(p.id));
      s.links = s.links!.filter((l) => !gone.has(l.sourceId) && !gone.has(l.targetId));
      s.positions = s.positions!.filter((p) => !gone.has(p.pageId));
      s.edges = s.edges!.filter((e) => !gone.has(e.sourceId) && !gone.has(e.targetId));
    }),
  duplicatePage: (id, content, links) =>
    tx((s) => {
      const orig = find(s, id);
      for (const p of s.pages) {
        if (p.parentId === orig.parentId && p.sortOrder > orig.sortOrder) p.sortOrder += 1;
      }
      const row: Row = {
        ...orig,
        id: crypto.randomUUID(),
        title: `${orig.title} (copy)`,
        content: content ?? orig.content,
        isPinned: false,
        sortOrder: orig.sortOrder + 1,
        createdAt: now(),
        updatedAt: now(),
      };
      s.pages.push(row);
      writeLinks(s, row.id, links ?? s.links!.filter((l) => l.sourceId === id));
      return summary(row);
    }),
  updatePageParent: (id, newParentId, position) =>
    tx((s) => {
      for (let p = newParentId; p; p = s.pages.find((x) => x.id === p)?.parentId ?? null) {
        if (p === id) throw new Error("A page can't be moved inside itself");
      }
      const siblings = (archived: boolean) =>
        s.pages
          .filter((p) => p.parentId === newParentId && p.id !== id && p.isArchived === archived)
          .sort(bySort);
      const order = siblings(false);
      const row = find(s, id);
      order.splice(Math.min(position ?? order.length, order.length), 0, row);
      [...order, ...siblings(true)].forEach((p, i) => (p.sortOrder = i));
      return Object.assign(row, { parentId: newParentId, updatedAt: now() }).updatedAt;
    }),
  getBacklinks: (id) =>
    tx((s) => {
      const live = new Map(s.pages.filter((p) => !p.isArchived).map((p) => [p.id, p]));
      const fromDocs: Backlink[] = s.links!
        .filter((l) => l.targetId === id)
        .map(({ sourceId, snippet }) => ({ sourceId, snippet, via: "document", label: "" }));
      const fromCanvas: Backlink[] = s.edges!
        .filter((e) => e.manual && (e.sourceId === id || e.targetId === id))
        .map((e) => ({
          sourceId: e.sourceId === id ? e.targetId : e.sourceId,
          snippet: "",
          via: "canvas",
          label: e.label,
        }));
      return [...fromDocs, ...fromCanvas]
        .filter((b) => b.sourceId !== id && live.has(b.sourceId))
        .sort((a, b) => live.get(b.sourceId)!.updatedAt.localeCompare(live.get(a.sourceId)!.updatedAt));
    }),
  getLinks: () => tx((s) => s.links!.map(({ sourceId, targetId }) => ({ sourceId, targetId }))),
  getCanvasPositions: () => tx((s) => s.positions!),
  saveCanvasPositions: (positions) =>
    tx((s) => {
      const next = new Map(s.positions!.map((p) => [p.pageId, p]));
      positions.forEach((p) => next.set(p.pageId, p));
      s.positions = [...next.values()];
    }),
  getCanvasEdges: () => tx((s) => s.edges!),
  connectPages: (sourceId, targetId) =>
    tx((s) => {
      if (sourceId === targetId) throw new Error("A page can't connect to itself");
      let edge = s.edges!.find((e) => e.sourceId === sourceId && e.targetId === targetId);
      if (!edge) {
        edge = { sourceId, targetId, label: "", color: "default", style: "solid", manual: true };
        s.edges!.push(edge);
      }
      edge.manual = true;
      return { ...edge };
    }),
  updateCanvasEdge: (sourceId, targetId, patch) =>
    tx((s) => {
      let edge = s.edges!.find((e) => e.sourceId === sourceId && e.targetId === targetId);
      if (!edge) {
        edge = { sourceId, targetId, label: "", color: "default", style: "solid", manual: false };
        s.edges!.push(edge);
      }
      Object.assign(edge, patch);
      return { ...edge };
    }),
  deleteCanvasEdge: (sourceId, targetId) =>
    tx((s) => {
      s.edges = s.edges!.filter((e) => !(e.sourceId === sourceId && e.targetId === targetId));
    }),
  setPageProperties: (id, props) =>
    tx((s) => Object.assign(find(s, id), props, { updatedAt: now() }).updatedAt),
  getPagesInRange: (workspaceId, start, end) =>
    tx((s) =>
      s.pages
        .filter((p) => !p.isArchived && p.workspaceId === workspaceId && p.dueDate && p.dueDate >= start && p.dueDate <= end)
        .map(summary),
    ),
  getWorkspaces: () =>
    tx((s) => [...s.workspaces!].sort((a, b) => a.sortOrder - b.sortOrder).map(({ sortOrder: _o, ...w }) => w)),
  createWorkspace: (name, icon, color) =>
    tx((s) => {
      const w = { id: crypto.randomUUID(), name, icon, color, positionX: 0, positionY: 0, sortOrder: s.workspaces!.length };
      s.workspaces!.push(w);
      const { sortOrder: _o, ...out } = w;
      return out;
    }),
  updateWorkspace: (id, name, icon, color) =>
    tx((s) => {
      Object.assign(s.workspaces!.find((w) => w.id === id)!, { name, icon, color });
    }),
  reorderWorkspaces: (ids) =>
    tx((s) => {
      for (const w of s.workspaces!) w.sortOrder = ids.indexOf(w.id);
    }),
  deleteWorkspace: (id, fallbackId) =>
    tx((s) => {
      const inWs = new Set(s.pages.filter((p) => p.workspaceId === id).map((p) => p.id));
      for (const p of s.pages) {
        if (p.workspaceId !== id) continue;
        if (!p.isArchived && !(p.parentId && inWs.has(p.parentId))) Object.assign(p, { isArchived: true, archivedAt: now() });
        p.workspaceId = fallbackId;
      }
      s.workspaces = s.workspaces!.filter((w) => w.id !== id);
    }),
  movePageToWorkspace: (id, workspaceId) =>
    tx((s) => {
      const ids = new Set([id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of s.pages) {
          if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
            ids.add(p.id);
            grew = true;
          }
        }
      }
      for (const p of s.pages) if (ids.has(p.id)) p.workspaceId = workspaceId;
      const top = s.pages.filter((p) => p.parentId === null && p.workspaceId === workspaceId && p.id !== id);
      return Object.assign(find(s, id), {
        parentId: null,
        sortOrder: Math.max(-1, ...top.map((p) => p.sortOrder)) + 1,
        updatedAt: now(),
      }).updatedAt;
    }),
  searchPages: (query, titleOnly) =>
    tx((s) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const text = (c: string | null) =>
        c ? [...c.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join(" ") : "";
      return s.pages.flatMap((p) => {
        const title = p.title.toLowerCase();
        const body = titleOnly ? "" : text(p.content);
        const lower = body.toLowerCase();
        if (!terms.every((t) => title.includes(t) || lower.includes(t))) return [];
        const at = terms.length ? lower.indexOf(terms[0]) : -1;
        const snippet =
          at < 0
            ? ""
            : (at > 40 ? "…" : "") +
              body.slice(Math.max(0, at - 40), at) +
              "\u0001" + body.slice(at, at + terms[0].length) + "\u0002" +
              body.slice(at + terms[0].length, at + 80) + "…";
        const rank = terms.every((t) => title.includes(t)) ? -10 : -1;
        return [{ pageId: p.id, snippet, rank }];
      });
    }),
  getAllMindmaps: () =>
    tx((s) =>
      (s.mindmaps ?? [])
        .map(({ nodes, ...m }) => ({ ...m, nodeCount: nodes.length }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
  getMindmapById: (id) => tx((s) => (s.mindmaps ?? []).find((m) => m.id === id) ?? null),
  createMindmap: (title, subjectTag) =>
    tx((s) => {
      const m: MindmapWithNodes = {
        id: crypto.randomUUID(),
        title,
        subjectTag,
        createdAt: now(),
        updatedAt: now(),
        nodeCount: 1,
        nodes: [{ id: "root", label: title, positionX: 0, positionY: 0, parentNodeId: null, linkedPageId: null, styleJson: '{"shape":"pill"}' }],
      };
      (s.mindmaps ??= []).push(m);
      return m;
    }),
  saveMindmap: (id, title, subjectTag, nodes) =>
    tx((s) => {
      const m = (s.mindmaps ?? []).find((x) => x.id === id);
      if (!m) throw new Error("mindmap not found");
      return Object.assign(m, { title, subjectTag, nodes, nodeCount: nodes.length, updatedAt: now() }).updatedAt;
    }),
  deleteMindmap: (id) =>
    tx((s) => {
      s.mindmaps = (s.mindmaps ?? []).filter((m) => m.id !== id);
    }),
  getSettings: () => tx((s) => ({ ...s.settings! })),
  setSetting: (key, value) =>
    tx((s) => {
      s.settings![key] = value;
    }),
  getStoragePath: () => Promise.resolve("Browser storage (localStorage)"),
  moveStorage: () => Promise.reject(new Error("Moving storage needs the desktop app")),
  getTabs: () => tx((s) => s.tabs),
  saveTabs: (tabs) =>
    tx((s) => {
      s.tabs = tabs;
    }),
};

export const api: Api = isTauri() ? tauriApi : localApi;
