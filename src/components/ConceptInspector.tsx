import { useEffect, useState } from "react";
import { Link2Off, Plus, Route, X } from "lucide-react";
import { api, CONCEPT_STATES, type CanvasEdge, type Concept, type ConceptGroup, type MindmapRecord } from "../data/api";
import { Select } from "./SettingsModal";
import type { PageMeta } from "../data/workspace";
import { REL_COLORS, REL_LABELS, SYMMETRIC_TYPES } from "../data/atlas";
import { docTitle, useDocs } from "../docs/store";
import { sketchTitle, useSketch } from "../sketch/store";
import { SlidePill } from "./SlidePill";

const STATE_LABELS: Record<Concept["state"], string> = {
  unexplored: "Unexplored", learning: "Learning", understood: "Understood", mastered: "Mastered", review: "Needs review",
};
/** Short labels for the segmented control; the full label is the tooltip. */
const STATE_SHORT: Record<Concept["state"], string> = {
  unexplored: "New", learning: "Learning", understood: "Got it", mastered: "Mastered", review: "Review",
};
/** Learning-state colors, shared with the concept cards. */
export const STATE_COLORS: Record<Concept["state"], string> = {
  unexplored: "#737373", learning: "#f59e0b", understood: "#38bdf8", mastered: "#22c55e", review: "#f43f5e",
};

type Resource = { entryId: string; title: string; missing: boolean };

/**
 * Atlas's right-hand panel for the selected concept: its details, its
 * relationships, and the existing resources (pages, docs, mind maps,
 * sketches) attached to it by reference.
 */
export function ConceptInspector({
  concept,
  edges,
  titleOf,
  attached,
  pages,
  onChange,
  onAttach,
  onDetach,
  onOpen,
  onSelect,
  onClose,
  onRemoveEdge,
  path,
  onTogglePath,
  groups,
  onGroup,
}: {
  concept: Concept;
  /** Drawn connections touching this concept. */
  edges: CanvasEdge[];
  titleOf: (id: string) => string;
  /** Entry ids attached to this concept. */
  attached: string[];
  pages: PageMeta[];
  onChange: (patch: Pick<Concept, "title" | "description" | "tags" | "state">) => void;
  onAttach: (entryId: string) => void;
  onDetach: (entryId: string) => void;
  onOpen: (entryId: string) => void;
  onSelect: (nodeId: string) => void;
  onClose: () => void;
  onRemoveEdge: (edge: CanvasEdge) => void;
  /** Prerequisites in learning order (from "Depends on" links), when the pathway is shown. */
  path: { order: string[]; cycle: string[] } | null;
  onTogglePath: () => void;
  groups: ConceptGroup[];
  /** Group id, `null` for none, or `"new"` for a new group. */
  onGroup: (groupId: string | null) => void;
}) {
  const docs = useDocs().files;
  const sketches = useSketch().files;
  const [mindmaps, setMindmaps] = useState<MindmapRecord[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    api.getAllMindmaps().then(setMindmaps).catch(() => setMindmaps([]));
  }, []);

  /** Everything that can be attached, by entry id. */
  const available: Resource[] = [
    ...pages.map((p) => ({ entryId: p.id, title: `${p.icon} ${p.title || "Untitled"}`, missing: false })),
    ...mindmaps.map((m) => ({ entryId: `mindmap:${m.id}`, title: `🧠 ${m.title || "Untitled mind map"}`, missing: false })),
    ...docs.map((d) => ({ entryId: `doc:${d.path}`, title: `📄 ${docTitle(d.path)}`, missing: false })),
    ...sketches.map((s) => ({ entryId: `sketch:${s.path}`, title: `🎨 ${sketchTitle(s.path)}`, missing: false })),
  ];
  const resolve = (entryId: string): Resource => {
    const hit = available.find((r) => r.entryId === entryId);
    if (hit) return hit;
    // Docs and sketches are files outside the listed folder are still openable; pages/mind maps are gone.
    if (entryId.startsWith("doc:")) return { entryId, title: `📄 ${docTitle(entryId.slice(4))}`, missing: false };
    if (entryId.startsWith("sketch:")) return { entryId, title: `🎨 ${sketchTitle(entryId.slice(7))}`, missing: false };
    // `heading:<pageId>:<blockId>`: a section of a note.
    if (entryId.startsWith("heading:")) {
      const p = pages.find((x) => x.id === entryId.split(":")[1]);
      if (p) return { entryId, title: `📍 ${p.title || "Untitled"} › section`, missing: false };
    }
    return { entryId, title: "Deleted resource", missing: true };
  };

  const save = (patch: Partial<Pick<Concept, "title" | "description" | "tags" | "state">>) =>
    onChange({ title: concept.title, description: concept.description, tags: concept.tags, state: concept.state, ...patch });

  const field =
    "w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 text-[13px] text-neutral-100 outline-none transition-colors duration-100 placeholder:text-neutral-500 focus:border-sky-500/60";
  const heading = "px-0.5 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-neutral-500";
  const [tagDraft, setTagDraft] = useState("");
  const addTags = (raw: string) => {
    const next = [...concept.tags];
    for (const t of raw.split(",").map((x) => x.trim()).filter(Boolean)) if (!next.includes(t)) next.push(t);
    if (next.length !== concept.tags.length) save({ tags: next });
    setTagDraft("");
  };

  return (
    <aside
      data-atlas-overlay
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="oc-fade-in absolute bottom-16 right-3 top-3 z-20 flex w-[min(300px,calc(100%-1.5rem))] cursor-default flex-col overflow-y-auto [&>*]:shrink-0 rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] p-4 shadow-xl shadow-black/40"
    >
      <div className="flex items-center justify-between pb-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-sky-400">Concept</span>
        <button type="button" title="Close" onClick={onClose} className="cursor-pointer rounded p-0.5 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200">
          <X className="size-4" />
        </button>
      </div>

      <input
        key={`t-${concept.id}-${concept.title}`}
        defaultValue={concept.title}
        onBlur={(e) => e.target.value.trim() && e.target.value !== concept.title && save({ title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`${field} text-[15px] font-semibold`}
      />
      <textarea
        key={`d-${concept.id}-${concept.description}`}
        defaultValue={concept.description}
        placeholder="Explain this idea in your own words"
        rows={3}
        onBlur={(e) => e.target.value !== concept.description && save({ description: e.target.value })}
        className={`${field} mt-2 resize-none`}
      />

      <p className={heading}>Learning state</p>
      <div role="radiogroup" aria-label="Learning state" className="grid grid-cols-5 gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
        <SlidePill />
        {CONCEPT_STATES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={concept.state === s}
            data-tip={STATE_LABELS[s]}
            onClick={() => save({ state: s })}
            className={`flex h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-md text-[10.5px] transition-colors duration-100 ${
              concept.state === s ? "font-medium text-neutral-100" : "text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-200"
            }`}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: STATE_COLORS[s] }} />
            {STATE_SHORT[s]}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-neutral-500">Group</p>
        <Select<string>
          value={concept.groupId ?? "none"}
          onChange={(v) => onGroup(v === "none" ? null : v)}
          options={[["none", "No group"], ...groups.map((g): [string, string] => [g.id, g.name]), ["new", "New group…"]]}
        />
      </div>

      <p className={heading}>Tags</p>
      {concept.tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {concept.tags.map((t) => (
            <span key={t} className="flex h-6 items-center gap-1 rounded-md bg-white/[0.06] pl-2 pr-1 text-[11.5px] text-neutral-200">
              {t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={() => save({ tags: concept.tags.filter((x) => x !== t) })}
                className="cursor-pointer rounded text-neutral-500 hover:text-neutral-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={tagDraft}
        placeholder={concept.tags.length ? "Add a tag" : "e.g. physics, chapter 3"}
        onChange={(e) => (e.target.value.endsWith(",") ? addTags(e.target.value) : setTagDraft(e.target.value))}
        onBlur={() => addTags(tagDraft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") addTags(tagDraft);
          if (e.key === "Backspace" && !tagDraft && concept.tags.length) save({ tags: concept.tags.slice(0, -1) });
        }}
        className={field}
      />

      <p className={heading}>Relationships</p>
      {edges.length === 0 && <p className="px-0.5 text-[12px] text-neutral-500">Drag from this card's edge to connect it.</p>}
      {edges.map((e) => {
        const out = e.sourceId === concept.id;
        const other = out ? e.targetId : e.sourceId;
        return (
          <div key={`${e.sourceId}>${e.targetId}`} className="group flex items-center rounded-md hover:bg-white/[0.05]">
            <button
              type="button"
              onClick={() => onSelect(other)}
              title={e.label || undefined}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1.5 text-left text-[12.5px]"
            >
              <span
                className="shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium"
                style={{ color: REL_COLORS[e.relType], backgroundColor: `color-mix(in srgb, ${REL_COLORS[e.relType]} 14%, transparent)` }}
              >
                {REL_LABELS[e.relType]}
              </span>
              <span className="shrink-0 text-neutral-500">{SYMMETRIC_TYPES.has(e.relType) ? "↔" : out ? "→" : "←"}</span>
              <span className="truncate text-neutral-200">{titleOf(other)}</span>
            </button>
            <button
              type="button"
              aria-label="Remove relationship"
              data-tip="Remove relationship"
              onClick={() => onRemoveEdge(e)}
              className="mr-1 cursor-pointer rounded p-0.5 text-neutral-500 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onTogglePath}
        className={`mt-3 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium transition-colors duration-150 ${
          path ? "border-violet-400/60 bg-violet-500/15 text-violet-100" : "border-white/[0.08] text-neutral-300 hover:bg-white/[0.05]"
        }`}
      >
        <Route className="size-3.5" /> {path ? "Hide pathway" : "What should I understand first?"}
      </button>
      {path && (
        <div className="oc-fade-in mt-2 rounded-md bg-white/[0.03] p-1.5">
          {path.order.length === 0 ? (
            <p className="px-1 text-[12px] leading-snug text-neutral-500">
              No prerequisites yet. Connect this concept to another with <b>Depends on</b> to build a pathway.
            </p>
          ) : (
            <ol>
              {path.order.map((id, i) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1 text-left text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-500/80 text-[10px] font-semibold text-white">{i + 1}</span>
                    <span className="truncate">{titleOf(id)}</span>
                  </button>
                </li>
              ))}
              <li className="flex items-center gap-2 px-1 py-1 text-[12px] font-medium text-violet-200">
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-violet-400 text-[10px]">★</span>
                <span className="truncate">{concept.title}</span>
              </li>
            </ol>
          )}
          {path.cycle.length > 0 && (
            <p className="mt-1 px-1 text-[11px] leading-snug text-amber-400/90">
              Loop found: {path.cycle.map(titleOf).join(" → ")} depend on each other in a circle. Change one of these "Depends on" links to fix the order.
            </p>
          )}
          <p className="mt-1 px-1 text-[10px] text-neutral-600">Built only from your "Depends on" links.</p>
        </div>
      )}

      <p className={heading}>Resources</p>
      {attached.map((id) => {
        const r = resolve(id);
        return (
          <div key={id} className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-white/[0.05]">
            <button
              type="button"
              disabled={r.missing}
              onClick={() => onOpen(id)}
              className={`min-w-0 flex-1 truncate text-left text-[12px] ${r.missing ? "text-neutral-600 line-through" : "cursor-pointer text-neutral-200"}`}
            >
              {r.title}
            </button>
            <button
              type="button"
              title="Remove link (keeps the resource)"
              onClick={() => onDetach(id)}
              className="cursor-pointer rounded p-0.5 text-neutral-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
            >
              <Link2Off className="size-3.5" />
            </button>
          </div>
        );
      })}
      {picking ? (
        <div className="mt-1 rounded-md border border-white/[0.08] p-1">
          <input
            autoFocus
            value={query}
            placeholder="Search pages, docs, mind maps, sketches"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setPicking(false)}
            className={field}
          />
          <div className="mt-1 max-h-48 overflow-y-auto">
            {available
              .filter((r) => !attached.includes(r.entryId) && r.title.toLowerCase().includes(query.toLowerCase()))
              .map((r) => (
                <button
                  key={r.entryId}
                  type="button"
                  onClick={() => {
                    onAttach(r.entryId);
                    setPicking(false);
                    setQuery("");
                  }}
                  className="block w-full cursor-pointer truncate rounded px-1.5 py-1 text-left text-[12px] text-neutral-300 hover:bg-white/[0.06] hover:text-neutral-100"
                >
                  {r.title}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200"
        >
          <Plus className="size-3.5" /> Attach resource
        </button>
      )}
    </aside>
  );
}
