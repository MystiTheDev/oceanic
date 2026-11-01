import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  AppWindow,
  FileText,
  FolderInput,
  Maximize2,
  Minus,
  Palette,
  PenLine,
  Plus,
  ScanSearch,
  Sparkles,
  Spline,
  Star,
  Trash2,
} from "lucide-react";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import {
  api,
  type CanvasEdge,
  type EdgeColor,
  type EdgeStyle,
  type LinkEdge,
} from "../data/api";
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
};

const CARD_W = 208;
const CARD_H = 60;
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
};

const edgeKey = (s: string, t: string) => `${s}>${t}`;

/**
 * Oceanic's infinite canvas: every page as a floating card; document links
 * and canvas connections as curved arrows. Pan by dragging the background,
 * zoom with the wheel, drag cards to arrange them, drag from a card's edge
 * dot onto another card to connect them, click a line to label or style it,
 * double-click a card to open it.
 */
export function SpatialCanvas({
  pages,
  activePageId,
  version,
  onOpenPage,
  onOpenInNewTab,
  onCreatePage,
  onTogglePin,
  onTrashPage,
  workspaces,
  onMoveToWorkspace,
}: SpatialCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Map<string, Point> | null>(null);
  const [docLinks, setDocLinks] = useState<LinkEdge[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
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
  const [selected, setSelected] = useState<string | null>(activePageId);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  /** In-progress connection: from a card's side to the cursor (world coords). */
  const [draft, setDraft] = useState<{ from: string; side: Side; to: Point; target: string | null } | null>(
    null,
  );
  const fitted = useRef(false);
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
    const minX = Math.min(...pts.map((p) => p.x)) - CARD_W / 2 - 60;
    const maxX = Math.max(...pts.map((p) => p.x)) + CARD_W / 2 + 60;
    const minY = Math.min(...pts.map((p) => p.y)) - CARD_H / 2 - 60;
    const maxY = Math.max(...pts.map((p) => p.y)) + CARD_H / 2 + 60;
    const k = clamp(Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)), MIN_ZOOM, 1.2);
    setCamera({
      k,
      x: el.clientWidth / 2 - ((minX + maxX) / 2) * k,
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
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Screen (client) coordinates → world coordinates. */
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.k, y: (clientY - rect.top - camera.y) / camera.k };
  };

  /** The card under a world point, if any. */
  const cardAt = (p: Point, except?: string) =>
    pages.find((page) => {
      const c = positions?.get(page.id);
      return (
        c && page.id !== except && Math.abs(p.x - c.x) <= CARD_W / 2 && Math.abs(p.y - c.y) <= CARD_H / 2
      );
    })?.id ?? null;

  /* ---------------------------------------------- pan, drag, connect */
  const gesture = useRef<
    | { kind: "pan"; startX: number; startY: number; cam: Camera }
    | { kind: "card"; id: string; startX: number; startY: number; origin: Point; moved: boolean }
    | { kind: "connect"; from: string; side: Side }
    | null
  >(null);

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, cam: camera };
    setSelected(null);
    setEditingEdge(null);
  };

  const onCardDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || !positions) return;
    e.stopPropagation();
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
    } else {
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(g.id, { x: g.origin.x + dx / camera.k, y: g.origin.y + dy / camera.k });
        return next;
      });
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "card" && g.moved && positions) {
      const p = positions.get(g.id)!;
      api
        .saveCanvasPositions([{ pageId: g.id, x: p.x, y: p.y }])
        .catch((e) => console.error("Saving canvas failed", e));
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
      .then((edge) =>
        setCanvasEdges((prev) => [
          ...prev.filter((e) => edgeKey(e.sourceId, e.targetId) !== edgeKey(from, to)),
          edge,
        ]),
      )
      .catch((e) => console.error("Connecting pages failed", e));
  };

  /** Label / color / style change: optimistic, then saved. */
  const updateEdge = (key: string, patch: Partial<Pick<CanvasEdge, "label" | "color" | "style">>) => {
    const [source, target] = key.split(">");
    const current = edges.find((e) => e.key === key);
    if (!current) return;
    const next = { label: current.label, color: current.color, style: current.style, ...patch };
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ----------------------------------------------------- right-click */
  const backgroundMenu = (e: React.MouseEvent) => {
    const at = toWorld(e.clientX, e.clientY);
    openContextMenu(e, [
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

  const cardMenu = (e: React.MouseEvent, page: PageMeta) =>
    openContextMenu(e, [
      { label: "Open", icon: <FileText className="size-4" />, onSelect: () => onOpenPage(page.id) },
      { label: "Open in new tab", icon: <AppWindow className="size-4" />, onSelect: () => onOpenInNewTab(page.id) },
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
        label: edge.label ? "Edit label" : "Add label",
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

  const focusCards = new Set<string>(
    hoverPair
      ? [hoverPair.source, hoverPair.target]
      : [hovered ?? selected].filter((x): x is string => !!x),
  );
  if (draft) {
    focusCards.add(draft.from);
    if (draft.target) focusCards.add(draft.target);
  }
  const degree = (id: string) => edges.filter((e) => e.source === id || e.target === id).length;
  const editing = editingEdge ? edges.find((e) => e.key === editingEdge) : undefined;
  const pageTitle = (id: string) => {
    const p = pages.find((x) => x.id === id);
    return p ? `${p.icon} ${p.title || "Untitled"}` : "";
  };

  return (
    <div
      ref={viewport}
      className="oc-fade-in relative h-full w-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      style={{
        backgroundColor: "var(--oc-canvas)",
        backgroundImage: "radial-gradient(var(--oc-canvas-dot) 1px, transparent 1px)",
        backgroundSize: `${GRID * camera.k}px ${GRID * camera.k}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={backgroundMenu}
    >
      {/* World layer: everything inside moves with the camera */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
      >
        <svg
          className="pointer-events-none absolute"
          style={{ left: -SVG_OFFSET, top: -SVG_OFFSET, width: SVG_OFFSET * 2, height: SVG_OFFSET * 2 }}
        >
          <defs>
            {[...Object.entries(EDGE_COLORS).map(([id, c]) => [id, c.stroke]), ["focus", FOCUS_STROKE]].map(
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
              edges.map((edge) => {
                const a = shown.get(edge.source);
                const b = shown.get(edge.target);
                if (!a || !b) return null;
                const curve = connector(a, b);
                const lit = edge.key === hoveredEdge || edge.key === editingEdge ||
                  (!hoverPair && (focusCards.has(edge.source) || focusCards.has(edge.target)));
                const base = EDGE_COLORS[edge.color].stroke;
                const stroke = lit && edge.color === "default" ? FOCUS_STROKE : base;
                const marker = `url(#oc-arrow-${lit && edge.color === "default" ? "focus" : edge.color})`;
                return (
                  <g key={edge.key}>
                    <path
                      d={curve.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={lit ? 2 : 1.5}
                      strokeDasharray={DASH[edge.style]}
                      strokeLinecap="round"
                      markerEnd={marker}
                      markerStart={edge.mutual ? marker : undefined}
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
                d={draftCurve(shown.get(draft.from)!, draft.side, draft.target ? shown.get(draft.target)! : null, draft.to)}
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
          edges.map((edge) => {
            const a = shown.get(edge.source);
            const b = shown.get(edge.target);
            if (!a || !b) return null;
            const showGhost = !edge.label && edge.key === hoveredEdge;
            if (!edge.label && !showGhost) return null;
            const mid = connector(a, b).mid;
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
                {edge.label || "+ Label"}
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
                onDoubleClick={() => onOpenPage(page.id)}
                onContextMenu={(e) => cardMenu(e, page)}
                title="Double-click to open"
                style={{
                  left: p.x - CARD_W / 2,
                  top: p.y - CARD_H / 2,
                  width: CARD_W,
                  height: CARD_H,
                  scale: scale < 1 ? String(scale) : undefined,
                  opacity: out < 1 ? out : undefined,
                  zIndex: child ? undefined : 1,
                  ...(t && !lit && !isDropTarget ? { borderColor: `color-mix(in srgb, ${t.solid} 55%, transparent)`, background: `color-mix(in srgb, ${t.solid} 14%, var(--oc-raised))` } : {}),
                }}
                className={`oc-pop-in absolute flex cursor-pointer flex-col justify-center rounded-xl border px-3 shadow-lg shadow-black/40 transition-[border-color,background-color,box-shadow] duration-150 ${
                  isDropTarget
                    ? "border-sky-400 bg-sky-500/10 ring-2 ring-sky-500/40"
                    : lit
                      ? "border-sky-500/70 bg-neutral-800"
                      : active
                        ? "border-white/25 bg-neutral-800/95"
                        : "border-white/[0.08] bg-[var(--oc-raised)] hover:border-white/20"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-base leading-none">{page.icon}</span>
                  <span className="truncate text-[13px] font-medium text-neutral-100">
                    {page.title || "Untitled"}
                  </span>
                </div>
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
                <div className="mt-1 pl-6 text-[11px] text-neutral-500">
                  {links ? `${links} link${links === 1 ? "" : "s"}` : "No links yet"}
                  {active && <span className="text-neutral-400"> · open</span>}
                </div>

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
              </div>
            );
          })}
      </div>

      {/* Edge popover (screen space, unscaled) */}
      {editing && positions && (() => {
        const a = positions.get(editing.source);
        const b = positions.get(editing.target);
        if (!a || !b) return null;
        const mid = connector(a, b).mid;
        const el = viewport.current;
        const sx = clamp(camera.x + mid.x * camera.k, 150, (el?.clientWidth ?? 800) - 150);
        const sy = clamp(camera.y + mid.y * camera.k + 18, 8, (el?.clientHeight ?? 600) - 300);
        return (
          <EdgePopover
            key={editing.key}
            edge={editing}
            x={sx}
            y={sy}
            from={pageTitle(editing.source)}
            to={pageTitle(editing.target)}
            onChange={(patch) => updateEdge(editing.key, patch)}
            onDelete={() => deleteEdge(editing)}
            onClose={() => setEditingEdge(null)}
          />
        );
      })()}

      {/* Hint */}
      <div className="pointer-events-none absolute left-4 top-3 text-[11px] text-neutral-500">
        Drag to pan · scroll to zoom · drag a card's edge dot onto another card to connect · click a line
        to label it · double-click to open
      </div>

      {pages.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">No pages yet</div>
      )}

      {/* Controls */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-neutral-800/90 p-1 shadow-xl shadow-black/40 backdrop-blur"
      >
        <CanvasButton title="Zoom out" onClick={() => zoomCenter(1 / 1.2)}>
          <Minus className="size-4" />
        </CanvasButton>
        <button
          type="button"
          title="Reset zoom"
          onClick={() => zoomCenter(1 / camera.k)}
          className="h-7 w-12 cursor-pointer rounded-md text-xs tabular-nums text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06]"
        >
          {Math.round(camera.k * 100)}%
        </button>
        <CanvasButton title="Zoom in" onClick={() => zoomCenter(1.2)}>
          <Plus className="size-4" />
        </CanvasButton>
        <span className="mx-0.5 h-4 w-px bg-white/10" />
        <CanvasButton title="Fit to screen" onClick={fit}>
          <Maximize2 className="size-3.5" />
        </CanvasButton>
        <CanvasButton title="Tidy up (re-run auto layout)" onClick={relayout}>
          <Sparkles className="size-3.5" />
        </CanvasButton>
      </div>
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
  x,
  y,
  from,
  to,
  onChange,
  onDelete,
  onClose,
}: {
  edge: VisualEdge;
  x: number;
  y: number;
  from: string;
  to: string;
  onChange: (patch: Partial<Pick<CanvasEdge, "label" | "color" | "style">>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(edge.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const commitLabel = () => {
    if (label.trim() !== edge.label) onChange({ label: label.trim() });
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ left: x, top: y }}
      className="oc-edge-popover oc-pop-in absolute z-20 w-[260px] -translate-x-1/2 origin-top cursor-default rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] p-2 shadow-2xl shadow-black/60"
    >
      <p className="truncate px-1 pb-2 text-[11px] text-neutral-500">
        {from} <span className="text-neutral-600">{edge.mutual ? "↔" : "→"}</span> {to}
      </p>
      <input
        ref={inputRef}
        value={label}
        placeholder="Add a label, e.g. relates to"
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

      <p className="px-1 pb-1.5 pt-3 text-[11px] font-medium text-neutral-500">Color</p>
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

      <p className="px-1 pb-1.5 pt-3 text-[11px] font-medium text-neutral-500">Line</p>
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
      title={title}
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
const anchor = (c: Point, side: Side): Point => ({
  x: c.x + NORMAL[side].x * (CARD_W / 2),
  y: c.y + NORMAL[side].y * (CARD_H / 2),
});

/** Which sides two cards should connect through, by their relative position. */
function facingSides(a: Point, b: Point): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Compare against the card's aspect so wide cards prefer left/right.
  if (Math.abs(dx) * CARD_H > Math.abs(dy) * CARD_W) return dx > 0 ? ["right", "left"] : ["left", "right"];
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

/** Smooth S-curve between two cards, leaving and entering through facing sides. */
function connector(a: Point, b: Point) {
  const [sa, sb] = facingSides(a, b);
  return bezier(anchor(a, sa), NORMAL[sa], anchor(b, sb), NORMAL[sb]);
}

/** The line while dragging: from the grabbed side to the cursor, snapping to a hovered card. */
function draftCurve(from: Point, side: Side, target: Point | null, cursor: Point) {
  const s = anchor(from, side);
  if (target) {
    const [, tb] = facingSides(from, target);
    return bezier(s, NORMAL[side], anchor(target, tb), NORMAL[tb]).d;
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

  const k = 240; // ideal edge length
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
