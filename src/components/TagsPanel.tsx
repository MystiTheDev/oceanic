import { useState } from "react";
import { MoreHorizontal, Palette, PenLine, Tag, Trash2, X } from "lucide-react";
import type { PageStatus } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { COLOR_IDS, COLORS, STATUSES, tagColor } from "../lib/colors";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { Modal, ModalButton } from "./Modal";
import { StatusBadge, TagChip } from "./PageProperties";
import { TagPicker } from "./TagPicker";

type TagsPanelProps = {
  /** Live pages of every workspace. */
  pages: PageMeta[];
  onOpenPage: (id: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onDeleteTag: (tag: string) => void;
  onTagColor: (tag: string, color: string) => void;
  /** Tags created here; the only ones offered on pages. */
  library: string[];
  onCreateTag: (tag: string, color: string) => void;
  onClose: () => void;
};

/** Every tag and status across all pages; pick several to filter (pages must match all). */
export function TagsPanel({ pages, onOpenPage, onRenameTag, onDeleteTag, onTagColor, library, onCreateTag, onClose }: TagsPanelProps) {
  const [creating, setCreating] = useState(false);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<PageStatus>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const tagCounts = new Map<string, number>();
  for (const p of pages) for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const allTags = [...new Set([...tagCounts.keys(), ...library])].sort((a, b) => a.localeCompare(b));
  const statusCount = (s: PageStatus) => pages.filter((p) => p.status === s).length;

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };

  const filtering = tags.size > 0 || statuses.size > 0;
  const matches = filtering
    ? pages.filter(
        (p) =>
          [...tags].every((t) => p.tags?.includes(t)) && (statuses.size === 0 || (p.status && statuses.has(p.status))),
      )
    : [];

  const tagMenu = (e: React.MouseEvent, tag: string) =>
    openContextMenu(e, [
      { label: "Rename", icon: <PenLine className="size-4" />, onSelect: () => setRenaming(tag) },
      {
        label: "Color",
        icon: <Palette className="size-4" />,
        children: COLOR_IDS.map(
          (id): MenuItem => ({
            label: COLORS[id].label,
            icon: <span className="block size-3 rounded" style={{ backgroundColor: COLORS[id].bg, outline: `1px solid ${COLORS[id].text}` }} />,
            checked: tagColor(tag) === COLORS[id],
            onSelect: () => onTagColor(tag, id),
          }),
        ),
      },
      "divider",
      { label: "Delete tag", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirmDelete(tag) },
    ]);

  return (
    <Modal onClose={onClose} className="flex h-[540px] w-[min(820px,92vw)]">
      <div className="scrollbar-thin flex w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.06] bg-white/[0.02] p-2">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-neutral-500">Status</p>
        {(Object.keys(STATUSES) as PageStatus[]).map((s) => (
          <FilterRow key={s} active={statuses.has(s)} count={statusCount(s)} onClick={() => toggle(statuses, s, setStatuses)}>
            <StatusBadge status={s} small />
          </FilterRow>
        ))}

        <div className="relative flex items-center px-2 pb-1 pt-4">
          <p className="flex-1 text-[11px] font-medium text-neutral-500">Tags</p>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-sky-400 hover:bg-white/[0.06]"
          >
            + New tag
          </button>
          {creating && (
            <TagPicker className="inset-x-1" library={library} exclude={library} onPick={() => {}} onCreate={onCreateTag} onClose={() => setCreating(false)} />
          )}
        </div>
        {allTags.length === 0 && <p className="px-2 py-2 text-[12px] text-neutral-600">No tags yet.</p>}
        {allTags.map((t) =>
          renaming === t ? (
            <input
              key={t}
              autoFocus
              defaultValue={t}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t) onRenameTag(t, v);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="mx-1 my-0.5 h-7 rounded-md border border-sky-500/60 bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none"
            />
          ) : (
            <FilterRow
              key={t}
              active={tags.has(t)}
              count={tagCounts.get(t) ?? 0}
              onClick={() => toggle(tags, t, setTags)}
              onMenu={(e) => tagMenu(e, t)}
            >
              <TagChip tag={t} small />
            </FilterRow>
          ),
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
          <Tag className="size-4 text-neutral-500" />
          <h2 className="flex-1 text-[14px] font-semibold text-neutral-100">Tags &amp; status</h2>
          {filtering && (
            <button
              type="button"
              onClick={() => (setTags(new Set()), setStatuses(new Set()))}
              className="h-7 cursor-pointer rounded-md px-2 text-[12px] text-neutral-400 hover:bg-white/[0.06]"
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {!filtering ? (
            <p className="px-4 py-12 text-center text-[13px] text-neutral-500">
              Pick tags or statuses on the left to see their pages. Pages must match every tag you pick.
            </p>
          ) : matches.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-neutral-500">No pages match.</p>
          ) : (
            matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => (onOpenPage(p.id), onClose())}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[14px] transition-colors hover:bg-white/[0.05]"
              >
                <span className="shrink-0">{p.icon}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-200">{p.title || "Untitled"}</span>
                {p.tags?.slice(0, 3).map((t) => <TagChip key={t} tag={t} small />)}
                {p.status && <StatusBadge status={p.status} small />}
              </button>
            ))
          )}
        </div>
      </div>

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <div className="flex flex-col gap-3 p-5">
            <h2 className="text-[15px] font-semibold text-neutral-100">Delete tag “{confirmDelete}”?</h2>
            <p className="text-[13px] text-neutral-400">
              It is removed from {tagCounts.get(confirmDelete) ?? 0} page(s). The pages themselves stay.
            </p>
            <div className="flex justify-end gap-2">
              <ModalButton onClick={() => setConfirmDelete(null)}>Cancel</ModalButton>
              <ModalButton
                variant="danger"
                autoFocus
                onClick={() => {
                  onDeleteTag(confirmDelete);
                  tags.delete(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                Delete tag
              </ModalButton>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function FilterRow({
  active,
  count,
  onClick,
  onMenu,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  onMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onMenu}
      className={`group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors ${
        active ? "bg-sky-500/15 ring-1 ring-sky-500/40" : "hover:bg-white/[0.05]"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {onMenu && (
        <button
          type="button"
          title="Tag options"
          onClick={(e) => (e.stopPropagation(), onMenu(e))}
          className="grid size-5 place-items-center rounded text-neutral-500 opacity-0 hover:bg-white/[0.08] hover:text-neutral-200 group-hover:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
      <span className="text-[11px] text-neutral-500">{count}</span>
    </div>
  );
}
