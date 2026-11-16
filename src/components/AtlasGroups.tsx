import { useState } from "react";
import { ChevronDown, ChevronRight, PenLine, Trash2 } from "lucide-react";
import type { ConceptGroup } from "../data/api";
import { tagColor } from "../lib/colors";
import { openContextMenu } from "./ContextMenu";

type Point = { x: number; y: number };

const PAD = 22;
const LABEL_H = 26;

/**
 * Atlas groups in world coordinates: a tinted frame around each open group's
 * cards, and one summary card for each collapsed group (at its members' centre).
 * Sits under the cards and lines; only the label and summary take clicks.
 */
export function AtlasGroups({
  groups,
  membersOf,
  at,
  cardW,
  cardH,
  renaming,
  onRename,
  onToggle,
  onDelete,
  onStartRename,
}: {
  groups: ConceptGroup[];
  membersOf: (groupId: string) => string[];
  /** World position of a shown card (or a collapsed group's summary). */
  at: (id: string) => Point | undefined;
  cardW: number;
  cardH: number;
  renaming: string | null;
  onRename: (g: ConceptGroup, name: string) => void;
  onToggle: (g: ConceptGroup) => void;
  onDelete: (g: ConceptGroup) => void;
  onStartRename: (id: string | null) => void;
}) {
  const menu = (e: React.MouseEvent, g: ConceptGroup) => {
    e.stopPropagation();
    openContextMenu(e, [
      { label: "Rename group", icon: <PenLine className="size-4" />, onSelect: () => onStartRename(g.id) },
      { label: g.collapsed ? "Expand" : "Collapse", icon: g.collapsed ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />, onSelect: () => onToggle(g) },
      "divider",
      { label: "Delete group (keep concepts)", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(g) },
    ]);
  };

  return (
    <>
      {groups.map((g) => {
        const tint = tagColor(g.id).solid;
        const name =
          renaming === g.id ? (
            <RenameInput value={g.name} onDone={(v) => (onStartRename(null), v && v !== g.name && onRename(g, v))} />
          ) : (
            <span className="truncate" onDoubleClick={(e) => (e.stopPropagation(), onStartRename(g.id))}>
              {g.name}
            </span>
          );

        if (g.collapsed) {
          const p = at(g.id);
          if (!p) return null;
          return (
            <div
              key={g.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onToggle(g)}
              onContextMenu={(e) => menu(e, g)}
              title="Collapsed group · click to expand"
              className="oc-pop-in absolute z-[1] flex cursor-pointer flex-col justify-center rounded-2xl border-2 border-dashed px-4 shadow-md shadow-black/25"
              style={{ left: p.x - cardW / 2, top: p.y - cardH / 2, width: cardW, height: cardH, borderColor: `color-mix(in srgb, ${tint} 60%, transparent)`, background: `color-mix(in srgb, ${tint} 14%, var(--oc-raised))` }}
            >
              <span className="flex items-center gap-1.5 text-[14px] font-semibold text-neutral-100">
                <ChevronRight className="size-3.5 shrink-0 text-neutral-400" />
                {name}
              </span>
              <span className="pl-5 text-[11px] text-neutral-400">{membersOf(g.id).length} concepts</span>
            </div>
          );
        }

        const pts = membersOf(g.id).map(at).filter((p): p is Point => !!p);
        if (!pts.length) return null;
        const minX = Math.min(...pts.map((p) => p.x)) - cardW / 2 - PAD;
        const maxX = Math.max(...pts.map((p) => p.x)) + cardW / 2 + PAD;
        const minY = Math.min(...pts.map((p) => p.y)) - cardH / 2 - PAD - LABEL_H;
        const maxY = Math.max(...pts.map((p) => p.y)) + cardH / 2 + PAD;
        return (
          <div
            key={g.id}
            className="pointer-events-none absolute rounded-3xl border transition-[left,top,width,height] duration-150"
            style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY, borderColor: `color-mix(in srgb, ${tint} 40%, transparent)`, background: `color-mix(in srgb, ${tint} 7%, transparent)` }}
          >
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => menu(e, g)}
              className="pointer-events-auto absolute left-3 top-1.5 flex max-w-[80%] items-center gap-1 text-[12px] font-semibold"
              style={{ color: `color-mix(in srgb, ${tint} 80%, white)` }}
            >
              <button type="button" title="Collapse group" onClick={() => onToggle(g)} className="grid size-5 shrink-0 cursor-pointer place-items-center rounded hover:bg-white/10">
                <ChevronDown className="size-3.5" />
              </button>
              {name}
            </div>
          </div>
        );
      })}
    </>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v.trim());
        if (e.key === "Escape") onDone("");
      }}
      className="w-40 rounded bg-black/30 px-1 text-neutral-100 outline-none ring-1 ring-white/20"
    />
  );
}
