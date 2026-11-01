import { useRef, useState, type ReactNode } from "react";
import { CalendarDays, CircleDot, Tag, X } from "lucide-react";
import type { PageProperties as Props, PageStatus } from "../data/api";
import { parseIsoDate, STATUSES, tagColor } from "../lib/colors";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { TagPicker } from "./TagPicker";

const fmt = (iso: string) =>
  parseIsoDate(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/** Notion-style property rows under the title: Date, Status, Tags. */
export function PageProperties({
  value,
  onChange,
  library,
  onCreateTag,
}: {
  value: Props;
  onChange: (next: Props) => void;
  /** Tags created in the Tags & status panel (the only ones offered here). */
  library: string[];
  onCreateTag: (tag: string, color: string) => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const set = (patch: Partial<Props>) => onChange({ ...value, ...patch });

  const statusMenu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      ...(Object.entries(STATUSES) as [PageStatus, (typeof STATUSES)[PageStatus]][]).map(
        ([id, s]): MenuItem => ({
          label: s.label,
          icon: <span className="block size-2 rounded-full" style={{ backgroundColor: s.color.text }} />,
          checked: value.status === id,
          onSelect: () => set({ status: id }),
        }),
      ),
      "divider",
      { label: "Clear", disabled: !value.status, onSelect: () => set({ status: null }) },
    ]);

  const addTag = (t: string) => !value.tags.includes(t) && set({ tags: [...value.tags, t] });

  return (
    <div className="mb-3 flex flex-col">
      <Row icon={<CalendarDays className="size-4" />} label="Date">
        <button
          type="button"
          onClick={() => dateRef.current?.showPicker()}
          className={value.dueDate ? "text-neutral-200" : "text-neutral-600"}
        >
          {value.dueDate ? fmt(value.dueDate) : "Empty"}
        </button>
        {value.dueDate && <ClearButton onClick={() => set({ dueDate: null })} />}
        <input
          ref={dateRef}
          type="date"
          value={value.dueDate ?? ""}
          onChange={(e) => set({ dueDate: e.target.value || null })}
          className="pointer-events-none absolute size-0 opacity-0"
          tabIndex={-1}
        />
      </Row>

      <Row icon={<CircleDot className="size-4" />} label="Status">
        <button type="button" onClick={statusMenu}>
          {value.status ? <StatusBadge status={value.status} /> : <span className="text-neutral-600">Empty</span>}
        </button>
      </Row>

      <Row icon={<Tag className="size-4" />} label="Tags">
        <div className="flex flex-wrap items-center gap-1">
          {value.tags.map((t) => (
            <TagChip key={t} tag={t} onRemove={() => set({ tags: value.tags.filter((x) => x !== t) })} />
          ))}
          <span className="relative">
            <button type="button" onClick={() => setTagDraft(tagDraft === null ? "" : null)} className="text-neutral-600 hover:text-neutral-400">
              {value.tags.length ? "+" : "Empty"}
            </button>
            {tagDraft !== null && (
              <>
                <span className="fixed inset-0 z-30" onMouseDown={() => setTagDraft(null)} />
                <TagPicker
                  library={library}
                  exclude={value.tags}
                  onPick={addTag}
                  onCreate={(t, c) => (onCreateTag(t, c), addTag(t))}
                  onClose={() => setTagDraft(null)}
                />
              </>
            )}
          </span>
        </div>
      </Row>
    </div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="group relative flex min-h-[34px] items-center text-[14px]">
      <div className="flex w-40 shrink-0 items-center gap-1.5 text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="flex min-h-[30px] flex-1 cursor-pointer items-center gap-1 rounded-md px-2 transition-colors duration-100 hover:bg-white/[0.04]">
        {children}
      </div>
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Clear"
      onClick={onClick}
      className="ml-1 grid size-5 place-items-center rounded text-neutral-500 opacity-0 hover:bg-white/[0.08] hover:text-neutral-200 group-hover:opacity-100"
    >
      <X className="size-3.5" />
    </button>
  );
}

export function StatusBadge({ status, small }: { status: PageStatus; small?: boolean }) {
  const s = STATUSES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${small ? "h-[18px] px-1.5 text-[11px]" : "h-6 px-2 text-[12px]"}`}
      style={{ backgroundColor: s.color.bg, color: s.color.text }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color.text }} />
      {s.label}
    </span>
  );
}

export function TagChip({ tag, onRemove, small }: { tag: string; onRemove?: () => void; small?: boolean }) {
  const c = tagColor(tag);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-0.5 truncate rounded ${small ? "h-[18px] px-1 text-[11px]" : "h-6 px-1.5 text-[13px]"}`}
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button type="button" onClick={(e) => (e.stopPropagation(), onRemove())} className="opacity-60 hover:opacity-100">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
