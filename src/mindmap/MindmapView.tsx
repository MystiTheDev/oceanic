import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng, toSvg } from "html-to-image";
import {
  ArrowRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  GitBranchPlus,
  Scissors,
  ExternalLink,
  FileText,
  Link2,
  Map as MapIcon,
  Maximize2,
  Palette,
  PenLine,
  Plus,
  ScanSearch,
  Shapes,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { api } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { COLOR_IDS, COLORS, colorOf } from "../lib/colors";
import { pickSaveTarget } from "../lib/export";
import { openContextMenu, type MenuItem } from "../components/ContextMenu";
import {
  ROOT,
  childSpot,
  fromRecord,
  layout,
  subtree,
  subjectOf,
  toMermaid,
  toRecord,
  type MNode,
  type NodeStyle,
} from "./model";

export const MINDMAP_SAVED = "oceanic:mindmap-saved";

type Props = {
  mindmapId: string;
  pages: PageMeta[];
  onOpenPage: (id: string) => void;
  onTitle: (id: string, title: string) => void;
};

type TopicData = MNode & {
  editing: boolean;
  isRoot: boolean;
  pageTitle?: string;
  actions: Actions;
};
type Actions = {
  rename: (id: string, label: string) => void;
  stopEditing: () => void;
  setStyle: (id: string, patch: Partial<NodeStyle>) => void;
  addChild: (id: string) => void;
  remove: (id: string) => void;
  linkMenu: (e: React.MouseEvent, id: string) => void;
  /** Detach from the parent: the topic (and its branch) floats free. */
  cut: (id: string) => void;
  /** Arm "connect": the next topic clicked becomes this topic's parent. */
  startConnect: (id: string) => void;
};

/* ------------------------------------------------------------------ node */
const TopicNode = memo(function TopicNode({ data, selected }: NodeProps<Node<TopicData>>) {
  const c = data.style.color ? colorOf(data.style.color) : null;
  const shape = data.style.shape ?? (data.isRoot ? "pill" : "rounded");
  const radius = shape === "pill" ? 999 : shape === "rounded" ? 10 : 3;
  return (
    <>
      <NodeToolbar isVisible={selected && !data.editing} position={Position.Top} offset={10}>
        <div className="oc-mm-toolbar">
          {COLOR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              title={COLORS[id].label}
              className={`oc-mm-swatch ${data.style.color === id ? "is-on" : ""}`}
              style={{ background: COLORS[id].solid }}
              onClick={() => data.actions.setStyle(data.id, { color: data.style.color === id ? undefined : id })}
            />
          ))}
          <span className="oc-mm-sep" />
          {(["pill", "rounded", "rect"] as const).map((s) => (
            <button
              key={s}
              type="button"
              title={`${s[0].toUpperCase()}${s.slice(1)} shape`}
              className={`oc-mm-tool ${shape === s ? "is-on" : ""}`}
              onClick={() => data.actions.setStyle(data.id, { shape: s })}
            >
              <span className="oc-mm-shape" style={{ borderRadius: s === "pill" ? 999 : s === "rounded" ? 4 : 1 }} />
            </button>
          ))}
          {!data.isRoot && (
            <button
              type="button"
              title="Arrow on connector"
              className={`oc-mm-tool ${data.style.arrow ? "is-on" : ""}`}
              onClick={() => data.actions.setStyle(data.id, { arrow: !data.style.arrow })}
            >
              <ArrowRight size={14} />
            </button>
          )}
          <span className="oc-mm-sep" />
          {!data.isRoot && (
            <>
              <button type="button" title="Connect to a topic…" className="oc-mm-tool" onClick={() => data.actions.startConnect(data.id)}>
                <GitBranchPlus size={14} />
              </button>
              {data.parentId && (
                <button type="button" title="Cut connection" className="oc-mm-tool" onClick={() => data.actions.cut(data.id)}>
                  <Scissors size={14} />
                </button>
              )}
              <span className="oc-mm-sep" />
            </>
          )}
          <button type="button" title="Link to a page" className={`oc-mm-tool ${data.linkedPageId ? "is-on" : ""}`} onClick={(e) => data.actions.linkMenu(e, data.id)}>
            <Link2 size={14} />
          </button>
          <button type="button" title="Add child (Tab)" className="oc-mm-tool" onClick={() => data.actions.addChild(data.id)}>
            <Plus size={14} />
          </button>
          {!data.isRoot && (
            <button type="button" title="Delete (Del)" className="oc-mm-tool is-danger" onClick={() => data.actions.remove(data.id)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </NodeToolbar>

      {(["left", "right"] as const).map((side) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={side === "left" ? Position.Left : Position.Right} className="oc-mm-handle" />
      ))}
      {(["left", "right"] as const).map((side) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={side === "left" ? Position.Left : Position.Right} className="oc-mm-handle" />
      ))}

      <div
        className={`oc-mm-node ${data.isRoot ? "is-root" : ""} ${selected ? "is-selected" : ""}`}
        style={{
          borderRadius: radius,
          borderColor: c ? c.text : undefined,
          background: c ? c.bg : undefined,
        }}
        title={data.linkedPageId ? `Double-click to open “${data.pageTitle ?? "page"}”` : "Double-click to edit"}
      >
        {data.editing ? (
          <input
            autoFocus
            defaultValue={data.label}
            className="nodrag oc-mm-input"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => data.actions.rename(data.id, e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
          />
        ) : (
          <span className="oc-mm-label">{data.label || "Untitled"}</span>
        )}
        {data.style.collapsed && <span className="oc-mm-collapsed">+ hidden topics</span>}
        {data.linkedPageId && (
          <span className="oc-mm-link">
            <FileText size={11} /> {data.pageTitle ?? "Missing page"}
          </span>
        )}
      </div>
    </>
  );
});
const nodeTypes = { topic: TopicNode };

/* ---------------------------------------------------------------- editor */
function Editor({ mindmapId, pages, onOpenPage, onTitle }: Props) {
  const rf = useReactFlow();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [nodes, setNodes] = useState<MNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(ROOT);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Topic waiting for its new parent to be clicked. */
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 2500);
  };
  /** Minimap overlay; off by default, remembered per device. */
  const [minimap, setMinimap] = useState(() => {
    try {
      return localStorage.getItem("oceanic.mindmapMinimap") === "1";
    } catch {
      return false;
    }
  });
  const toggleMinimap = () =>
    setMinimap((v) => {
      try {
        localStorage.setItem("oceanic.mindmapMinimap", v ? "0" : "1");
      } catch {
        /* storage blocked */
      }
      return !v;
    });
  const wrap = useRef<HTMLDivElement>(null);
  const measured = useRef(new Map<string, { width: number; height: number }>());
  const [, bumpMeasured] = useState(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    api.getMindmapById(mindmapId).then((m) => {
      if (!m) return;
      setTitle(m.title);
      setSubject(m.subjectTag);
      setNodes(m.nodes.map(fromRecord));
      onTitle(mindmapId, m.title);
    });
  }, [mindmapId]);

  // Debounced autosave of the whole map.
  const loaded = useRef(false);
  useEffect(() => {
    if (!nodes) return;
    if (!loaded.current) return void (loaded.current = true);
    const t = window.setTimeout(() => {
      api
        .saveMindmap(mindmapId, title || "Untitled mindmap", subject, nodes.map(toRecord))
        .then(() => window.dispatchEvent(new CustomEvent(MINDMAP_SAVED, { detail: mindmapId })))
        .catch((e) => console.error("Saving mindmap failed", e));
    }, 500);
    return () => window.clearTimeout(t);
  }, [nodes, title, subject, mindmapId]);

  const update = (fn: (ns: MNode[]) => MNode[]) => setNodes((ns) => (ns ? fn(ns) : ns));

  const addChild = useCallback((parentId: string) => {
    const id = crypto.randomUUID();
    update((ns) => {
      const parent = ns.find((n) => n.id === parentId);
      if (!parent) return ns;
      return [...ns, { id, label: "New topic", ...childSpot(ns, parent), parentId, linkedPageId: null, style: {} }];
    });
    setSelected(id);
    setEditing(id);
  }, []);

  const addSibling = (id: string) => {
    const n = nodes?.find((x) => x.id === id);
    addChild(n?.parentId ?? ROOT);
  };

  const remove = useCallback((id: string) => {
    if (id === ROOT) return;
    update((ns) => {
      const gone = subtree(ns, id);
      setSelected(ns.find((n) => n.id === id)?.parentId ?? ROOT);
      return ns.filter((n) => !gone.has(n.id));
    });
  }, []);

  const pageTitle = useMemo(() => new Map(pages.map((p) => [p.id, `${p.icon} ${p.title || "Untitled"}`])), [pages]);

  const actions: Actions = useMemo(
    () => ({
      rename: (id, label) => {
        update((ns) => ns.map((n) => (n.id === id ? { ...n, label: label.trim() || n.label } : n)));
        if (id === ROOT && label.trim()) {
          setTitle(label.trim());
          onTitle(mindmapId, label.trim());
        }
        setEditing(null);
        wrap.current?.focus();
      },
      stopEditing: () => setEditing(null),
      cut: (id) => update((ns) => ns.map((n) => (n.id === id ? { ...n, parentId: null } : n))),
      startConnect: (id) => setConnectFrom(id),
      setStyle: (id, patch) => update((ns) => ns.map((n) => (n.id === id ? { ...n, style: { ...n.style, ...patch } } : n))),
      addChild,
      remove,
      linkMenu: (e, id) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const current = nodesRef.current?.find((n) => n.id === id)?.linkedPageId;
        const items: MenuItem[] = [
          ...(current
            ? ([{ label: "Remove link", icon: <Unlink className="size-4" />, onSelect: () => update((ns) => ns.map((n) => (n.id === id ? { ...n, linkedPageId: null } : n))) }, "divider"] as MenuItem[])
            : []),
          ...pages.slice(0, 40).map(
            (p): MenuItem => ({
              label: p.title || "Untitled",
              icon: <span className="w-4 text-center text-[13px]">{p.icon}</span>,
              checked: current === p.id,
              onSelect: () => update((ns) => ns.map((n) => (n.id === id ? { ...n, linkedPageId: p.id } : n))),
            }),
          ),
        ];
        openContextMenu({ clientX: r.left, clientY: r.bottom + 6, preventDefault() {}, stopPropagation() {} } as never, items);
      },
    }),
    [pages, mindmapId],
  );

  /** Topics under a collapsed branch are hidden (with their connectors). */
  const hidden = useMemo(() => {
    const out = new Set<string>();
    for (const n of nodes ?? []) if (n.style.collapsed) subtree(nodes!, n.id).forEach((id) => id !== n.id && out.add(id));
    return out;
  }, [nodes]);

  const rfNodes: Node<TopicData>[] = useMemo(
    () =>
      (nodes ?? []).map((n) => ({
        hidden: hidden.has(n.id),
        measured: measured.current.get(n.id),
        id: n.id,
        type: "topic",
        position: { x: n.x, y: n.y },
        origin: [0.5, 0.5] as [number, number],
        selected: n.id === selected,
        data: {
          ...n,
          editing: n.id === editing,
          isRoot: n.id === ROOT,
          pageTitle: n.linkedPageId ? pageTitle.get(n.linkedPageId) : undefined,
          actions,
        },
      })),
    [nodes, selected, editing, actions, pageTitle, hidden],
  );

  const rfEdges: Edge[] = useMemo(() => {
    const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
    return (nodes ?? []).flatMap((n) => {
      const p = n.parentId ? byId.get(n.parentId) : undefined;
      if (!p || hidden.has(n.id)) return [];
      const right = n.x >= p.x;
      const color = n.style.color ? colorOf(n.style.color).text : "var(--oc-mm-edge)";
      return [
        {
          id: `${p.id}->${n.id}`,
          source: p.id,
          target: n.id,
          sourceHandle: right ? "s-right" : "s-left",
          targetHandle: right ? "t-left" : "t-right",
          type: "default",
          style: { stroke: color, strokeWidth: 2 },
          markerEnd: n.style.arrow ? { type: "arrowclosed" as never, color, width: 16, height: 16 } : undefined,
        },
      ];
    });
  }, [nodes, hidden]);

  const onNodesChange = (changes: NodeChange<Node<TopicData>>[]) => {
    let resized = false;
    for (const ch of changes) {
      if (ch.type === "dimensions" && ch.dimensions) {
        const prev = measured.current.get(ch.id);
        if (!prev || prev.width !== ch.dimensions.width || prev.height !== ch.dimensions.height) {
          measured.current.set(ch.id, ch.dimensions);
          resized = true;
        }
      } else if (ch.type === "position" && ch.position) {
        const { x, y } = ch.position;
        update((ns) => ns.map((n) => (n.id === ch.id ? { ...n, x, y } : n)));
      } else if (ch.type === "select" && ch.selected) setSelected(ch.id);
    }
    if (resized) bumpMeasured((v) => v + 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (connectFrom && e.key === "Escape") return void setConnectFrom(null);
    if (editing || !selected || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Tab") addChild(selected);
    else if (e.key === "Enter") selected === ROOT ? addChild(ROOT) : addSibling(selected);
    else if (e.key === "Delete" || e.key === "Backspace") remove(selected);
    else if (e.key === "F2" || e.key === " ") setEditing(selected);
    else return;
    e.preventDefault();
  };

  /** Tidy up with motion: positions ease to the new layout over ~320ms. */
  const tidy = () => {
    const from = nodesRef.current;
    if (!from) return;
    const to = new Map(layout(from).map((n) => [n.id, n]));
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / 320);
      const k = ease(t);
      setNodes(
        from.map((n) => {
          const target = to.get(n.id)!;
          return { ...n, x: n.x + (target.x - n.x) * k, y: n.y + (target.y - n.y) * k };
        }),
      );
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------------ export */
  const exportImage = async (kind: "png" | "svg") => {
    const el = wrap.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el || !nodes) return;
    // Crop to the topics themselves (plus a margin), at 100% zoom.
    const bounds = getNodesBounds(rf.getNodes());
    const pad = 48;
    const w = Math.ceil(bounds.width + pad * 2);
    const h = Math.ceil(bounds.height + pad * 2);
    const opts = {
      backgroundColor: "#ffffff",
      width: w,
      height: h,
      pixelRatio: kind === "png" ? 2 : 1,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${pad - bounds.x}px, ${pad - bounds.y}px) scale(1)` },
      filter: (n: HTMLElement) => !n.classList?.contains("react-flow__node-toolbar"),
    };
    // Dark text on a white sheet: render with the light theme just for the capture.
    const html = document.documentElement;
    const theme = html.dataset.theme;
    html.dataset.theme = "light";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let url: string;
    try {
      url = kind === "png" ? await toPng(el, opts) : await toSvg(el, opts);
    } finally {
      html.dataset.theme = theme;
    }
    const bytes =
      kind === "png"
        ? Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(url.split(",")[1]));
    await save(`${title || "Mindmap"}.${kind}`, bytes);
  };
  const exportMermaid = () =>
    save(`${title || "Mindmap"}.md`, new TextEncoder().encode(`# ${title}\n\n\`\`\`mermaid\n${toMermaid(nodes ?? [])}\n\`\`\`\n`));
  const save = async (name: string, data: Uint8Array) => {
    const target = await pickSaveTarget(name.replace(/[\\/:*?"<>|]/g, "-"));
    if (!target) return;
    await target.write(data);
    setNotice(`Exported to ${target.label}`);
    window.setTimeout(() => setNotice(null), 3000);
  };
  const exportMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu({ clientX: r.left, clientY: r.bottom + 6, preventDefault() {}, stopPropagation() {} } as never, [
      { label: "PNG image (2×)", onSelect: () => void exportImage("png") },
      { label: "SVG vector", onSelect: () => void exportImage("svg") },
      { label: "Mermaid (.md)", onSelect: () => void exportMermaid() },
    ]);
  };

  /* ------------------------------------------------------- right-click */
  const paneMenu = (e: React.MouseEvent | MouseEvent) => {
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    openContextMenu(e, [
      {
        label: "Add topic here",
        icon: <Plus className="size-4" />,
        onSelect: () => {
          const id = crypto.randomUUID();
          update((ns) => [...ns, { id, label: "New topic", x: at.x, y: at.y, parentId: null, linkedPageId: null, style: {} }]);
          setSelected(id);
          setEditing(id);
        },
      },
      "divider",
      { label: "Tidy up", icon: <Sparkles className="size-4" />, onSelect: tidy },
      { label: "Fit to screen", icon: <Maximize2 className="size-4" />, onSelect: () => void rf.fitView({ padding: 0.3, duration: 300 }) },
      { label: "Reset zoom", icon: <ScanSearch className="size-4" />, onSelect: () => void rf.zoomTo(1, { duration: 300 }) },
    ]);
  };

  /** Copies a topic and everything under it, just below the original. */
  const duplicateBranch = (id: string) =>
    update((ns) => {
      const ids = subtree(ns, id);
      const fresh = new Map([...ids].map((x) => [x, crypto.randomUUID()]));
      const copies = ns
        .filter((n) => ids.has(n.id))
        .map((n) => ({
          ...n,
          id: fresh.get(n.id)!,
          parentId: n.id === id ? n.parentId : fresh.get(n.parentId!)!,
          y: n.y + 70,
          style: { ...n.style },
        }));
      return [...ns, ...copies];
    });

  const nodeMenu = (e: React.MouseEvent, id: string) => {
    const n = nodes?.find((x) => x.id === id);
    if (!n) return;
    setSelected(id);
    const isRoot = id === ROOT;
    const childCount = nodes!.filter((x) => x.parentId === id).length;
    const linked = n.linkedPageId ? pages.find((p) => p.id === n.linkedPageId) : undefined;
    const setLink = (pageId: string | null) => update((ns) => ns.map((x) => (x.id === id ? { ...x, linkedPageId: pageId } : x)));
    openContextMenu(e, [
      { label: "Add child", icon: <Plus className="size-4" />, hint: "Tab", onSelect: () => addChild(id) },
      { label: "Add sibling", icon: <Plus className="size-4" />, hint: "Enter", disabled: isRoot, onSelect: () => addSibling(id) },
      { label: "Edit label", icon: <PenLine className="size-4" />, hint: "F2", onSelect: () => setEditing(id) },
      "divider",
      { label: "Connect to a topic…", icon: <GitBranchPlus className="size-4" />, disabled: isRoot, onSelect: () => setConnectFrom(id) },
      { label: "Cut connection", icon: <Scissors className="size-4" />, disabled: isRoot || !n.parentId, onSelect: () => actions.cut(id) },
      "divider",
      {
        label: "Color",
        icon: <Palette className="size-4" />,
        children: [
          { label: "Default", checked: !n.style.color, onSelect: () => actions.setStyle(id, { color: undefined }) },
          ...COLOR_IDS.map(
            (c): MenuItem => ({
              label: COLORS[c].label,
              icon: <span className="block size-3 rounded-full" style={{ background: COLORS[c].solid }} />,
              checked: n.style.color === c,
              onSelect: () => actions.setStyle(id, { color: c }),
            }),
          ),
        ],
      },
      {
        label: "Shape",
        icon: <Shapes className="size-4" />,
        children: (["pill", "rounded", "rect"] as const).map(
          (s): MenuItem => ({
            label: { pill: "Pill", rounded: "Rounded", rect: "Square" }[s],
            checked: (n.style.shape ?? (isRoot ? "pill" : "rounded")) === s,
            onSelect: () => actions.setStyle(id, { shape: s }),
          }),
        ),
      },
      ...(isRoot
        ? []
        : ([
            {
              label: n.style.arrow ? "Hide arrow" : "Show arrow",
              icon: <ArrowRight className="size-4" />,
              onSelect: () => actions.setStyle(id, { arrow: !n.style.arrow }),
            },
          ] as MenuItem[])),
      "divider",
      ...(linked
        ? ([
            { label: "Open linked page", icon: <ExternalLink className="size-4" />, onSelect: () => onOpenPage(linked.id) },
            { label: "Remove link", icon: <Unlink className="size-4" />, onSelect: () => setLink(null) },
          ] as MenuItem[])
        : []),
      {
        label: linked ? "Change linked page" : "Link to page",
        icon: <Link2 className="size-4" />,
        children: pages.length
          ? pages.slice(0, 40).map(
              (p): MenuItem => ({
                label: p.title || "Untitled",
                icon: <span className="w-4 text-center text-[13px]">{p.icon}</span>,
                checked: n.linkedPageId === p.id,
                onSelect: () => setLink(p.id),
              }),
            )
          : [{ label: "No pages yet", disabled: true }],
      },
      "divider",
      { label: "Duplicate branch", icon: <Copy className="size-4" />, disabled: isRoot, onSelect: () => duplicateBranch(id) },
      {
        label: n.style.collapsed ? `Expand branch (${subtree(nodes!, id).size - 1})` : "Collapse branch",
        icon: n.style.collapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />,
        disabled: !childCount,
        onSelect: () => actions.setStyle(id, { collapsed: !n.style.collapsed }),
      },
      { label: "Delete", icon: <Trash2 className="size-4" />, hint: "Del", danger: true, disabled: isRoot, onSelect: () => remove(id) },
    ]);
  };

  if (!nodes) return <div className="h-full" />;
  const subj = subjectOf(subject);

  return (
    <div ref={wrap} tabIndex={0} onKeyDown={onKeyDown} className={`oc-mindmap relative h-full outline-none ${connectFrom ? "is-connecting" : ""}`}>
      {connectFrom && (
        <div className="oc-fade-in absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-lg bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-[#fff] shadow-lg">
          Click a topic to connect “{nodes.find((n) => n.id === connectFrom)?.label}” to it · Esc to cancel
        </div>
      )}
      <div className="absolute left-4 right-4 top-3 z-10 flex items-center gap-2">
        <span className="text-[18px]">{subj.icon}</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            onTitle(mindmapId, e.target.value);
          }}
          placeholder="Untitled mindmap"
          className="min-w-0 flex-1 bg-transparent text-[18px] font-bold tracking-tight text-neutral-100 outline-none placeholder:text-neutral-600"
        />
        <span className="hidden text-[11px] text-neutral-500 md:block">Tab child · Enter sibling · F2 edit · Del remove</span>
        <button type="button" onClick={tidy} className="oc-mm-btn" title="Re-arrange branches">
          <Sparkles size={14} /> Tidy up
        </button>
        <button
          type="button"
          onClick={toggleMinimap}
          aria-pressed={minimap}
          title={minimap ? "Hide minimap" : "Show minimap"}
          className={`oc-mm-btn ${minimap ? "is-on" : ""}`}
        >
          <MapIcon size={14} /> Minimap
        </button>
        <button type="button" onClick={exportMenu} className="oc-mm-btn">
          <Download size={14} /> Export
        </button>
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={(_, n) => {
          const m = nodes.find((x) => x.id === n.id);
          if (m?.linkedPageId && pages.some((p) => p.id === m.linkedPageId)) onOpenPage(m.linkedPageId);
          else setEditing(n.id);
        }}
        onPaneClick={() => (setSelected(null), setConnectFrom(null))}
        onNodeClick={(_, target) => {
          if (!connectFrom || target.id === connectFrom) return;
          const branch = subtree(nodesRef.current ?? [], connectFrom);
          if (branch.has(target.id)) {
            flash("Can't connect a topic to its own branch");
          } else {
            update((ns) => ns.map((n) => (n.id === connectFrom ? { ...n, parentId: target.id } : n)));
          }
          setConnectFrom(null);
        }}
        onPaneContextMenu={paneMenu}
        onNodeContextMenu={(e, n) => nodeMenu(e, n.id)}
        // Centre on the map once its topics are measured (React Flow waits for that).
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1.1 }}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        minZoom={0.15}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        colorMode={document.documentElement.dataset.theme === "light" ? "light" : "dark"}
      >
        <Background gap={22} size={1.2} color="var(--oc-canvas-dot)" />
        <Controls showInteractive={false} position="bottom-right" />
        {minimap && <MiniMap pannable zoomable position="bottom-left" className="oc-mm-minimap" nodeColor={(n) => ((n.data as TopicData).style.color ? colorOf((n.data as TopicData).style.color!).solid : "#5f5e5b")} maskColor="rgba(0,0,0,0.35)" />}
      </ReactFlow>

      {notice && <div className="oc-toast-in absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-[var(--oc-surface)] px-3 py-2 text-[13px] text-neutral-200 shadow-xl">{notice}</div>}
    </div>
  );
}

export function MindmapView(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor key={props.mindmapId} {...props} />
    </ReactFlowProvider>
  );
}
