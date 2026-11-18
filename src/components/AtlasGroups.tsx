import { useState, type PointerEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, Palette, PenLine, Trash2 } from "lucide-react";
import type { ConceptGroup, GroupRect } from "../data/api";
import { PALETTE } from "../data/atlas";
import { openContextMenu } from "./ContextMenu";

type Point = { x: number; y: number };

/** Height of a section's label bar (world units). */
export const GROUP_HEADER = 34;

/**
 * Atlas groups as Heptabase-style sections in world coordinates: a tinted box
 * with a coloured label bar. Drag the bar to move the section with everything
 * in it; drag the bottom-right corner to resize. A collapsed group is one
 * summary card at the section's centre. Sits under the cards and lines.
 */
export function AtlasGroups({
  groups,
  rectOf,
  tintOf,
  countOf,
  cardW,
  cardH,
  renaming,
  dropTarget,
  onRename,
  onToggle,
  onDelete,
  onStartRename,
  onColor,
  onHeaderDown,
  onResizeDown,
}: {
  groups: ConceptGroup[];
  /** Section box (world coords); undefined while it has nothing to size around. */
  rectOf: (g: ConceptGroup) => GroupRect | undefined;
  tintOf: (g: ConceptGroup) => string;
  countOf: (g: ConceptGroup) => { concepts: number; notes: number };
  cardW: number;
  cardH: number;
  renaming: string | null;
  /** Group a dragged card would join on drop. */
  dropTarget: string | null;
  onRename: (g: ConceptGroup, name: string) => void;
  onToggle: (g: ConceptGroup) => void;
  onDelete: (g: ConceptGroup) => void;
  onStartRename: (id: string | null) => void;
  onColor: (g: ConceptGroup, color: string | null) => void;
  onHeaderDown: (e: PointerEvent, g: ConceptGroup) => void;
  onResizeDown: (e: PointerEvent, g: ConceptGroup) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const menu = (e: React.MouseEvent, g: ConceptGroup) => {
    e.stopPropagation();
    openContextMenu(e, [
      { label: "Rename group", icon: <PenLine className="size-4" />, onSelect: () => onStartRename(g.id) },
      { label: "Color", icon: <Palette className="size-4" />, onSelect: () => setPicking(g.id) },
      { label: g.collapsed ? "Expand" : "Collapse", icon: g.collapsed ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />, onSelect: () => onToggle(g) },
      "divider",
      { label: "Delete group (keep cards)", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(g) },
    ]);
  };
  const summary = (g: ConceptGroup) => {
    const n = countOf(g);
    const parts = [n.concepts && `${n.concepts} concept${n.concepts === 1 ? "" : "s"}`, n.notes && `${n.notes} note${n.notes === 1 ? "" : "s"}`].filter(Boolean);
    return parts.join(" · ") || "Empty · drag cards in";
  };

  return (
    <>
      {groups.map((g) => {
        const r = rectOf(g);
        if (!r) return null;
        const tint = tintOf(g);
        const name =
          renaming === g.id ? (
            <RenameInput value={g.name} onDone={(v) => (onStartRename(null), v && v !== g.name && onRename(g, v))} />
          ) : (
            <span className="truncate" onDoubleClick={(e) => (e.stopPropagation(), onStartRename(g.id))}>
              {g.name}
            </span>
          );
        const palette = picking === g.id && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="oc-pop-in absolute left-0 top-full z-20 mt-1.5 flex gap-1 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1.5 shadow-xl shadow-black/40"
          >
            {Object.entries(PALETTE).map(([key, c]) => (
              <button
                key={key}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => (onColor(g, key), setPicking(null))}
                className={`size-5 cursor-pointer rounded-full transition-transform hover:scale-110 ${g.color === key ? "ring-2 ring-white/70 ring-offset-1 ring-offset-[var(--oc-surface)]" : ""}`}
                style={{ background: c.color }}
              />
            ))}
            <button type="button" onClick={() => (onColor(g, null), setPicking(null))} className="cursor-pointer rounded px-1.5 text-[11px] text-neutral-400 hover:bg-white/[0.06]">
              Auto
            </button>
          </div>
        );

        if (g.collapsed) {
          const p: Point = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
          return (
            <div
              key={g.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onToggle(g)}
              onContextMenu={(e) => menu(e, g)}
              title="Collapsed group · click to expand"
              className="oc-pop-in absolute z-[1] flex cursor-pointer flex-col justify-center rounded-2xl border-2 px-4 shadow-md shadow-black/25 transition-transform duration-150 hover:-translate-y-0.5"
              style={{ left: p.x - cardW / 2, top: p.y - cardH / 2, width: cardW, height: cardH, borderColor: `color-mix(in srgb, ${tint} 65%, transparent)`, background: `color-mix(in srgb, ${tint} 16%, var(--oc-raised))` }}
            >
              <span className="flex items-center gap-1.5 text-[14px] font-semibold text-neutral-100">
                <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                {name}
              </span>
              <span className="pl-5 text-[11px] opacity-60">{summary(g)}</span>
              {palette}
            </div>
          );
        }

        const drop = dropTarget === g.id;
        return (
          <div
            key={g.id}
            className="pointer-events-none absolute rounded-2xl border transition-[border-color,background-color,box-shadow] duration-200"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              borderColor: `color-mix(in srgb, ${tint} ${drop ? 85 : 45}%, transparent)`,
              background: `color-mix(in srgb, ${tint} ${drop ? 13 : 7}%, transparent)`,
              boxShadow: drop ? `0 0 0 4px color-mix(in srgb, ${tint} 22%, transparent)` : undefined,
            }}
          >
            {/* Label bar: drag to move the whole section */}
            <div
              onPointerDown={(e) => (setPicking(null), onHeaderDown(e, g))}
              onContextMenu={(e) => menu(e, g)}
              title="Drag to move the group"
              className="pointer-events-auto absolute inset-x-0 top-0 flex cursor-grab items-center gap-1.5 rounded-t-2xl px-2 active:cursor-grabbing"
              style={{ height: GROUP_HEADER }}
            >
              <span
                className="flex min-w-0 max-w-[75%] items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px] font-semibold text-white shadow-sm shadow-black/30"
                style={{ background: tint }}
              >
                <GripVertical className="size-3.5 shrink-0 opacity-70" />
                {name}
              </span>
              <span className="truncate text-[11px] opacity-60">{summary(g)}</span>
              <span className="flex-1" />
              <button
                type="button"
                title="Color"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPicking((p) => (p === g.id ? null : g.id))}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-60 hover:bg-white/10 hover:opacity-100"
              >
                <span className="size-3 rounded-full" style={{ background: tint }} />
              </button>
              <button
                type="button"
                title="Collapse group"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onToggle(g)}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-60 hover:bg-white/10 hover:opacity-100"
              >
                <ChevronDown className="size-3.5" />
              </button>
              {palette}
            </div>
            {/* Resize handle */}
            <div
              onPointerDown={(e) => onResizeDown(e, g)}
              title="Drag to resize"
              className="pointer-events-auto absolute -bottom-1 -right-1 size-4 cursor-nwse-resize"
            >
              <span className="absolute bottom-1.5 right-1.5 size-2 rounded-sm border-b-2 border-r-2" style={{ borderColor: `color-mix(in srgb, ${tint} 80%, transparent)` }} />
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
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v.trim());
        if (e.key === "Escape") onDone("");
      }}
      className="w-40 rounded bg-black/30 px-1 text-white outline-none ring-1 ring-white/30"
    />
  );
}
