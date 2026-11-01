/* ---------------------------------------------------------------------------
 * Mindmap embed: a read-only preview of a saved mindmap inside a note, with
 * an Open button that brings up the mindmap in its own tab.
 * ------------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ExternalLink } from "lucide-react";
import { api, type MindmapRecord } from "../data/api";
import { colorOf } from "../lib/colors";
import { fromRecord, subjectOf, type MNode } from "../mindmap/model";

export const OPEN_MINDMAP = "oceanic:open-mindmap";
const MINDMAP_SAVED = "oceanic:mindmap-saved";

export function Preview({ nodes }: { nodes: MNode[] }) {
  if (!nodes.length) return null;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const pad = 90;
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - 40, Math.max(...ys) + 40];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {nodes.map((n) => {
        const p = n.parentId ? byId.get(n.parentId) : undefined;
        if (!p) return null;
        const mx = (p.x + n.x) / 2;
        return (
          <path
            key={`e${n.id}`}
            d={`M${p.x},${p.y} C${mx},${p.y} ${mx},${n.y} ${n.x},${n.y}`}
            fill="none"
            stroke={n.style.color ? colorOf(n.style.color).text : "var(--oc-mm-edge)"}
            strokeWidth={3}
          />
        );
      })}
      {nodes.map((n) => {
        const w = Math.min(200, 24 + n.label.length * 9);
        const c = n.style.color ? colorOf(n.style.color) : null;
        return (
          <g key={n.id}>
            <rect
              x={n.x - w / 2}
              y={n.y - 17}
              width={w}
              height={34}
              rx={n.parentId ? 9 : 17}
              fill={c ? c.bg : "var(--oc-raised)"}
              stroke={c ? c.text : "rgba(var(--oc-ink),0.18)"}
            />
            <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={14} fontWeight={n.parentId ? 500 : 700} fill="var(--oc-text-strong)">
              {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const MindmapEmbed = createReactBlockSpec(
  { type: "mindmapEmbed", propSchema: { mindmapId: { default: "" } }, content: "none" },
  {
    render: function MindmapEmbedView({ block, editor }) {
      const id = block.props.mindmapId;
      const [maps, setMaps] = useState<MindmapRecord[]>([]);
      const [map, setMap] = useState<{ title: string; subject: string; nodes: MNode[] } | null>(null);

      useEffect(() => {
        if (!id) {
          api.getAllMindmaps().then(setMaps);
          return;
        }
        const load = () =>
          api.getMindmapById(id).then((m) => setMap(m ? { title: m.title, subject: m.subjectTag, nodes: m.nodes.map(fromRecord) } : null));
        void load();
        const onSaved = (e: Event) => (e as CustomEvent).detail === id && void load();
        window.addEventListener(MINDMAP_SAVED, onSaved);
        return () => window.removeEventListener(MINDMAP_SAVED, onSaved);
      }, [id]);

      if (!id) {
        return (
          <div className="oc-mm-embed is-empty" contentEditable={false}>
            <p className="oc-mm-embed-title">🧠 Embed a mindmap</p>
            {maps.length ? (
              <div className="oc-mm-embed-pick">
                {maps.map((m) => (
                  <button key={m.id} type="button" onClick={() => editor.updateBlock(block, { props: { mindmapId: m.id } } as never)}>
                    {subjectOf(m.subjectTag).icon} {m.title}
                  </button>
                ))}
              </div>
            ) : (
              <p className="oc-mm-embed-hint">No mindmaps yet. Create one from More apps → Oceanic Mindmap.</p>
            )}
          </div>
        );
      }

      return (
        <div className="oc-mm-embed" contentEditable={false}>
          <div className="oc-mm-embed-head">
            <span className="oc-mm-embed-title">
              {map ? `${subjectOf(map.subject).icon} ${map.title}` : "Mindmap not found"}
            </span>
            {map && (
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_MINDMAP, { detail: id }))}>
                <ExternalLink size={13} /> Open
              </button>
            )}
          </div>
          <div className="oc-mm-embed-canvas" onDoubleClick={() => map && window.dispatchEvent(new CustomEvent(OPEN_MINDMAP, { detail: id }))}>
            {map && <Preview nodes={map.nodes} />}
          </div>
        </div>
      );
    },
  },
);
