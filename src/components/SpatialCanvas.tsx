import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  AppWindow,
  Boxes,
  ChevronRight,
  FileText,
  FolderInput,
  Crosshair,
  Filter,
  Lightbulb,
  ListChecks,
  Search,
  Maximize2,
  Minus,
  Palette,
  PenLine,
  Plus,
  Route,
  ScanSearch,
  Sparkles,
  Spline,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import {
  api,
  type CanvasEdge,
  type EdgeColor,
  type EdgeStyle,
  type Concept,
  type ConceptGroup,
  type ConceptResource,
  type GroupRect,
  type LinkEdge,
  type RelType,
  REL_TYPES,
} from "../data/api";
import { AtlasGuide } from "./AtlasGuide";
import { AtlasGroups, GROUP_HEADER } from "./AtlasGroups";
import { mapChecks, OPEN_CONCEPT, pendingConcept, setPendingConcept, isConceptId, prerequisites, REL_LABELS, SYMMETRIC_TYPES, trace, type TraceStep } from "../data/atlas";

/** Card filters: a card must match every active section; tags match all or any. */
type CardFilters = { tags: string[]; tagMode: "all" | "any"; states: Concept["state"][]; groups: string[] };
const NO_FILTERS: CardFilters = { tags: [], tagMode: "any", states: [], groups: [] };
import { ConceptInspector } from "./ConceptInspector";
import { AtlasLegend } from "./AtlasLegend";
import { MUTED_STROKE, PALETTE, REL_COLORS } from "../data/atlas";
import type { PageMeta } from "../data/workspace";
import { tagColor } from "../lib/colors";

type Point = { x: number; y: number };
type Camera = { x: number; y: number; k: number };
type Side = "top" | "right" | "bottom" | "left";

type SpatialCanvasProps = {
  /** Live pages: every one becomes a card. */
  pages: PageMeta[];
  activePageId: string | null;
  /** Bumped after saves, so new links show up. */
  version: number;
  /** Double-click: open the page in the document view. */
  onOpenPage: (pageId: string) => void;
  onOpenInNewTab: (pageId: string) => void;
  onCreatePage: () => void;
  onTogglePin: (pageId: string) => void;
  onTrashPage: (pageId: string) => void;
  workspaces: { id: string; name: string; icon: string }[];
  onMoveToWorkspace: (pageId: string, workspaceId: string) => void;
  /** Active workspace: its Atlas concepts share the map with its pages. */
  workspaceId: string;
};

/** Learning-state dot colors on concept cards. */
const STATE_DOT: Record<Concept["state"], string> = {
  unexplored: "#737373", learning: "#f59e0b", understood: "#38bdf8", mastered: "#22c55e", review: "#f43f5e",
};
const STATE_LABEL: Record<Concept["state"], string> = {
  unexplored: "New", learning: "Learning", understood: "Got it", mastered: "Mastered", review: "Review",
};

const CARD_W = 208;
const CARD_H = 60;
/** Note cards show the note itself (read-only), so they are bigger. */
const NOTE_W = 248;
const NOTE_H = 176;
type Size = { w: number; h: number };
const CARD: Size = { w: CARD_W, h: CARD_H };
const NOTE: Size = { w: NOTE_W, h: NOTE_H };
/** Room between a section's edge and the cards inside it. */
const GROUP_PAD = 24;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const GRID = 24;
/** The edge layer is a big SVG offset by this much so strokes stay hit-testable. */
const SVG_OFFSET = 50_000;

/** Notion's dark-mode palette, used for connection colors. */
export const EDGE_COLORS: Record<EdgeColor, { label: string; stroke: string }> = {
  default: { label: "Default", stroke: "#5a5a5a" },
  gray: { label: "Gray", stroke: "#9b9b9b" },
  brown: { label: "Brown", stroke: "#ba856f" },
  orange: { label: "Orange", stroke: "#c77d48" },
  yellow: { label: "Yellow", stroke: "#ca984d" },
  green: { label: "Green", stroke: "#529e72" },
  blue: { label: "Blue", stroke: "#5e87c9" },
  purple: { label: "Purple", stroke: "#9d68d3" },
  pink: { label: "Pink", stroke: "#d15796" },
  red: { label: "Red", stroke: "#df5452" },
};
const FOCUS_STROKE = "#38bdf8";
const DASH: Record<EdgeStyle, string | undefined> = {
  solid: undefined,
  dashed: "7 5",
  dotted: "0.5 5",
};

/** One drawn line: a document link and/or canvas connection between two cards. */
type VisualEdge = {
  /** `source>target` of the row that holds this line's label/color/style. */
  key: string;
  source: string;
  target: string;
  /** Links run both ways: arrowheads on both ends. */
  mutual: boolean;
  /** Drawn on the canvas (deletable) rather than only a document link. */
  manual: boolean;
  label: string;
  color: EdgeColor;
  style: EdgeStyle;
  relType: RelType;
};

/** Edge tag: the relationship type (unless plain "Related to") and its explanation. */
const edgeText = (e: VisualEdge) =>
  [e.relType !== "related" && REL_LABELS[e.relType], e.label].filter(Boolean).join(" · ");

const edgeKey = (s: string, t: string) => `${s}>${t}`;

/**
 * Oceanic's infinite canvas: every page as a floating card; document links
 * and canvas connections as curved arrows. Pan by dragging the background,
 * zoom with the wheel, drag cards to arrange them, drag from a card's edge
 * dot onto another card to connect them, click a line to label or style it,
 * double-click a card to open it.
 */
/** Saved Atlas view per workspace, restored when Atlas re-opens (also after a restart). */
type SavedView = { camera: Camera; selected: string | null; trail: string[] };
const VIEWS_KEY = "atlasViews";
const views = new Map<string, SavedView>();
let viewsLoaded = false;
let saveTimer = 0;
const saveViews = () => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => api.setSetting(VIEWS_KEY, JSON.stringify(Object.fromEntries(views))).catch(() => {}), 600);
};

export function SpatialCanvas({
  pages: pageList,
  activePageId,
  version,
  onOpenPage,
  onOpenInNewTab,
  onCreatePage,
  onTogglePin,
  onTrashPage,
  workspaces,
  onMoveToWorkspace,
  workspaceId,
}: SpatialCanvasProps) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [resources, setResources] = useState<ConceptResource[]>([]);
  const [conceptsLoaded, setConceptsLoaded] = useState(false);
  const [groups, setGroups] = useState<ConceptGroup[]>([]);
  /** Group whose name is being typed. */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  /** Focus View: the card in the middle, plus the trail that led here. */
  const lastView = views.get(workspaceId) ?? null;
  const [focusTrail, setFocusTrail] = useState<string[]>(lastView?.trail ?? []);
  const focus = focusTrail[focusTrail.length - 1] ?? null;
  // A restored Focus trail may point at concepts deleted since: drop them.
  useEffect(() => {
    if (!conceptsLoaded) return;
    const live = new Set(concepts.map((c) => c.id));
    if (focusTrail.some((id) => isConceptId(id) && !live.has(id)))
      setFocusTrail((t) => t.filter((id) => !isConceptId(id) || live.has(id)));
  }, [conceptsLoaded, concepts, focusTrail]);
  /** Times a concept entered Focus View (ticks the onboarding step). */
  const [focusCount, setFocusCount] = useState(0);
  useEffect(() => {
    if (focus && isConceptId(focus)) setFocusCount((n) => n + 1);
  }, [focus]);
  /** Relationship types hidden by the filter. */
  const [hiddenTypes, setHiddenTypes] = useState<Set<RelType>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  /** Map checks list, and findings the student chose to ignore (kept in settings). */
  const [checksOpen, setChecksOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.getSettings().then((s) => setIgnored(new Set(JSON.parse(s.atlasIgnoredChecks ?? "[]")))).catch(() => {});
  }, []);
  const ignore = (key: string) =>
    setIgnored((prev) => {
      const next = new Set(prev).add(key);
      api.setSetting("atlasIgnoredChecks", JSON.stringify([...next])).catch(() => {});
      return next;
    });
  const [query, setQuery] = useState("");
  /** Prerequisite pathway shown for this concept ("What should I understand first?"). */
  const [pathFor, setPathFor] = useState<string | null>(null);
  /** Card filters (tags, learning state, group); cards that don't match fade. Kept in settings. */
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS);
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (s.atlasFilters) setFilters({ ...NO_FILTERS, ...JSON.parse(s.atlasFilters) });
        if (s.atlasHiddenTypes) setHiddenTypes(new Set(JSON.parse(s.atlasHiddenTypes)));
      })
      .catch(() => {});
  }, []);
  const updateFilters = (f: CardFilters) => {
    setFilters(f);
    api.setSetting("atlasFilters", JSON.stringify(f)).catch(() => {});
  };
  const toggleType = (t: RelType) =>
    setHiddenTypes((h) => {
      const next = h.has(t) ? new Set([...h].filter((x) => x !== t)) : new Set([...h, t]);
      api.setSetting("atlasHiddenTypes", JSON.stringify([...next])).catch(() => {});
      return next;
    });
  /** Trace: `pick` is the start card while waiting for the user to click the end card. */
  const [tracePick, setTracePick] = useState<string | null>(null);
  const [traceAB, setTraceAB] = useState<{ a: string; b: string } | null>(null);
  useEffect(() => {
    if (!tracePick) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTracePick(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tracePick]);
  /** Read-only note text per page, fetched once the map is zoomed in far enough. */
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  /** True briefly while the camera eases to a programmatic target (fit, search, focus). */
  const [glide, setGlide] = useState(false);
  const glideTimer = useRef<number>(0);
  const glideTo = (cam: Camera) => {
    setGlide(true);
    setCamera(cam);
    clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => setGlide(false), 450);
  };
  /** Concept card whose title is being typed. */
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    api
      .listConcepts(workspaceId)
      .then((cs) => {
        setConcepts(cs);
        setConceptsLoaded(true);
      })
      .catch((e) => console.error("Loading concepts failed", e));
    api.listConceptGroups(workspaceId).then(setGroups).catch((e) => console.error("Loading groups failed", e));
    api.listConceptResources(workspaceId).then(setResources).catch((e) => console.error("Loading resources failed", e));
  }, [workspaceId, version]);
  /** Pages and concepts are both cards; concepts never orbit. */
  const pages = useMemo<PageMeta[]>(
    () => [
      ...pageList,
      ...concepts.map((c) => ({ id: c.id, icon: "💡", title: c.title, pinned: false, parentId: null, workspaceId: c.workspaceId })),
    ],
    [pageList, concepts],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Map<string, Point> | null>(null);
  const [docLinks, setDocLinks] = useState<LinkEdge[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [camera, setCamera] = useState<Camera>(lastView?.camera ?? { x: 0, y: 0, k: 1 });
  /** Semantic zoom: dots when far out, cards in the middle, note previews when close. */
  const level: "dot" | "card" | "preview" = camera.k < 0.6 ? "dot" : camera.k > 1.2 ? "preview" : "card";
  const noteIds = useMemo(() => new Set(pageList.map((p) => p.id)), [pageList]);
  /** Card footprint: notes are bigger (they show their text); everything is a dot when far out. */
  const sizeOf = (id: string): Size => (level !== "dot" && noteIds.has(id) ? NOTE : CARD);
  /** User-picked card colours (palette keys), kept in settings. */
  const [cardColors, setCardColors] = useState<Record<string, string>>({});
  useEffect(() => {
    api.getSettings().then((s) => setCardColors(JSON.parse(s.atlasCardColors ?? "{}"))).catch(() => {});
  }, []);
  const setCardColor = (id: string, color: string | null) =>
    setCardColors((prev) => {
      const next = { ...prev };
      if (color) next[id] = color;
      else delete next[id];
      api.setSetting("atlasCardColors", JSON.stringify(next)).catch(() => {});
      return next;
    });
  useEffect(() => {
    if (level === "dot") return;
    const missing = pageList.map((p) => p.id).filter((id) => !previews.has(id));
    if (!missing.length) return;
    api
      .getPagePreviews(missing, 2000)
      .then((rows) =>
        setPreviews((prev) => {
          const next = new Map(prev);
          for (const id of missing) next.set(id, rows.find((r) => r.id === id)?.text ?? "");
          return next;
        }),
      )
      .catch((e) => console.error("Loading previews failed", e));
  }, [level, pageList, previews]);
  // Saved notes change their text: refetch on the next zoom-in.
  useEffect(() => setPreviews(new Map()), [version]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [orbitT, setOrbitT] = useState(0);
  const pausedRef = useRef(false);
  // 0 = tucked into the parent, 1 = out on its orbit; eased toward the collapsed state each frame.
  const spread = useRef(new Map<string, number>());
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let moving = false;
      for (const [id, v] of spread.current) {
        const target = collapsedRef.current.has(id) ? 0 : 1;
        if (v === target) continue;
        moving = true;
        spread.current.set(id, target > v ? Math.min(1, v + dt * 2.5) : Math.max(0, v - dt * 2.5));
      }
      // Re-render for the hide/show animation even while the orbit is paused.
      if (moving) setOrbitT((t) => t + 1e-9);
      if (!pausedRef.current && !matchMedia("(prefers-reduced-motion: reduce)").matches) setOrbitT((t) => t + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(lastView ? lastView.selected : activePageId);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  /** In-progress connection: from a card's side to the cursor (world coords). */
  const [draft, setDraft] = useState<{ from: string; side: Side; to: Point; target: string | null } | null>(
    null,
  );
  const fitted = useRef(!!lastView);
  useEffect(() => {
    views.set(workspaceId, { camera, selected, trail: focusTrail });
    if (viewsLoaded) saveViews();
  }, [camera, selected, focusTrail, workspaceId]);
  // First open after launch: restore the view saved last session.
  useEffect(() => {
    if (viewsLoaded) return;
    api
      .getSettings()
      .then((s) => {
        const saved = JSON.parse(s[VIEWS_KEY] ?? "{}") as Record<string, SavedView>;
        for (const [ws, v] of Object.entries(saved)) if (!views.has(ws) || ws === workspaceId) views.set(ws, v);
        viewsLoaded = true;
        const v = saved[workspaceId];
        if (v && !pendingConcept) {
          fitted.current = true;
          setCamera(v.camera);
          setSelected(v.selected);
          setFocusTrail(v.trail ?? []);
        }
      })
      .catch(() => (viewsLoaded = true));
  }, []);
  /** "New page here": where the next new card should land (world coords). */
  const pendingPlacement = useRef<Point | null>(null);
  /** Set after the first layout pass; later arrivals are new pages. */
  const placedOnce = useRef(false);

  const pageIds = useMemo(() => new Set(pages.map((p) => p.id)), [pages]);

  /* ------------------------------------------------------------ data */
  useEffect(() => {
    Promise.all([api.getLinks(), api.getCanvasEdges()])
      .then(([links, edges]) => {
        setDocLinks(links);
        setCanvasEdges(edges);
        setLinksLoaded(true);
      })
      .catch((e) => console.error("Loading links failed", e));
  }, [version]);

  useEffect(() => {
    api
      .getCanvasPositions()
      .then((saved) => setPositions(new Map(saved.map((p) => [p.pageId, { x: p.x, y: p.y }]))))
      .catch((e) => {
        console.error("Loading canvas failed", e);
        setPositions(new Map());
      });
  }, []);

  /** Document links + drawn connections, merged into one line per page pair. */
  const edges = useMemo(() => {
    const meta = new Map(canvasEdges.map((e) => [edgeKey(e.sourceId, e.targetId), e]));
    const directed = new Set<string>();
    for (const l of docLinks) directed.add(edgeKey(l.sourceId, l.targetId));
    for (const e of canvasEdges) if (e.manual) directed.add(edgeKey(e.sourceId, e.targetId));

    const byPair = new Map<string, VisualEdge>();
    for (const key of directed) {
      const [s, t] = key.split(">");
      if (!pageIds.has(s) || !pageIds.has(t) || s === t) continue;
      const pair = s < t ? `${s}|${t}` : `${t}|${s}`;
      const existing = byPair.get(pair);
      const m = meta.get(key);
      if (existing) {
        existing.mutual = true;
        existing.manual ||= !!m?.manual;
        continue;
      }
      byPair.set(pair, {
        key,
        source: s,
        target: t,
        mutual: false,
        manual: !!m?.manual,
        label: m?.label ?? "",
        color: m?.color ?? "default",
        style: m?.style ?? "solid",
        relType: m?.relType ?? "related",
      });
    }
    return [...byPair.values()];
  }, [docLinks, canvasEdges, pageIds]);

  const layoutLinks = useMemo(
    () => edges.map((e) => ({ sourceId: e.source, targetId: e.target })),
    [edges],
  );

  // New pages (or a first visit) get laid out around the ones already placed.
  useEffect(() => {
    // Wait for links too, so first-time layout clusters linked pages.
    if (!positions || !linksLoaded) return;
    const missing = pages.filter((p) => !positions.has(p.id));
    const firstPass = !placedOnce.current;
    placedOnce.current = true;
    if (!missing.length) return;
    const seeded = new Map(positions);
    if (pendingPlacement.current) {
      seeded.set(missing[missing.length - 1].id, pendingPlacement.current);
      pendingPlacement.current = null;
    } else if (!firstPass && viewport.current) {
      // Created while the canvas is open (e.g. from the sidebar): drop it in
      // the middle of what's on screen instead of wherever layout puts it.
      const r = viewport.current.getBoundingClientRect();
      const center = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      for (const p of missing) seeded.set(p.id, freeSlot(center, [...seeded.values()]));
    }
    const next = autoLayout(pages, layoutLinks, seeded);
    setPositions(next);
    api
      .saveCanvasPositions(missing.map((p) => ({ pageId: p.id, ...next.get(p.id)! })))
      .catch((e) => console.error("Saving canvas failed", e));
  }, [pages, layoutLinks, linksLoaded, positions]);

  /* ---------------------------------------------------------- camera */
  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el || !positions || !positions.size) return;
    const pts = pages.map((p) => positions.get(p.id)).filter((p): p is Point => !!p);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x)) - NOTE_W / 2 - 60;
    const maxX = Math.max(...pts.map((p) => p.x)) + NOTE_W / 2 + 60;
    const minY = Math.min(...pts.map((p) => p.y)) - NOTE_H / 2 - 60;
    const maxY = Math.max(...pts.map((p) => p.y)) + NOTE_H / 2 + 60;
    // Keep clear of side overlays (tutorial, inspector) when there is room to.
    const vp = el.getBoundingClientRect();
    let left = 0;
    let right = 0;
    el.querySelectorAll<HTMLElement>("[data-atlas-overlay]").forEach((o) => {
      const r = o.getBoundingClientRect();
      if (r.left + r.width / 2 < vp.left + vp.width / 2) left = Math.max(left, r.right - vp.left);
      else right = Math.max(right, vp.right - r.left);
    });
    if (el.clientWidth - left - right < 280) left = right = 0;
    const w = el.clientWidth - left - right;
    const k = clamp(Math.min(w / (maxX - minX), el.clientHeight / (maxY - minY)), MIN_ZOOM, 1.2);
    glideTo({
      k,
      x: left + w / 2 - ((minX + maxX) / 2) * k,
      y: el.clientHeight / 2 - ((minY + maxY) / 2) * k,
    });
  }, [pages, positions]);

  useEffect(() => {
    if (!fitted.current && positions && pages.every((p) => positions.has(p.id))) {
      fitted.current = true;
      fit();
    }
  }, [positions, pages, fit]);

  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  const zoomAt = (factor: number, sx: number, sy: number) =>
    setCamera((c) => {
      const k = clamp(c.k * factor, MIN_ZOOM, MAX_ZOOM);
      return { k, x: sx - ((sx - c.x) * k) / c.k, y: sy - ((sy - c.y) * k) / c.k };
    });

  const zoomCenter = (factor: number) => {
    const el = viewport.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".oc-edge-popover")) return;
      // Scrolling a note card's text scrolls the text, not the map.
      const note = (e.target as HTMLElement).closest<HTMLElement>(".oc-note-scroll");
      if (note && note.scrollHeight > note.clientHeight) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** World point at the middle of the visible map. */
  const viewCenter = (): Point => {
    const el = viewport.current;
    return el ? { x: (el.clientWidth / 2 - camera.x) / camera.k, y: (el.clientHeight / 2 - camera.y) / camera.k } : { x: 0, y: 0 };
  };

  /** Screen (client) coordinates → world coordinates. */
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.k, y: (clientY - rect.top - camera.y) / camera.k };
  };

  /** The card under a world point, if any. */
  const cardAt = (p: Point, except?: string) =>
    pages.find((page) => {
      const c = positions?.get(page.id);
      const s = sizeOf(page.id);
      return c && page.id !== except && Math.abs(p.x - c.x) <= s.w / 2 && Math.abs(p.y - c.y) <= s.h / 2;
    })?.id ?? null;

  /* ---------------------------------------------- pan, drag, connect */
  const gesture = useRef<
    | { kind: "pan"; startX: number; startY: number; cam: Camera }
    | { kind: "card"; id: string; startX: number; startY: number; origin: Point; moved: boolean; last?: Point }
    | { kind: "connect"; from: string; side: Side }
    | { kind: "group"; id: string; startX: number; startY: number; rect: GroupRect; members: [string, Point][]; d?: Point }
    | { kind: "resize"; id: string; startX: number; startY: number; rect: GroupRect; last?: GroupRect }
    | null
  >(null);

  const onGroupHeaderDown = (e: PointerEvent, g: ConceptGroup) => {
    const rect = rectOf(g);
    if (e.button !== 0 || !positions || !rect) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const members = membersOf(g.id).flatMap((id) => (positions.has(id) ? [[id, positions.get(id)!] as [string, Point]] : []));
    gesture.current = { kind: "group", id: g.id, startX: e.clientX, startY: e.clientY, rect, members };
    setSelected(null);
  };
  const onGroupResizeDown = (e: PointerEvent, g: ConceptGroup) => {
    const rect = rectOf(g);
    if (e.button !== 0 || !rect) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "resize", id: g.id, startX: e.clientX, startY: e.clientY, rect };
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, cam: camera };
    setSelected(null);
    setTracePick(null);
    setEditingEdge(null);
  };

  const onCardDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || !positions) return;
    e.stopPropagation();
    if (tracePick) {
      if (id !== tracePick) startTrace(tracePick, id);
      setTracePick(null);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = {
      kind: "card",
      id,
      startX: e.clientX,
      startY: e.clientY,
      origin: positions.get(id)!,
      moved: false,
    };
    setSelected(id);
    setEditingEdge(null);
  };

  const onHandleDown = (e: PointerEvent, id: string, side: Side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "connect", from: id, side };
    setDraft({ from: id, side, to: toWorld(e.clientX, e.clientY), target: null });
    setEditingEdge(null);
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "connect") {
      const to = toWorld(e.clientX, e.clientY);
      setDraft({ from: g.from, side: g.side, to, target: cardAt(to, g.from) });
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.kind === "pan") {
      setCamera({ ...g.cam, x: g.cam.x + dx, y: g.cam.y + dy });
    } else if (g.kind === "group") {
      const [wx, wy] = [dx / camera.k, dy / camera.k];
      g.d = { x: wx, y: wy };
      setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, rect: { ...g.rect, x: g.rect.x + wx, y: g.rect.y + wy } } : x)));
      setPositions((prev) => {
        const next = new Map(prev);
        for (const [id, o] of g.members) next.set(id, { x: o.x + wx, y: o.y + wy });
        return next;
      });
    } else if (g.kind === "resize") {
      const rect = { ...g.rect, w: Math.max(160, g.rect.w + dx / camera.k), h: Math.max(100, g.rect.h + dy / camera.k) };
      g.last = rect;
      setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, rect } : x)));
    } else {
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      const at = { x: g.origin.x + dx / camera.k, y: g.origin.y + dy / camera.k };
      g.last = at;
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(g.id, at);
        return next;
      });
      const target = groupAtPoint(at, groupOfCard(g.id)?.id ?? null);
      setDropGroup(target?.id ?? null);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "group" && g.d) {
      const d = g.d;
      const grp = groups.find((x) => x.id === g.id);
      if (grp) saveLayout(grp, { rect: { ...g.rect, x: g.rect.x + d.x, y: g.rect.y + d.y } });
      api
        .saveCanvasPositions(g.members.map(([id, o]) => ({ pageId: id, x: o.x + d.x, y: o.y + d.y })))
        .catch((e) => console.error("Saving canvas failed", e));
    }
    if (g?.kind === "resize" && g.last && positions) {
      const grp = groups.find((x) => x.id === g.id);
      if (grp) saveLayout(grp, { rect: grownToFit(grp, g.last, positions) });
    }
    if (g?.kind === "card" && g.moved && positions) {
      const p = g.last ?? positions.get(g.id)!;
      const target = groups.find((x) => x.id === dropRef.current) ?? null;
      setDropGroup(null);
      const cur = groupOfCard(g.id);
      const curRect = cur ? rectOf(cur) : undefined;
      const inside = !!curRect && p.x > curRect.x && p.x < curRect.x + curRect.w && p.y > curRect.y && p.y < curRect.y + curRect.h;
      const title = pages.find((x) => x.id === g.id)?.title || "this card";
      const putBack = () => setPositions((prev) => new Map(prev).set(g.id, g.origin));
      if (cur && !inside && !window.confirm(`Take "${title}" out of the group "${cur.name}"?`)) return putBack();
      api.saveCanvasPositions([{ pageId: g.id, x: p.x, y: p.y }]).catch((e) => console.error("Saving canvas failed", e));
      const into = target ?? (cur && inside ? cur : null);
      if (into !== cur) void setGroupOf(g.id, into?.id ?? null);
      // The section grows so the card fits inside it.
      if (into) {
        const r = rectOf(into);
        const s = sizeOf(g.id);
        if (r) {
          const x = Math.min(r.x, p.x - s.w / 2 - GROUP_PAD);
          const y = Math.min(r.y, p.y - s.h / 2 - GROUP_PAD - GROUP_HEADER);
          const rect = { x, y, w: Math.max(r.x + r.w, p.x + s.w / 2 + GROUP_PAD) - x, h: Math.max(r.y + r.h, p.y + s.h / 2 + GROUP_PAD) - y };
          if (rect.x !== r.x || rect.y !== r.y || rect.w !== r.w || rect.h !== r.h) saveLayout(into, { rect });
        }
      }
    }
    if (g?.kind === "connect") {
      const target = draft?.target;
      setDraft(null);
      if (target) connect(g.from, target);
    }
  };

  /** Drop-to-connect: persist, then show it straight away. */
  const connect = (from: string, to: string) => {
    api
      .connectPages(from, to)
      .then((edge) => {
        setCanvasEdges((prev) => [
          ...prev.filter((e) => edgeKey(e.sourceId, e.targetId) !== edgeKey(from, to)),
          edge,
        ]);
        setEditingEdge(edgeKey(from, to)); // pick the relationship type straight away
      })
      .catch((e) => console.error("Connecting pages failed", e));
  };

  /** Label / color / style change: optimistic, then saved. */
  const updateEdge = (key: string, patch: Partial<Pick<CanvasEdge, "label" | "color" | "style" | "relType">>) => {
    const [source, target] = key.split(">");
    const current = edges.find((e) => e.key === key);
    if (!current) return;
    const next = { label: current.label, color: current.color, style: current.style, relType: current.relType, ...patch };
    setCanvasEdges((prev) => {
      const existing = prev.find((e) => edgeKey(e.sourceId, e.targetId) === key);
      return existing
        ? prev.map((e) => (e === existing ? { ...e, ...next } : e))
        : [...prev, { sourceId: source, targetId: target, manual: false, ...next }];
    });
    api.updateCanvasEdge(source, target, next).catch((e) => console.error("Saving connection failed", e));
  };

  /** Removes the drawn connection(s) between a pair; document links stay. */
  const deleteEdge = (edge: VisualEdge) => {
    const keys = [edgeKey(edge.source, edge.target), edgeKey(edge.target, edge.source)];
    const drawn = canvasEdges.filter((e) => e.manual && keys.includes(edgeKey(e.sourceId, e.targetId)));
    setCanvasEdges((prev) => prev.filter((e) => !drawn.includes(e)));
    setEditingEdge(null);
    drawn.forEach((e) =>
      api.deleteCanvasEdge(e.sourceId, e.targetId).catch((err) => console.error("Deleting connection failed", err)),
    );
  };

  /** New concept card (at `at`, world coords), then type its title. */
  const newConcept = (at?: Point) =>
    api
      .createConcept(workspaceId, "New concept")
      .then((c) => {
        if (at) pendingPlacement.current = at;
        setConcepts((prev) => [...prev, c]);
        setRenaming(c.id);
      })
      .catch((e) => console.error("Creating concept failed", e));

  /* ---------------------------------------------- groups */
  /** Puts a concept or note in a group (or takes it out with `null`). */
  const setGroupOf = (id: string, groupId: string | null) =>
    isConceptId(id)
      ? api
          .setConceptGroup(id, groupId)
          .then((u) => setConcepts((prev) => prev.map((x) => (x.id === id ? u : x))))
          .catch((e) => console.error("Grouping failed", e))
      : api
          .setPageGroup(id, groupId)
          .then(() =>
            setGroups((prev) =>
              prev.map((g) => ({ ...g, pageIds: g.id === groupId ? [...g.pageIds.filter((p) => p !== id), id] : g.pageIds.filter((p) => p !== id) })),
            ),
          )
          .catch((e) => console.error("Grouping failed", e));
  /** New group holding card `id` (or empty, boxed at `at`), name ready to type. */
  const newGroupWith = (id: string | null, at?: Point) =>
    api
      .createConceptGroup(workspaceId, "New group")
      .then(async (g) => {
        if (at) g = await api.layoutConceptGroup(g.id, null, { x: at.x - 200, y: at.y - 130, w: 400, h: 260 });
        setGroups((prev) => [...prev, g]);
        setRenamingGroup(g.id);
        if (id) await setGroupOf(id, g.id);
      })
      .catch((e) => console.error("Creating group failed", e));
  const groupOfCard = (id: string) =>
    groups.find((g) => (isConceptId(id) ? concepts.find((c) => c.id === id)?.groupId === g.id : g.pageIds.includes(id))) ?? null;
  const tintOf = (g: ConceptGroup) => (g.color && PALETTE[g.color] ? PALETTE[g.color].color : tagColor(g.id).solid);
  /** Smallest section box around `ids` (at `pos`), or undefined when none are placed. */
  const boxAround = (ids: string[], pos: Map<string, Point>): GroupRect | undefined => {
    const boxes = ids.flatMap((id) => {
      const p = pos.get(id);
      const s = sizeOf(id);
      return p ? [{ x0: p.x - s.w / 2, y0: p.y - s.h / 2, x1: p.x + s.w / 2, y1: p.y + s.h / 2 }] : [];
    });
    if (!boxes.length) return undefined;
    const x = Math.min(...boxes.map((b) => b.x0)) - GROUP_PAD;
    const y = Math.min(...boxes.map((b) => b.y0)) - GROUP_PAD - GROUP_HEADER;
    return { x, y, w: Math.max(...boxes.map((b) => b.x1)) + GROUP_PAD - x, h: Math.max(...boxes.map((b) => b.y1)) + GROUP_PAD - y };
  };
  /** `r` grown (never shrunk) so every member fits inside. */
  const grownToFit = (g: ConceptGroup, r: GroupRect, pos: Map<string, Point>): GroupRect => {
    const b = boxAround(membersOf(g.id), pos);
    if (!b) return r;
    const x = Math.min(r.x, b.x);
    const y = Math.min(r.y, b.y);
    return { x, y, w: Math.max(r.x + r.w, b.x + b.w) - x, h: Math.max(r.y + r.h, b.y + b.h) - y };
  };
  const rectOf = (g: ConceptGroup) => g.rect ?? (positions ? boxAround(membersOf(g.id), positions) : undefined);
  const saveLayout = (g: ConceptGroup, patch: { color?: string | null; rect?: GroupRect }) => {
    const color = patch.color !== undefined ? patch.color : g.color;
    const rect = patch.rect ?? g.rect;
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, color, rect } : x)));
    api.layoutConceptGroup(g.id, color, rect).catch((e) => console.error("Saving group failed", e));
  };
  // Groups from before sections had a box: box each one around its members once.
  useEffect(() => {
    if (!positions || !conceptsLoaded) return;
    for (const g of groups) {
      if (g.rect) continue;
      const r = boxAround(membersOf(g.id), positions);
      if (r) saveLayout(g, { rect: r });
    }
  }, [groups, positions, conceptsLoaded]);
  /** Group a dragged card would join if dropped now. */
  const [dropGroup, setDropGroupState] = useState<string | null>(null);
  /** Same value, readable in the pointer-up handler before React re-renders. */
  const dropRef = useRef<string | null>(null);
  const setDropGroup = (id: string | null) => ((dropRef.current = id), setDropGroupState(id));
  const groupAtPoint = (p: Point, except: string | null) =>
    [...groups].reverse().find((g) => {
      const r = !g.collapsed && g.id !== except ? rectOf(g) : undefined;
      return r && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
    }) ?? null;
  const saveGroup = (g: ConceptGroup, patch: Partial<Pick<ConceptGroup, "name" | "collapsed">>) =>
    api
      .updateConceptGroup(g.id, { name: patch.name ?? g.name, collapsed: patch.collapsed ?? g.collapsed })
      .then((u) => setGroups((prev) => prev.map((x) => (x.id === g.id ? u : x))))
      .catch((e) => console.error("Saving group failed", e));
  const deleteGroup = (g: ConceptGroup) =>
    api
      .deleteConceptGroup(g.id)
      .then(() => {
        setGroups((prev) => prev.filter((x) => x.id !== g.id));
        setConcepts((prev) => prev.map((c) => (c.groupId === g.id ? { ...c, groupId: null } : c)));
      })
      .catch((e) => console.error("Deleting group failed", e));
  function membersOf(groupId: string) {
    const notes = groups.find((g) => g.id === groupId)?.pageIds.filter((id) => noteIds.has(id)) ?? [];
    return [...concepts.filter((c) => c.groupId === groupId).map((c) => c.id), ...notes];
  }

  const saveConcept = (id: string, patch: Pick<Concept, "title" | "description" | "tags" | "state">) =>
    api
      .updateConcept(id, patch)
      .then((u) => setConcepts((prev) => prev.map((x) => (x.id === id ? u : x))))
      .catch((e) => console.error("Saving concept failed", e));

  const renameConcept = (id: string, title: string) => {
    setRenaming(null);
    const c = concepts.find((x) => x.id === id);
    if (c && title.trim() && title.trim() !== c.title) saveConcept(id, { ...c, title });
  };

  const attachResource = (conceptId: string, entryId: string) =>
    api
      .attachResource(conceptId, entryId)
      .then(() => setResources((prev) => [...prev, { conceptId, entryId, createdAt: new Date().toISOString() }]))
      .catch((e) => console.error("Attaching resource failed", e));

  const detachResource = (conceptId: string, entryId: string) =>
    api
      .detachResource(conceptId, entryId)
      .then(() => setResources((prev) => prev.filter((r) => !(r.conceptId === conceptId && r.entryId === entryId))))
      .catch((e) => console.error("Removing resource link failed", e));

  const deleteConcept = (id: string) =>
    api
      .deleteConcept(id)
      .then(() => {
        setConcepts((prev) => prev.filter((c) => c.id !== id));
        setResources((prev) => prev.filter((r) => r.conceptId !== id));
        setCanvasEdges((prev) => prev.filter((e) => e.sourceId !== id && e.targetId !== id));
      })
      .catch((e) => console.error("Deleting concept failed", e));

  /** Centers the camera on a card and selects it. */
  const panTo = (id: string) => {
    const p = positions?.get(id);
    const el = viewport.current;
    if (p && el) glideTo({ k: camera.k, x: el.clientWidth / 2 - p.x * camera.k, y: el.clientHeight / 2 - p.y * camera.k });
    setSelected(id);
  };

  const enterFocus = (id: string) => {
    setFocusTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
    panTo(id);
  };

  // A concept picked in search: centre and select it once its card is placed.
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => {
    const on = () => setRevealTick((n) => n + 1);
    window.addEventListener(OPEN_CONCEPT, on);
    return () => window.removeEventListener(OPEN_CONCEPT, on);
  }, []);
  useEffect(() => {
    const id = pendingConcept;
    if (!id || !positions?.has(id)) return;
    setPendingConcept(null);
    // Inside a collapsed group: open it so the card is visible.
    const g = groups.find((x) => x.collapsed && x.id === concepts.find((c) => c.id === id)?.groupId);
    if (g) saveGroup(g, { collapsed: false });
    fitted.current = true;
    setFocusTrail([]);
    panTo(id);
  }, [positions, revealTick]);

  /** "Tidy up": forget every position and lay the whole graph out again. */
  const relayout = () => {
    const next = autoLayout(pages, layoutLinks, new Map());
    setPositions(next);
    fitted.current = false;
    api
      .saveCanvasPositions([...next].map(([pageId, p]) => ({ pageId, ...p })))
      .catch((e) => console.error("Saving canvas failed", e));
  };

  // Escape cancels a connection in progress or closes the edge popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      gesture.current = null;
      setDraft(null);
      setEditingEdge(null);
      if (!(e.target as HTMLElement).closest("input, textarea")) {
        setPathFor(null);
        setFocusTrail((t) => t.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ----------------------------------------------------- right-click */
  const backgroundMenu = (e: React.MouseEvent) => {
    const at = toWorld(e.clientX, e.clientY);
    openContextMenu(e, [
      { label: "New concept here", icon: <Lightbulb className="size-4" />, onSelect: () => newConcept(at) },
      {
        label: "New page here",
        icon: <Plus className="size-4" />,
        onSelect: () => {
          pendingPlacement.current = at;
          onCreatePage();
        },
      },
      "divider",
      { label: "Fit to screen", icon: <Maximize2 className="size-4" />, onSelect: fit },
      { label: "Reset zoom", icon: <ScanSearch className="size-4" />, onSelect: () => zoomCenter(1 / camera.k) },
      { label: "Tidy up", icon: <Sparkles className="size-4" />, onSelect: relayout },
    ]);
  };

  /** Show the shortest path from a to b; open any collapsed group it passes through. */
  const startTrace = (a: string, b: string) => {
    setTraceAB({ a, b });
    setFocusTrail([]);
    setPathFor(null);
    const steps = trace(traceEdges, a, b);
    const ids = steps ? [a, ...steps.map((s) => s.to)] : [a, b];
    for (const g of groups) if (g.collapsed && ids.some((id) => groupOfCard(id)?.id === g.id)) saveGroup(g, { collapsed: false });
  };
  const traceItem = (id: string): MenuItem => ({
    label: "Trace to…",
    icon: <Route className="size-4" />,
    onSelect: () => (setSelected(id), setTracePick(id)),
  });

  const groupItem = (id: string): MenuItem => {
    const cur = groupOfCard(id);
    return {
      label: "Add to group",
      icon: <Boxes className="size-4" />,
      children: [
        ...groups.map((g) => ({ label: g.name, checked: cur?.id === g.id, onSelect: () => addToGroup(id, g) })),
        ...(groups.length ? (["divider"] as const) : []),
        { label: "New group…", icon: <Plus className="size-4" />, onSelect: () => newGroupWith(id) },
        ...(cur ? [{ label: "Remove from group", icon: <X className="size-4" />, onSelect: () => setGroupOf(id, null) }] : []),
      ],
    };
  };
  /** Menu "Add to group": join, and move the card into the section if it sits outside. */
  const addToGroup = (id: string, g: ConceptGroup) => {
    void setGroupOf(id, g.id);
    const r = rectOf(g);
    const p = positions?.get(id);
    if (!r || !p) return;
    const s = sizeOf(id);
    const inside = p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
    if (inside) return;
    // Drop it below the section's current contents, then grow the section.
    const at = { x: r.x + GROUP_PAD + s.w / 2, y: r.y + r.h + s.h / 2 };
    setPositions((prev) => new Map(prev).set(id, at));
    api.saveCanvasPositions([{ pageId: id, ...at }]).catch(() => {});
    saveLayout(g, { rect: { ...r, h: r.h + s.h + GROUP_PAD } });
  };

  const cardMenu = (e: React.MouseEvent, page: PageMeta) =>
    openContextMenu(e, isConceptId(page.id) ? [
      { label: "Focus", icon: <Crosshair className="size-4" />, onSelect: () => enterFocus(page.id) },
      { label: "Rename", icon: <PenLine className="size-4" />, onSelect: () => setRenaming(page.id) },
      traceItem(page.id),
      groupItem(page.id),
      "divider",
      { label: "Delete concept", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => deleteConcept(page.id) },
    ] : [
      { label: "Open", icon: <FileText className="size-4" />, onSelect: () => onOpenPage(page.id) },
      { label: "Open in new tab", icon: <AppWindow className="size-4" />, onSelect: () => onOpenInNewTab(page.id) },
      traceItem(page.id),
      groupItem(page.id),
      "divider",
      {
        label: page.pinned ? "Remove from Favorites" : "Add to Favorites",
        icon: <Star className="size-4" />,
        onSelect: () => onTogglePin(page.id),
      },
      {
        label: "Move to",
        icon: <FolderInput className="size-4" />,
        disabled: workspaces.length < 2,
        children: workspaces
          .filter((w) => w.id !== page.workspaceId)
          .map((w) => ({
            label: w.name,
            icon: <span className="w-4 text-center text-[13px]">{w.icon}</span>,
            onSelect: () => onMoveToWorkspace(page.id, w.id),
          })),
      },
      "divider",
      {
        label: "Move to Trash",
        icon: <Trash2 className="size-4" />,
        danger: true,
        onSelect: () => onTrashPage(page.id),
      },
    ]);

  const edgeMenu = (e: React.MouseEvent, edge: VisualEdge) =>
    openContextMenu(e, [
      {
        label: "Edit relationship",
        icon: <PenLine className="size-4" />,
        onSelect: () => setEditingEdge(edge.key),
      },
      {
        label: "Color",
        icon: <Palette className="size-4" />,
        children: (Object.entries(EDGE_COLORS) as [EdgeColor, (typeof EDGE_COLORS)[EdgeColor]][]).map(
          ([id, c]): MenuItem => ({
            label: c.label,
            icon: <span className="block h-0.5 w-3.5 rounded-full" style={{ backgroundColor: c.stroke }} />,
            checked: edge.color === id,
            onSelect: () => updateEdge(edge.key, { color: id }),
          }),
        ),
      },
      {
        label: "Line style",
        icon: <Spline className="size-4" />,
        children: (["solid", "dashed", "dotted"] as const).map(
          (style): MenuItem => ({
            label: style[0].toUpperCase() + style.slice(1),
            icon: (
              <svg width="16" height="4">
                <line x1="1" y1="2" x2="15" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={DASH[style] && (style === "dashed" ? "4 3" : "0.5 3")} />
              </svg>
            ),
            checked: edge.style === style,
            onSelect: () => updateEdge(edge.key, { style }),
          }),
        ),
      },
      ...(edge.manual
        ? (["divider", {
            label: "Delete connection",
            icon: <Trash2 className="size-4" />,
            danger: true,
            onSelect: () => deleteEdge(edge),
          }] as MenuItem[])
        : []),
    ]);

  /* ---------------------------------------------------------- render */
  const hoverPair = hoveredEdge ? edges.find((e) => e.key === hoveredEdge) : undefined;
  // ---- Orbits: child pages circle their parent (one turn per minute, paused on hover).
  const byId = new Map(pages.map((p) => [p.id, p]));
  const kids = new Map<string, PageMeta[]>();
  for (const p of pages) if (p.parentId && byId.has(p.parentId)) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p]);
  const orbiting = (id: string) => {
    const parent = byId.get(id)?.parentId;
    return !!parent && byId.has(parent);
  };
  /** Hidden when any ancestor on the canvas is collapsed. */
  const spreadOf = (id: string) => {
    if (!spread.current.has(id)) spread.current.set(id, collapsed.has(id) ? 0 : 1);
    return spread.current.get(id)!;
  };
  const ease = (v: number) => 1 - Math.pow(1 - v, 3);
  const depthOf = (id: string): number => (orbiting(id) ? 1 + depthOf(byId.get(id)!.parentId!) : 0);
  const shown = new Map<string, Point>();
  const place = (id: string, at: Point) => {
    shown.set(id, at);
    const e = ease(spreadOf(id));
    const list = e > 0.01 ? kids.get(id) ?? [] : [];
    const r = ((depthOf(id) ? 120 : 170) + list.length * 8) * e;
    list.forEach((c, i) => {
      const a = (i / list.length) * Math.PI * 2 + (orbitT / 60) * Math.PI * 2 * (depthOf(id) % 2 ? -1 : 1);
      place(c.id, { x: at.x + Math.cos(a) * r * 1.25, y: at.y + Math.sin(a) * r * 0.8 });
    });
  };
  if (positions) for (const p of pages) if (!orbiting(p.id) && positions.has(p.id)) place(p.id, positions.get(p.id)!);
  const tint = (id: string) => tagColor(id);

  // Collapsed groups: members hide and one summary card sits at their centre.
  const collapsedTo = new Map<string, string>();
  for (const g of groups) {
    if (!g.collapsed) continue;
    const ids = membersOf(g.id).filter((id) => shown.has(id));
    const r = rectOf(g);
    if (!r) continue;
    shown.set(g.id, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    for (const id of ids) (shown.delete(id), collapsedTo.set(id, g.id));
  }
  /** Every edge is drawn; types switched off in the filter are greyed out and ignored by Focus.
   *  Lines into a collapsed group end at its summary card (one per pair, inner lines hidden). */
  const shownEdges = collapsedTo.size
    ? [
        ...new Map(
          edges
            .map((e) => ({ ...e, source: collapsedTo.get(e.source) ?? e.source, target: collapsedTo.get(e.target) ?? e.target }))
            .filter((e) => e.source !== e.target)
            .map((e) => [[e.source, e.target].sort().join("|"), e] as const),
        ).values(),
      ]
    : edges;
  const activeEdges = shownEdges.filter((e) => !hiddenTypes.has(e.relType));
  /** In Focus View, only the focused card and its direct neighbours stay bright. */
  const inFocus = focus
    ? new Set([focus, ...activeEdges.flatMap((e) => (e.source === focus ? [e.target] : e.target === focus ? [e.source] : []))])
    : null;
  const path = pathFor ? prerequisites(canvasEdges, pathFor) : null;
  const findings = mapChecks(concepts, canvasEdges.filter((e) => e.manual), new Set(resources.map((r) => r.conceptId))).filter(
    (f) => !ignored.has(f.key),
  );
  const inPath = path ? new Set([pathFor!, ...path.order]) : null;
  /** Trace follows every relationship type the filter shows, in either direction. */
  const traceEdges = canvasEdges.filter((e) => !hiddenTypes.has(e.relType));
  const traceSteps = traceAB ? trace(traceEdges, traceAB.a, traceAB.b) : null;
  const inTrace = traceAB ? new Set(traceSteps ? [traceAB.a, ...traceSteps.map((s) => s.to)] : [traceAB.a, traceAB.b]) : null;
  const traceKeys = new Set((traceSteps ?? []).map((s) => [s.edge.sourceId, s.edge.targetId].sort().join("|")));
  /** Cards kept bright: a trace wins over the pathway, which wins over Focus View. */
  const bright = inTrace ?? inPath ?? inFocus;
  /** Cards that don't match the card filters (they fade). */
  const filterCount = filters.tags.length + filters.states.length + filters.groups.length + hiddenTypes.size;
  const filteredOut = (id: string) => {
    const c = concepts.find((x) => x.id === id);
    const tags = (c ? c.tags : pages.find((p) => p.id === id)?.tags) ?? [];
    if (filters.tags.length && !(filters.tagMode === "all" ? filters.tags.every((t) => tags.includes(t)) : filters.tags.some((t) => tags.includes(t))))
      return true;
    if (filters.states.length && !(c && filters.states.includes(c.state))) return true;
    if (filters.groups.length && !filters.groups.includes(groupOfCard(id)?.id ?? "")) return true;
    return false;
  };
  const allTags = [...new Set([...concepts.flatMap((c) => c.tags), ...pageList.flatMap((p) => p.tags ?? [])])].sort();
  const q = query.trim().toLowerCase();
  const hits = q
    ? pages
        .filter((p) => {
          const c = concepts.find((x) => x.id === p.id);
          return [p.title, c?.description, ...(c?.tags ?? [])].some((t) => t?.toLowerCase().includes(q));
        })
        .slice(0, 8)
    : [];
  const focusCards = new Set<string>(
    hoverPair
      ? [hoverPair.source, hoverPair.target]
      : [hovered ?? selected].filter((x): x is string => !!x),
  );
  if (draft) {
    focusCards.add(draft.from);
    if (draft.target) focusCards.add(draft.target);
  }
  /** Hovered or selected card plus its neighbours; everything else fades a little. */
  const hub = !bright && !draft && !hoverPair ? (hovered ?? selected) : null;
  const near = hub ? new Set([hub, ...activeEdges.flatMap((e) => (e.source === hub ? [e.target] : e.target === hub ? [e.source] : []))]) : null;
  const dimmed = near && near.size > 1 ? near : null;
  const degree = (id: string) => edges.filter((e) => e.source === id || e.target === id).length;
  /** Dot radius in world units: constant on screen, a little bigger for well-connected nodes. */
  const dotR = (id: string) => (9 + Math.min(degree(id), 6) * 1.5) / camera.k;
  /** Edge geometry for the current zoom level. */
  const curveOf = (s: string, t: string, a: Point, b: Point) =>
    level === "dot" ? connector(a, b, CARD, CARD, dotR(s), dotR(t)) : connector(a, b, sizeOf(s), sizeOf(t));
  const editing = editingEdge ? edges.find((e) => e.key === editingEdge) : undefined;
  const pageTitle = (id: string) => {
    const p = pages.find((x) => x.id === id);
    return p ? `${p.icon} ${p.title || "Untitled"}` : "";
  };

  return (
    <div
      ref={viewport}
      className={`oc-fade-in relative h-full w-full touch-none overflow-hidden select-none ${tracePick ? "cursor-crosshair [&_*]:!cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      style={{
        backgroundColor: "var(--oc-canvas)",
        backgroundImage: camera.k < 0.45 ? "none" : "radial-gradient(color-mix(in srgb, var(--oc-canvas-dot) 65%, transparent) 1px, transparent 1px)",
        backgroundSize: `${GRID * camera.k}px ${GRID * camera.k}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        transition: glide ? "background-position 420ms cubic-bezier(0.22, 1, 0.36, 1), background-size 420ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
      }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={backgroundMenu}
    >
      {/* Soft glow in the middle of the map */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, color-mix(in srgb, var(--color-sky-500) 4%, transparent), transparent 70%)" }}
      />
      {/* World layer: everything inside moves with the camera */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`,
          transition: glide ? "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        {positions && (
          <AtlasGroups
            groups={groups}
            rectOf={rectOf}
            tintOf={tintOf}
            countOf={(g) => {
              const ids = membersOf(g.id);
              const c = ids.filter(isConceptId).length;
              return { concepts: c, notes: ids.length - c };
            }}
            cardW={CARD_W}
            cardH={CARD_H}
            renaming={renamingGroup}
            dropTarget={dropGroup}
            onStartRename={setRenamingGroup}
            onRename={(g, name) => saveGroup(g, { name })}
            onToggle={(g) => saveGroup(g, { collapsed: !g.collapsed })}
            onDelete={deleteGroup}
            onColor={(g, color) => saveLayout(g, { color })}
            onHeaderDown={onGroupHeaderDown}
            onResizeDown={onGroupResizeDown}
          />
        )}
        <svg
          className="pointer-events-none absolute"
          style={{ left: -SVG_OFFSET, top: -SVG_OFFSET, width: SVG_OFFSET * 2, height: SVG_OFFSET * 2 }}
        >
          <defs>
            {[
              ...Object.entries(EDGE_COLORS).map(([id, c]) => [id, c.stroke]),
              ...Object.entries(REL_COLORS).map(([id, c]) => [`rel-${id}`, c]),
              ["focus", FOCUS_STROKE],
              ["muted", MUTED_STROKE],
            ].map(
              ([id, fill]) => (
                <marker
                  key={id}
                  id={`oc-arrow-${id}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0,1 L9,5 L0,9 z" fill={fill} />
                </marker>
              ),
            )}
          </defs>
          <g transform={`translate(${SVG_OFFSET} ${SVG_OFFSET})`}>
            {/* Parent → child orbit lines (dashed, in the parent's tint) */}
            {pages.map((c) => {
              const a = c.parentId ? shown.get(c.parentId) : undefined;
              const b = shown.get(c.id);
              return a && b ? (
                <line key={`orbit-${c.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tint(c.parentId!).solid} strokeOpacity={hovered === c.parentId ? 1 : 0.55} strokeWidth={hovered === c.parentId ? 2 : 1.25} style={{ transition: "stroke-opacity 200ms, stroke-width 200ms" }} strokeDasharray="5 6" />
              ) : null;
            })}
            {positions &&
              shownEdges.map((edge) => {
                const a = shown.get(edge.source);
                const b = shown.get(edge.target);
                if (!a || !b) return null;
                const curve = curveOf(edge.source, edge.target, a, b);
                const lit = edge.key === hoveredEdge || edge.key === editingEdge ||
                  (!hoverPair && (focusCards.has(edge.source) || focusCards.has(edge.target)));
                const muted = hiddenTypes.has(edge.relType);
                // A hand-picked color wins; otherwise the relationship type sets it.
                const custom = edge.color !== "default";
                const stroke = muted ? MUTED_STROKE : custom ? EDGE_COLORS[edge.color].stroke : REL_COLORS[edge.relType];
                const marker = `url(#oc-arrow-${muted ? "muted" : custom ? edge.color : `rel-${edge.relType}`})`;
                return (
                  <g
                    key={edge.key}
                    opacity={
                      bright &&
                      !(inTrace
                        ? traceKeys.has([edge.source, edge.target].sort().join("|"))
                        : bright.has(edge.source) && bright.has(edge.target) && (!inPath || edge.relType === "depends_on"))
                        ? 0.08
                        : filteredOut(edge.source) || filteredOut(edge.target)
                          ? 0.15
                        : muted
                          ? 0.35
                          : dimmed && edge.source !== hub && edge.target !== hub
                            ? 0.25
                            : 1
                    }
                    style={{ transition: "opacity 300ms" }}
                  >
                    <path
                      d={curve.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={muted ? 1 : lit ? 2.25 : 1.5}
                      strokeDasharray={DASH[edge.style]}
                      strokeLinecap="round"
                      markerEnd={SYMMETRIC_TYPES.has(edge.relType) ? undefined : marker}
                      markerStart={edge.mutual && !SYMMETRIC_TYPES.has(edge.relType) ? marker : undefined}
                      className="transition-[stroke,stroke-width] duration-150"
                    />
                    {/* Wide invisible stroke: easy to hover and click */}
                    <path
                      d={curve.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerEnter={() => setHoveredEdge(edge.key)}
                      onPointerLeave={() => setHoveredEdge((h) => (h === edge.key ? null : h))}
                      onClick={() => setEditingEdge(edge.key)}
                      onContextMenu={(e) => edgeMenu(e, edge)}
                    />
                  </g>
                );
              })}

            {/* Connection being drawn */}
            {draft && shown.get(draft.from) && (
              <path
                d={draftCurve(shown.get(draft.from)!, draft.side, draft.target ? shown.get(draft.target)! : null, draft.to, sizeOf(draft.from), draft.target ? sizeOf(draft.target) : CARD)}
                fill="none"
                stroke={FOCUS_STROKE}
                strokeWidth={2}
                strokeDasharray={draft.target ? undefined : "6 5"}
                strokeLinecap="round"
                markerEnd="url(#oc-arrow-focus)"
              />
            )}
          </g>
        </svg>

        {/* Edge labels sit on the curve's midpoint */}
        {positions &&
          shownEdges.map((edge) => {
            const a = shown.get(edge.source);
            const b = shown.get(edge.target);
            if (!a || !b) return null;
            const text = hiddenTypes.has(edge.relType) ? "" : edgeText(edge);
            const showGhost = !text && edge.key === hoveredEdge;
            if (!text && !showGhost) return null;
            const mid = curveOf(edge.source, edge.target, a, b).mid;
            return (
              <button
                key={`label-${edge.key}`}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerEnter={() => setHoveredEdge(edge.key)}
                onPointerLeave={() => setHoveredEdge((h) => (h === edge.key ? null : h))}
                onClick={() => setEditingEdge(edge.key)}
                onContextMenu={(e) => edgeMenu(e, edge)}
                style={{
                  left: mid.x,
                  top: mid.y,
                  color: edge.color === "default" ? undefined : EDGE_COLORS[edge.color].stroke,
                }}
                className={`oc-fade-in absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-sm shadow-black/40 transition-colors duration-100 ${
                  showGhost
                    ? "border-dashed border-white/15 bg-[var(--oc-canvas)] text-neutral-500"
                    : "border-white/[0.08] bg-[var(--oc-raised)] text-neutral-300 hover:border-white/20"
                }`}
              >
                {text || "+ Relationship"}
              </button>
            );
          })}

        {positions &&
          pages.map((page) => {
            const p = shown.get(page.id);
            if (!p) return null;
            const child = orbiting(page.id);
            const out = child ? ease(spreadOf(page.parentId!)) : 1;
            const scale = (child ? Math.max(0.6, 0.8 - (depthOf(page.id) - 1) * 0.1) : 1) * (0.25 + 0.75 * out);
            const t = child ? tint(page.parentId!) : null;
            const count = kids.get(page.id)?.length ?? 0;
            // Hovering a parent makes its direct children glow (in its tint).
            const glow = child && hovered === page.parentId;
            const active = page.id === activePageId;
            const lit = focusCards.has(page.id);
            const isDropTarget = draft?.target === page.id;
            const showHandles = !draft && hovered === page.id && !gesture.current;
            const links = degree(page.id);
            const concept = concepts.find((c) => c.id === page.id);
            const size = sizeOf(page.id);
            const isNote = !concept && level !== "dot";
            const own = cardColors[page.id] && PALETTE[cardColors[page.id]]?.color;
            const dragging = gesture.current?.kind === "card" && gesture.current.id === page.id && gesture.current.moved;
            const dropInto = dragging && dropGroup ? groups.find((g) => g.id === dropGroup) : undefined;
            return (
              <div
                key={page.id}
                // Orbiting cards follow their parent: no dragging, but the orbit pauses on hover.
                onPointerDown={(e) => (child ? (e.stopPropagation(), setSelected(page.id)) : onCardDown(e, page.id))}
                onPointerEnter={() => {
                  setHovered(page.id);
                  pausedRef.current = child;
                }}
                onPointerLeave={() => {
                  setHovered((h) => (h === page.id ? null : h));
                  pausedRef.current = false;
                }}
                onDoubleClick={() => (concept ? enterFocus(page.id) : onOpenPage(page.id))}
                onContextMenu={(e) => cardMenu(e, page)}
                title={concept ? "Concept · double-click to focus" : "Double-click to open"}
                style={{
                  left: p.x - size.w / 2,
                  top: p.y - size.h / 2,
                  width: size.w,
                  height: size.h,
                  scale: scale < 1 ? String(scale) : undefined,
                  opacity: (bright && !bright.has(page.id)) || filteredOut(page.id) ? 0.12 : dimmed && !dimmed.has(page.id) ? 0.45 : out < 1 ? out : undefined,
                  outline: level !== "dot" && page.id === (pathFor ?? focus) ? "2px solid var(--color-sky-400)" : "2px solid transparent",
                  outlineOffset: 3,
                  zIndex: dragging ? 5 : child ? undefined : 1,
                  ...(level !== "dot" && t && !lit && !isDropTarget ? { borderColor: `color-mix(in srgb, ${t.solid} 55%, transparent)`, background: `color-mix(in srgb, ${t.solid} 14%, var(--oc-raised))` } : {}),
                  ...(level !== "dot" && own && !isDropTarget && page.id !== selected ? { borderColor: `color-mix(in srgb, ${own} 70%, transparent)`, background: `color-mix(in srgb, ${own} 16%, var(--oc-raised))` } : {}),
                  ...(concept && level !== "dot" ? { borderLeft: `3px solid ${STATE_DOT[concept.state]}` } : {}),
                  boxShadow: dragging ? "0 18px 40px -12px rgba(0,0,0,0.6)" : undefined,
                }}
                className={level === "dot" ? "absolute cursor-pointer transition-opacity duration-300" : `oc-pop-in absolute flex cursor-pointer flex-col border ${isNote ? "justify-start overflow-hidden rounded-lg px-3 pt-2.5" : "justify-center rounded-xl px-4"} shadow-md shadow-black/25 transition-[border-color,background-color,box-shadow,opacity,outline-color] duration-200 ${
                  concept ? "bg-[color-mix(in_srgb,var(--color-sky-500)_7%,var(--oc-raised))]" : "bg-[var(--oc-raised)]"
                } ${
                  isDropTarget
                    ? "border-sky-400 ring-2 ring-sky-500/30"
                    : page.id === selected
                      ? "border-sky-400 ring-1 ring-sky-400"
                      : lit
                        ? "border-white/25"
                        : active
                          ? "border-white/20"
                          : "border-white/[0.08] hover:border-white/20"
                }`}
              >
                {level === "dot" ? (() => {
                  const r = dotR(page.id);
                  const color = concept ? STATE_DOT[concept.state] : tint(page.id).solid;
                  const ring = page.id === (pathFor ?? focus) || page.id === selected || lit;
                  return (
                    <>
                      <span
                        className="oc-pop-in absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[box-shadow,outline-color] duration-300"
                        style={{
                          width: r * 2,
                          height: r * 2,
                          borderRadius: concept ? "9999px" : r * 0.4,
                          background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 60%, white), ${color})`,
                          boxShadow: `0 0 ${r * 1.2}px color-mix(in srgb, ${color} 55%, transparent)`,
                          outline: `${2 / camera.k}px solid ${ring ? "var(--color-sky-400)" : "transparent"}`,
                          outlineOffset: 2 / camera.k,
                        }}
                      />
                      <span
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900/80 font-medium text-neutral-200"
                        style={{ top: CARD_H / 2 + r + 4 / camera.k, fontSize: 11 / camera.k, padding: `${1 / camera.k}px ${5 / camera.k}px` }}
                      >
                        {page.title || "Untitled"}
                      </span>
                    </>
                  );
                })() : (<>
                <div className="flex min-w-0 items-center gap-2">
                  {concept ? (
                    <Lightbulb className="size-4 shrink-0" aria-label={concept.state} style={{ color: STATE_DOT[concept.state] }} />
                  ) : (
                    <span className="text-base leading-none">{page.icon}</span>
                  )}
                  {renaming === page.id ? (
                    <input
                      autoFocus
                      defaultValue={page.title}
                      onFocus={(e) => e.target.select()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => renameConcept(page.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-neutral-100 outline-none"
                    />
                  ) : (
                    <span className={`truncate text-[13px] font-medium text-neutral-100`}>
                      {page.title || "Untitled"}
                    </span>
                  )}
                </div>
                {inTrace?.has(page.id) && traceSteps && (
                  <span className="oc-pop-in absolute -left-2 -top-2 grid size-5 place-items-center rounded-full bg-amber-500 text-[11px] font-semibold text-white shadow shadow-black/40">
                    {page.id === traceAB!.a ? 1 : traceSteps.findIndex((s) => s.to === page.id) + 2}
                  </span>
                )}
                {!inTrace && path && path.order.includes(page.id) && (
                  <span className="oc-pop-in absolute -left-2 -top-2 grid size-5 place-items-center rounded-full bg-violet-500 text-[11px] font-semibold text-white shadow shadow-black/40">
                    {path.order.indexOf(page.id) + 1}
                  </span>
                )}
                {glow && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{ "--glow": t!.solid, animation: "oc-orbit-glow 2s ease-in-out infinite" } as React.CSSProperties}
                  />
                )}
                {count > 0 && (
                  <button
                    type="button"
                    title={collapsed.has(page.id) ? "Show subpages" : "Hide subpages"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() =>
                      // Immutable update: StrictMode runs updaters twice, so mutating `s` would undo the toggle.
                      setCollapsed((s) => (s.has(page.id) ? new Set([...s].filter((x) => x !== page.id)) : new Set([...s, page.id])))
                    }
                    className="absolute right-2 top-2 flex cursor-pointer items-center gap-0.5 rounded px-1 text-[11px] text-neutral-400 hover:bg-white/[0.08]"
                  >
                    <span className={`inline-block transition-transform ${collapsed.has(page.id) ? "" : "rotate-90"}`}>▸</span>
                    {count}
                  </button>
                )}
                {isNote ? (
                  // The note itself, read-only: scroll to read, "Open note" to edit.
                  <div className="oc-note-scroll scrollbar-thin mt-1.5 min-h-0 flex-1 overflow-y-auto whitespace-pre-line pb-2.5 pr-1 text-[11.5px] leading-relaxed text-neutral-400">
                    {previews.has(page.id) ? previews.get(page.id) || <span className="italic text-neutral-600">Empty note</span> : <span className="oc-nerida-shimmer">Loading…</span>}
                  </div>
                ) : (
                  <div className={`mt-1 text-[11px] text-neutral-500 pl-6`}>
                    {concept ? (STATE_LABEL[concept.state] + (links ? ` · ${links} link${links === 1 ? "" : "s"}` : "")) : links ? `${links} link${links === 1 ? "" : "s"}` : "No links yet"}
                    {active && <span className="text-neutral-400"> · open</span>}
                  </div>
                )}
                {dropInto && (
                  <span
                    className="oc-pop-in pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] font-medium text-white shadow-lg shadow-black/40"
                    style={{ background: tintOf(dropInto) }}
                  >
                    Drop to add to {dropInto.name}
                  </span>
                )}

                {/* Connection handles on each edge, shown on hover */}
                {showHandles &&
                  (["top", "right", "bottom", "left"] as const).map((side) => (
                    <span
                      key={side}
                      title="Drag to connect"
                      onPointerDown={(e) => onHandleDown(e, page.id, side)}
                      className="oc-fade-in absolute size-3 cursor-crosshair rounded-full border-2 border-sky-400 bg-[var(--oc-canvas)] transition-transform duration-100 hover:scale-125 hover:bg-sky-400"
                      style={HANDLE_POS[side]}
                    />
                  ))}

                </>)}
              </div>
            );
          })}
      </div>

      {/* Edge popover (screen space, unscaled) */}
      {editing && positions && (() => {
        const a = positions.get(editing.source);
        const b = positions.get(editing.target);
        if (!a || !b) return null;
        const mid = curveOf(editing.source, editing.target, a, b).mid;
        const el = viewport.current;
        return (
          <EdgePopover
            key={editing.key}
            edge={editing}
            anchor={{ x: camera.x + mid.x * camera.k, y: camera.y + mid.y * camera.k }}
            vertical={Math.abs(b.y - a.y) > Math.abs(b.x - a.x)}
            bounds={{ w: (el?.clientWidth ?? 800) - (concepts.some((c) => c.id === selected) ? 316 : 0), h: el?.clientHeight ?? 600 }}
            from={pageTitle(editing.source)}
            to={pageTitle(editing.target)}
            onChange={(patch) => updateEdge(editing.key, patch)}
            onDelete={() => deleteEdge(editing)}
            onClose={() => setEditingEdge(null)}
          />
        );
      })()}

      {/* Toolbar over the selected card (screen space) */}
      {(() => {
        const id = selected;
        const p = id ? shown.get(id) : undefined;
        const page = id ? pages.find((x) => x.id === id) : undefined;
        const moving = gesture.current?.kind === "card" && gesture.current.moved;
        if (!id || !p || !page || level === "dot" || draft || moving || tracePick) return null;
        const s = sizeOf(id);
        const isConcept = isConceptId(id);
        return (
          <CardToolbar
            key={`toolbar-${id}`}
            x={camera.x + p.x * camera.k}
            y={camera.y + (p.y - s.h / 2) * camera.k}
            color={cardColors[id] ?? null}
            isConcept={isConcept}
            onFocus={() => enterFocus(id)}
            onConnect={(e) => onHandleDown(e, id, "right")}
            onTrace={() => setTracePick(id)}
            onColor={(c) => setCardColor(id, c)}
            onOpen={() => onOpenPage(id)}
            onDelete={() => {
              if (isConcept) {
                if (window.confirm(`Delete the concept "${page.title || "Untitled"}"? Its links and attachments go too.`)) void deleteConcept(id);
              } else if (window.confirm(`Move "${page.title || "Untitled"}" to Trash?`)) onTrashPage(id);
            }}
          />
        );
      })()}

      {/* Concept inspector (screen space) */}
      {(() => {
        if (traceAB) {
          const label = (s: TraceStep) => {
            const forward = s.edge.sourceId === s.from;
            const verb = REL_LABELS[s.edge.relType].toLowerCase();
            const [x, y] = forward ? [s.from, s.to] : [s.to, s.from];
            return `${pageTitle(x)} ${verb} ${pageTitle(y)}${s.edge.label ? ` — “${s.edge.label}”` : ""}`;
          };
          return (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="oc-pop-in absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-[300px] flex-col rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] shadow-xl shadow-black/40"
            >
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
                <Route className="size-4 text-amber-300" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-100">
                  {pageTitle(traceAB.a)} → {pageTitle(traceAB.b)}
                </span>
                <button type="button" aria-label="Close trace" onClick={() => setTraceAB(null)} className="grid size-6 cursor-pointer place-items-center rounded text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100">
                  <X className="size-3.5" />
                </button>
              </div>
              {traceSteps ? (
                <ol className="overflow-y-auto p-1.5 text-[12.5px]">
                  {[traceAB.a, ...traceSteps.map((s) => s.to)].map((id, i) => (
                    <li key={id}>
                      <button type="button" onClick={() => panTo(id)} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-200 hover:bg-white/[0.05]">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-[11px] font-semibold text-white">{i + 1}</span>
                        <span className="truncate">{pageTitle(id)}</span>
                      </button>
                      {i < traceSteps.length && <p className="ml-[18px] border-l border-white/10 py-1 pl-4 text-[11.5px] text-neutral-500">{label(traceSteps[i])}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-3 py-4 text-[12.5px] text-neutral-400">
                  No connection between {pageTitle(traceAB.a)} and {pageTitle(traceAB.b)}
                  {hiddenTypes.size ? " with the relationship types shown." : " yet."}
                </p>
              )}
            </div>
          );
        }
        const c = tracePick ? undefined : concepts.find((x) => x.id === selected);
        return c ? (
          <ConceptInspector
            key={c.id}
            concept={c}
            edges={canvasEdges.filter((e) => e.manual && (e.sourceId === c.id || e.targetId === c.id))}
            titleOf={pageTitle}
            attached={resources.filter((r) => r.conceptId === c.id).map((r) => r.entryId)}
            pages={pageList}
            onChange={(patch) => saveConcept(c.id, patch)}
            onAttach={(entryId) => attachResource(c.id, entryId)}
            onDetach={(entryId) => detachResource(c.id, entryId)}
            onOpen={(entryId) => {
              // A note section: open the note, then scroll to the heading (if it still exists).
              if (entryId.startsWith("heading:")) {
                const [, pageId, blockId] = entryId.split(":");
                window.dispatchEvent(new CustomEvent("oc-open-block", { detail: { pageId, blockId } }));
                return onOpenPage(pageId);
              }
              onOpenPage(entryId);
            }}
            onSelect={setSelected}
            onClose={() => (setSelected(null), setPathFor(null))}
            onRemoveEdge={(e) => deleteEdge({ source: e.sourceId, target: e.targetId } as VisualEdge)}
            path={pathFor === c.id ? path : null}
            onTogglePath={() => setPathFor((p) => (p === c.id ? null : c.id))}
            groups={groups}
            onGroup={(groupId) => (groupId === "new" ? newGroupWith(c.id) : setGroupOf(c.id, groupId))}
          />
        ) : null;
      })()}

      {/* Toolbar: search, filter, focus trail */}
      <div onPointerDown={(e) => e.stopPropagation()} className="absolute left-4 top-3 z-10 flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500" />
            <input
              value={query}
              placeholder="Search concepts & pages"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && hits[0]) (panTo(hits[0].id), setQuery(""));
              }}
              className="h-8 w-56 rounded-lg border border-white/[0.08] bg-neutral-800/90 pl-7 pr-2 text-[13px] text-neutral-100 outline-none backdrop-blur placeholder:text-neutral-500 focus:border-sky-500/60"
            />
            {hits.length > 0 && (
              <div className="absolute left-0 top-9 w-56 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl shadow-black/50">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => (panTo(h.id), setQuery(""))}
                    className="block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-[12px] text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
                  >
                    {h.icon} {h.title || "Untitled"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex h-8 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-neutral-800/90 px-0.5 backdrop-blur">
            <CanvasButton title="Zoom out (or scroll)" onClick={() => zoomCenter(1 / 1.2)}>
              <Minus className="size-4" />
            </CanvasButton>
            <button
              type="button"
              data-tip="Reset zoom to 100%"
              aria-label="Reset zoom"
              onClick={() => zoomCenter(1 / camera.k)}
              className="h-7 w-11 cursor-pointer rounded-md text-[11.5px] font-medium tabular-nums text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100"
            >
              {Math.round(camera.k * 100)}%
            </button>
            <CanvasButton title="Zoom in (or scroll)" onClick={() => zoomCenter(1.2)}>
              <Plus className="size-4" />
            </CanvasButton>
            <CanvasButton title="Fit to screen" onClick={fit}>
              <Maximize2 className="size-3.5" />
            </CanvasButton>
            <CanvasButton title="Tidy up (re-run auto layout)" onClick={relayout}>
              <Sparkles className="size-3.5" />
            </CanvasButton>
          </div>
          <button
            type="button"
            title="Filter"
            onClick={() => setFilterOpen((o) => !o)}
            className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-neutral-800/90 px-2.5 text-[12px] backdrop-blur ${
              filterCount ? "border-sky-500/60 text-sky-300" : "border-white/[0.08] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Filter className="size-3.5" />
            {filterCount > 0 && <span>Filter · {filterCount}</span>}
          </button>
          {findings.length > 0 && (
            <button
              type="button"
              title="Map checks"
              onClick={() => setChecksOpen((o) => !o)}
              className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-neutral-800/90 px-2.5 text-[12px] backdrop-blur ${
                checksOpen ? "border-amber-400/60 text-amber-200" : "border-white/[0.08] text-neutral-300 hover:text-neutral-100"
              }`}
            >
              <ListChecks className="size-3.5 text-amber-300" />
              Checks · {findings.length}
            </button>
          )}
        </div>
        {checksOpen && findings.length > 0 && (
          <div className="w-[320px] rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 text-[12px] shadow-xl shadow-black/50">
            <p className="px-2 pb-1 pt-1.5 text-[11px] text-neutral-500">Places the map could use more structure</p>
            {findings.map((f) => (
              <div key={f.key} className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.04]">
                <button type="button" onClick={() => panTo(f.conceptId)} className="min-w-0 flex-1 cursor-pointer text-left text-neutral-300 hover:text-neutral-100">
                  {f.text}
                </button>
                <button
                  type="button"
                  onClick={() => ignore(f.key)}
                  className="shrink-0 cursor-pointer rounded px-1.5 text-[11px] text-neutral-500 opacity-0 hover:bg-white/[0.06] hover:text-neutral-200 group-hover:opacity-100"
                >
                  Ignore
                </button>
              </div>
            ))}
          </div>
        )}
        {filterOpen && (() => {
          const chip = (on: boolean) =>
            `h-6 cursor-pointer rounded-md border px-1.5 text-[11px] transition-colors duration-100 ${
              on ? "border-sky-500/50 bg-sky-500/10 text-neutral-200" : "border-white/[0.06] text-neutral-500 hover:text-neutral-300"
            }`;
          const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
          const head = "px-0.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500";
          return (
            <div className="max-h-[70vh] w-[288px] overflow-y-auto rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-2 shadow-xl shadow-black/50">
              <div className="flex items-center justify-between">
                <p className={head + " pt-0"}>Relationships</p>
                {filterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      updateFilters(NO_FILTERS);
                      setHiddenTypes(new Set());
                      api.setSetting("atlasHiddenTypes", "[]").catch(() => {});
                    }}
                    className="cursor-pointer text-[11px] text-sky-300 hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {REL_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => toggleType(t)} className={chip(!hiddenTypes.has(t)) + (hiddenTypes.has(t) ? " line-through" : "")}>
                    {REL_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className={head}>Tags</p>
                <div className="mt-1 flex rounded-md border border-white/[0.08] p-0.5 text-[10.5px]">
                  {(["all", "any"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateFilters({ ...filters, tagMode: m })}
                      className={`cursor-pointer rounded px-1.5 ${filters.tagMode === m ? "bg-white/[0.08] text-neutral-100" : "text-neutral-500"}`}
                    >
                      {m === "all" ? "All of these" : "Any of these"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {allTags.length ? allTags.map((t) => (
                  <button key={t} type="button" onClick={() => updateFilters({ ...filters, tags: flip(filters.tags, t) })} className={chip(filters.tags.includes(t))}>
                    #{t}
                  </button>
                )) : <span className="text-[11px] text-neutral-600">No tags yet</span>}
              </div>
              <p className={head}>Learning state</p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(STATE_LABEL) as Concept["state"][]).map((s) => (
                  <button key={s} type="button" onClick={() => updateFilters({ ...filters, states: flip(filters.states, s) })} className={chip(filters.states.includes(s)) + " flex items-center gap-1"}>
                    <span className="size-1.5 rounded-full" style={{ background: STATE_DOT[s] }} />
                    {STATE_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className={head}>Group</p>
              <div className="flex flex-wrap gap-1">
                {groups.length ? groups.map((g) => (
                  <button key={g.id} type="button" onClick={() => updateFilters({ ...filters, groups: flip(filters.groups, g.id) })} className={chip(filters.groups.includes(g.id))}>
                    {g.name}
                  </button>
                )) : <span className="text-[11px] text-neutral-600">No groups yet</span>}
              </div>
            </div>
          );
        })()}
        {tracePick && (
          <div className="oc-pop-in flex items-center gap-2 rounded-lg border border-amber-400/40 bg-neutral-800/95 px-2.5 py-1.5 text-[12px] text-amber-100 backdrop-blur">
            <Route className="size-3.5 text-amber-300" />
            Click a card to trace from {pageTitle(tracePick)}
            <span className="text-neutral-500">· Esc to cancel</span>
          </div>
        )}
        {focus && (
          <div className="flex max-w-[420px] items-center gap-1 rounded-lg border border-violet-400/30 bg-neutral-800/90 px-2 py-1 text-[12px] backdrop-blur">
            <Crosshair className="size-3.5 shrink-0 text-violet-300" />
            {focusTrail.map((id, i) => (
              <span key={`${id}-${i}`} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="text-neutral-600">›</span>}
                <button
                  type="button"
                  onClick={() => (setFocusTrail((t) => t.slice(0, i + 1)), panTo(id))}
                  className={`cursor-pointer truncate hover:text-neutral-100 ${id === focus ? "text-violet-200" : "text-neutral-400"}`}
                >
                  {pageTitle(id)}
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setFocusTrail([])}
              className="ml-1 shrink-0 cursor-pointer rounded px-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
            >
              Exit
            </button>
          </div>
        )}
      </div>

      {pages.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">No pages or concepts yet</div>
      )}

      <AtlasGuide
        workspaceId={workspaceId}
        conceptCount={concepts.length}
        edgeCount={canvasEdges.filter((e) => isConceptId(e.sourceId) || isConceptId(e.targetId)).length}
        focusCount={focusCount}
        resourceCount={resources.length}
        hasPages={pageList.length > 0}
      />

      <AtlasLegend muted={hiddenTypes} />

      {/* Dock: add things (bottom centre) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="oc-pop-in absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl shadow-black/30"
      >
        {([
          ["Concept", Lightbulb, () => newConcept(viewCenter())],
          ["Note", FileText, () => ((pendingPlacement.current = viewCenter()), onCreatePage())],
          ["Group", Boxes, () => newGroupWith(null, viewCenter())],
        ] as const).map(([label, Icon, run]) => (
          <button
            key={label}
            type="button"
            onClick={run}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[12.5px] text-neutral-300 transition-[background-color,color,transform] duration-100 hover:bg-white/[0.07] hover:text-neutral-100 active:scale-95"
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small toolbar above the selected card: focus, connect, colour, open (notes), delete. */
function CardToolbar({ x, y, color, isConcept, onFocus, onConnect, onTrace, onColor, onOpen, onDelete }: {
  /** Screen position of the card's top centre. */
  x: number;
  y: number;
  color: string | null;
  isConcept: boolean;
  onFocus: () => void;
  onConnect: (e: PointerEvent) => void;
  onTrace: () => void;
  onColor: (c: string | null) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const btn = "grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors duration-100 hover:bg-white/[0.07] hover:text-neutral-100";
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="oc-pop-in absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-0.5 shadow-lg shadow-black/40"
      style={{ left: x, top: y - 42 }}
    >
      <button type="button" title="Focus" aria-label="Focus" onClick={onFocus} className={btn}><Crosshair className="size-3.5" /></button>
      <button type="button" title="Drag to connect" aria-label="Connect" onPointerDown={onConnect} className={`${btn} cursor-crosshair`}><Spline className="size-3.5" /></button>
      <button type="button" title="Trace to… (then click a card)" aria-label="Trace to" onClick={onTrace} className={btn}><Route className="size-3.5" /></button>
      <button type="button" title="Color" aria-label="Color" onClick={() => setPicking((p) => !p)} className={btn}>
        <span className="size-3 rounded-full border border-white/30" style={{ background: color ? PALETTE[color]?.color : "transparent" }} />
      </button>
      {!isConcept && <button type="button" title="Open note" aria-label="Open note" onClick={onOpen} className={btn}><FileText className="size-3.5" /></button>}
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <button type="button" title={isConcept ? "Delete concept" : "Move to Trash"} aria-label="Delete" onClick={onDelete} className={`${btn} hover:text-red-400`}><Trash2 className="size-3.5" /></button>
      {picking && (
        <div className="oc-pop-in absolute left-1/2 top-full mt-1.5 flex -translate-x-1/2 gap-1 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1.5 shadow-xl shadow-black/40">
          {Object.entries(PALETTE).map(([key, c]) => (
            <button
              key={key}
              type="button"
              title={c.label}
              aria-label={c.label}
              onClick={() => (onColor(key), setPicking(false))}
              className={`size-5 cursor-pointer rounded-full transition-transform hover:scale-110 ${color === key ? "ring-2 ring-white/70 ring-offset-1 ring-offset-[var(--oc-surface)]" : ""}`}
              style={{ background: c.color }}
            />
          ))}
          <button type="button" onClick={() => (onColor(null), setPicking(false))} className="cursor-pointer rounded px-1.5 text-[11px] text-neutral-400 hover:bg-white/[0.06]">
            None
          </button>
        </div>
      )}
    </div>
  );
}

const HANDLE_POS: Record<Side, React.CSSProperties> = {
  top: { left: "50%", top: 0, transform: "translate(-50%, -50%)" },
  right: { left: "100%", top: "50%", transform: "translate(-50%, -50%)" },
  bottom: { left: "50%", top: "100%", transform: "translate(-50%, -50%)" },
  left: { left: 0, top: "50%", transform: "translate(-50%, -50%)" },
};

/* ------------------------------------------------------------ popover */
/**
 * Notion-flavoured edge editor: a rename-style label input, the nine named
 * colors as tiles, a solid/dashed/dotted segmented control, and Delete.
 */
function EdgePopover({
  edge,
  anchor,
  vertical,
  bounds,
  from,
  to,
  onChange,
  onDelete,
  onClose,
}: {
  edge: VisualEdge;
  /** Line midpoint in screen space. */
  anchor: Point;
  /** Line runs mostly up-down: sit beside it; otherwise above or below. */
  vertical: boolean;
  /** Visible canvas area the popover must stay inside. */
  bounds: { w: number; h: number };
  from: string;
  to: string;
  onChange: (patch: Partial<Pick<CanvasEdge, "label" | "color" | "style" | "relType">>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(edge.label);
  const [styleOpen, setStyleOpen] = useState(edge.color !== "default" || edge.style !== "solid");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  // Place beside the line, flip to the side with room, then clamp inside the canvas.
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Point | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    // Clear the type label that sits on the line's midpoint.
    const gap = vertical ? 64 : 28;
    let x: number, y: number;
    if (vertical) {
      x = anchor.x + gap + w <= bounds.w - 8 ? anchor.x + gap : anchor.x - gap - w;
      y = anchor.y - h / 2;
    } else {
      x = anchor.x - w / 2;
      y = anchor.y + gap + h <= bounds.h - 8 ? anchor.y + gap : anchor.y - gap - h;
    }
    const next = { x: clamp(x, 8, Math.max(8, bounds.w - w - 8)), y: clamp(y, 8, Math.max(8, bounds.h - h - 8)) };
    if (!pos || Math.abs(pos.x - next.x) > 0.5 || Math.abs(pos.y - next.y) > 0.5) setPos(next);
  });

  const commitLabel = () => {
    if (label.trim() !== edge.label) onChange({ label: label.trim() });
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      ref={boxRef}
      style={{ left: pos?.x ?? anchor.x, top: pos?.y ?? anchor.y, visibility: pos ? undefined : "hidden" }}
      className="oc-edge-popover oc-pop-in absolute z-20 w-[min(324px,calc(100%-1rem))] cursor-default rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] p-2.5 shadow-xl shadow-black/40"
    >
      <p className="truncate px-1 pb-2.5 text-[12px] text-neutral-300">
        {from} <span className="text-neutral-500">{edge.mutual || SYMMETRIC_TYPES.has(edge.relType) ? "↔" : "→"}</span> {to}
      </p>
      <p className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-neutral-500">Relationship</p>
      <div className="mb-2 grid grid-cols-3 gap-1">
        {REL_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ relType: t })}
            className={`flex h-7 cursor-pointer items-center gap-1 truncate rounded-md border px-1 text-[10.5px] transition-colors duration-100 ${
              edge.relType === t
                ? "border-sky-500 bg-sky-500/10 text-neutral-100"
                : "border-white/[0.08] text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200"
            }`}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: REL_COLORS[t] }} />
            <span className="truncate">{REL_LABELS[t]}</span>
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        value={label}
        placeholder="Why are they connected? (optional)"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitLabel();
            onClose();
          }
        }}
        className="h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none transition-colors duration-100 placeholder:text-neutral-500 focus:border-sky-500/60"
      />

      <button
        type="button"
        aria-expanded={styleOpen}
        onClick={() => setStyleOpen((o) => !o)}
        className="mt-2.5 flex w-full cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-200"
      >
        <ChevronRight className={`size-3.5 transition-transform duration-150 ${styleOpen ? "rotate-90" : ""}`} />
        Line style
      </button>
      {styleOpen && (<div className="oc-fade-in">
      <p className="px-1 pb-1.5 pt-1 text-[11px] text-neutral-500">Color</p>
      <div className="grid grid-cols-5 gap-1.5 px-1">
        {(Object.entries(EDGE_COLORS) as [EdgeColor, (typeof EDGE_COLORS)[EdgeColor]][]).map(([id, c]) => (
          <button
            key={id}
            type="button"
            title={c.label}
            onClick={() => onChange({ color: id })}
            className={`grid h-7 cursor-pointer place-items-center rounded-md border transition-colors duration-100 ${
              edge.color === id ? "border-sky-500 bg-white/[0.06]" : "border-white/[0.08] hover:bg-white/[0.05]"
            }`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: c.stroke }} />
          </button>
        ))}
      </div>

      <p className="px-1 pb-1.5 pt-3 text-[11px] text-neutral-500">Line</p>
      <div className="mx-1 grid grid-cols-3 gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
        {(["solid", "dashed", "dotted"] as const).map((style) => (
          <button
            key={style}
            type="button"
            title={style[0].toUpperCase() + style.slice(1)}
            onClick={() => onChange({ style })}
            className={`grid h-7 cursor-pointer place-items-center rounded-md transition-colors duration-100 ${
              edge.style === style ? "bg-white/[0.1]" : "hover:bg-white/[0.05]"
            }`}
          >
            <svg width="34" height="6">
              <line
                x1="2"
                y1="3"
                x2="32"
                y2="3"
                stroke={edge.style === style ? "var(--oc-text-strong)" : "var(--oc-text-2)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={DASH[style]}
              />
            </svg>
          </button>
        ))}
      </div>
      </div>)}

      <div className="mx-1 my-2 h-px bg-white/[0.06]" />
      {edge.manual ? (
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-red-500/10 hover:text-red-400"
        >
          <Trash2 className="size-4" />
          Delete connection
        </button>
      ) : (
        <p className="px-2 pb-1 text-[11px] leading-snug text-neutral-500">
          This link comes from a page mention. Remove it in the document to delete it.
        </p>
      )}
    </div>
  );
}

function CanvasButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={title}
      aria-label={title}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- geometry */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Midpoint of a card's side. */
const anchor = (c: Point, side: Side, s: Size = CARD): Point => ({
  x: c.x + NORMAL[side].x * (s.w / 2),
  y: c.y + NORMAL[side].y * (s.h / 2),
});

/** Which sides two cards should connect through, by their relative position. */
function facingSides(a: Point, b: Point, sa: Size = CARD, sb: Size = CARD): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Compare against the cards' aspect so wide cards prefer left/right.
  if (Math.abs(dx) * (sa.h + sb.h) > Math.abs(dy) * (sa.w + sb.w)) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function bezier(s: Point, n1: Point, t: Point, n2: Point) {
  const reach = Math.max(40, Math.hypot(t.x - s.x, t.y - s.y) * 0.4);
  const c1 = { x: s.x + n1.x * reach, y: s.y + n1.y * reach };
  const c2 = { x: t.x + n2.x * reach, y: t.y + n2.y * reach };
  return {
    d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`,
    // Cubic Bézier at t = 0.5.
    mid: { x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8 },
  };
}

/**
 * Smooth S-curve between two cards, leaving and entering through facing sides.
 * With radii (zoomed-out dots), it runs nearly straight from circle edge to circle edge.
 */
function connector(a: Point, b: Point, za: Size, zb: Size, ra?: number, rb?: number) {
  if (ra !== undefined && rb !== undefined) {
    const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
    return bezier({ x: a.x + u.x * ra, y: a.y + u.y * ra }, u, { x: b.x - u.x * rb, y: b.y - u.y * rb }, { x: -u.x, y: -u.y });
  }
  const [sa, sb] = facingSides(a, b, za, zb);
  return bezier(anchor(a, sa, za), NORMAL[sa], anchor(b, sb, zb), NORMAL[sb]);
}

/** The line while dragging: from the grabbed side to the cursor, snapping to a hovered card. */
function draftCurve(from: Point, side: Side, target: Point | null, cursor: Point, zf: Size, zt: Size) {
  const s = anchor(from, side, zf);
  if (target) {
    const [, tb] = facingSides(from, target, zf, zt);
    return bezier(s, NORMAL[side], anchor(target, tb, zt), NORMAL[tb]).d;
  }
  // Toward the cursor, arriving roughly opposite the direction of travel.
  const dx = cursor.x - s.x;
  const dy = cursor.y - s.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  return bezier(s, NORMAL[side], cursor, { x: -dx / d, y: -dy / d }).d;
}


/**
 * Force-directed layout (Fruchterman–Reingold) for cards without a saved
 * position. Placed cards stay put and act as anchors. Backlinks pull hardest;
 * parent/child pairs pull gently so sub-pages settle near their parent.
 */
function autoLayout(pages: PageMeta[], links: LinkEdge[], placed: Map<string, Point>) {
  const ids = pages.map((p) => p.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const fixed = ids.map((id) => placed.has(id));
  const springs: [number, number, number][] = [];
  for (const l of links) {
    const a = index.get(l.sourceId);
    const b = index.get(l.targetId);
    if (a !== undefined && b !== undefined && a !== b) springs.push([a, b, 1]);
  }
  for (const p of pages) {
    const a = index.get(p.id)!;
    const b = p.parentId ? index.get(p.parentId) : undefined;
    if (b !== undefined) springs.push([a, b, 0.5]);
  }

  // Everything gravitates to the middle of the existing cards (or the origin).
  const anchors = [...placed.values()];
  const centre = anchors.length
    ? {
        x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length,
        y: anchors.reduce((s, p) => s + p.y, 0) / anchors.length,
      }
    : { x: 0, y: 0 };

  // Seed each new card in the nearest free slot beside a placed neighbour
  // (parent or linked page), else beside the cluster.
  const taken: Point[] = [...anchors];
  const pos: Point[] = ids.map((id, i) => {
    const saved = placed.get(id);
    if (saved) return { ...saved };
    const neighbour = springs.find(([a, b]) => (a === i && fixed[b]) || (b === i && fixed[a]));
    const near = neighbour ? placed.get(ids[neighbour[0] === i ? neighbour[1] : neighbour[0]])! : centre;
    const slot = freeSlot(near, taken);
    taken.push(slot);
    return slot;
  });

  const k = 280; // ideal edge length
  const reach = k * 2; // repulsion only acts between nearby cards
  let temp = 120;
  const iterations = 300;
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d > reach) continue; // far-apart cards stop pushing, so groups stay compact
        if (d < 1) {
          dx = Math.random();
          dy = Math.random();
          d = 1;
        }
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f;
        disp[j].y -= (dy / d) * f;
      }
    }
    for (const [a, b, w] of springs) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d * d) / k) * w;
      disp[a].x -= (dx / d) * f;
      disp[a].y -= (dy / d) * f;
      disp[b].x += (dx / d) * f;
      disp[b].y += (dy / d) * f;
    }
    // Gravity toward the cluster keeps unlinked cards from drifting off.
    pos.forEach((p, i) => {
      disp[i].x -= (p.x - centre.x) * 0.05;
      disp[i].y -= (p.y - centre.y) * 0.05;
    });
    for (let i = 0; i < pos.length; i++) {
      if (fixed[i]) continue;
      const d = Math.max(1, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
    }
    temp *= 0.985;
  }

  return new Map(ids.map((id, i) => [id, { x: Math.round(pos[i].x), y: Math.round(pos[i].y) }]));
}

/** Closest grid slot around `near` that no card already occupies. */
function freeSlot(near: Point, taken: Point[]): Point {
  const stepX = CARD_W + 40;
  const stepY = CARD_H + 40;
  const free = (p: Point) =>
    taken.every((t) => Math.abs(t.x - p.x) >= stepX || Math.abs(t.y - p.y) >= stepY);
  for (let ring = 1; ring < 30; ring++) {
    const candidates: Point[] = [];
    for (let gx = -ring; gx <= ring; gx++) {
      for (let gy = -ring; gy <= ring; gy++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) !== ring) continue;
        candidates.push({ x: near.x + gx * stepX, y: near.y + gy * stepY });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
    const hit = candidates.find(free);
    if (hit) return hit;
  }
  return { x: near.x + stepX, y: near.y };
}
