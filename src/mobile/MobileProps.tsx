/**
 * Phone page properties (phase 5): chips under the title and the bottom sheets
 * that edit them. The sheets live in MobileShell; chips open them via `openProp`.
 */
import { useRef, useState } from "react";
import { CalendarDays, Check, CircleDot, Plus, Search, Tag, X } from "lucide-react";
import type { PageProperties as Props, PageStatus } from "../data/api";
import { COLOR_IDS, STATUSES, parseIsoDate } from "../lib/colors";
import { StatusBadge, TagChip } from "../components/PageProperties";
import { buzz } from "./mobilePrefs";
import { iso } from "./MobileCalendar";

export type PropKind = "date" | "status" | "tags" | "addprop";

let opener: (id: string, kind: PropKind) => void = () => {};
/** MobileShell registers how to open a property sheet for a page. */
export const setPropOpener = (fn: typeof opener) => void (opener = fn);
const open = (id: string, kind: PropKind) => () => (buzz(), opener(id, kind));

export const fmtDue = (d: string) => parseIsoDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Filled properties only, plus "+ Property" while any is empty. */
export function MobilePropChips({ id, value }: { id: string; value: Props }) {
  return (
    <div className="ocm-props">
      {value.dueDate && (
        <button className="ocm-prop" onClick={open(id, "date")}>
          <CalendarDays size={14} /> {fmtDue(value.dueDate)}
        </button>
      )}
      {value.status && (
        <button onClick={open(id, "status")}>
          <StatusBadge status={value.status} />
        </button>
      )}
      {value.tags.length > 0 && (
        <button className="ocm-prop-tags" onClick={open(id, "tags")}>
          {value.tags.map((t) => <TagChip key={t} tag={t} />)}
        </button>
      )}
      {(!value.dueDate || !value.status || !value.tags.length) && (
        <button className="ocm-prop ocm-prop-add" onClick={open(id, "addprop")}>
          <Plus size={14} /> Property
        </button>
      )}
    </div>
  );
}

/** Small status badge and up to two tags for list rows. */
export function RowProps({ value }: { value: Props }) {
  if (!value.status && !value.tags.length) return null;
  return (
    <span className="ocm-row-props">
      {value.status && <StatusBadge status={value.status} small />}
      {value.tags.slice(0, 2).map((t) => <TagChip key={t} tag={t} small />)}
    </span>
  );
}

const plus = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

export function PropSheet({
  kind,
  value,
  onChange,
  library,
  onCreateTag,
  onKind,
  onDone,
}: {
  kind: PropKind;
  value: Props;
  onChange: (next: Props) => void;
  library: string[];
  onCreateTag: (tag: string, color: string) => void;
  onKind: (k: PropKind) => void;
  onDone: () => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const set = (patch: Partial<Props>, close = true) => (buzz(), onChange({ ...value, ...patch }), close && onDone());

  if (kind === "addprop")
    return (
      <>
        <h2>Add property</h2>
        {!value.dueDate && <button className="ocm-item" onClick={() => onKind("date")}><CalendarDays size={20} /> Due date</button>}
        {!value.status && <button className="ocm-item" onClick={() => onKind("status")}><CircleDot size={20} /> Status</button>}
        {!value.tags.length && <button className="ocm-item" onClick={() => onKind("tags")}><Tag size={20} /> Tags</button>}
      </>
    );

  if (kind === "date") {
    const picks: [string, string][] = [["Today", plus(0)], ["Tomorrow", plus(1)], ["Next week", plus(7)]];
    return (
      <>
        <h2>Due date</h2>
        {picks.map(([label, d]) => (
          <button key={label} className={`ocm-item ${value.dueDate === d ? "on" : ""}`} onClick={() => set({ dueDate: d })}>
            <CalendarDays size={20} /> {label} <em>{fmtDue(d)}</em>
          </button>
        ))}
        <button className="ocm-item" onClick={() => dateRef.current?.showPicker()}>
          <CalendarDays size={20} /> Pick a date… {value.dueDate && <em>{fmtDue(value.dueDate)}</em>}
        </button>
        <input ref={dateRef} type="date" className="ocm-hidden-input" tabIndex={-1} value={value.dueDate ?? ""} onChange={(e) => e.target.value && set({ dueDate: e.target.value })} />
        <button className="ocm-item ocm-danger" disabled={!value.dueDate} onClick={() => set({ dueDate: null })}>
          <X size={20} /> Clear
        </button>
      </>
    );
  }

  if (kind === "status")
    return (
      <>
        <h2>Status</h2>
        {(Object.keys(STATUSES) as PageStatus[]).map((s) => (
          <button key={s} className={`ocm-item ${value.status === s ? "on" : ""}`} onClick={() => set({ status: s })}>
            <span className="ocm-dot" style={{ background: STATUSES[s].color.text }} /> {STATUSES[s].label}
            {value.status === s && <Check size={18} className="ocm-check" />}
          </button>
        ))}
        <button className="ocm-item ocm-danger" disabled={!value.status} onClick={() => set({ status: null })}>
          <X size={20} /> Clear
        </button>
      </>
    );

  // Tags: toggle many, search, create inline. Stays open.
  const term = q.trim();
  const all = [...new Set([...library, ...value.tags])];
  const shown = all.filter((t) => t.toLowerCase().includes(term.toLowerCase()));
  const toggle = (t: string) => set({ tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] }, false);
  const create = () => {
    onCreateTag(term, COLOR_IDS[Math.floor(Math.random() * COLOR_IDS.length)]);
    set({ tags: [...value.tags, term] }, false);
    setQ("");
  };
  return (
    <>
      <h2>Tags</h2>
      <label className="ocm-tag-search">
        <Search size={16} />
        <input value={q} placeholder="Search or create" enterKeyHint="done" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && term && !all.includes(term) && create()} />
      </label>
      <div className="ocm-tag-grid">
        {shown.map((t) => (
          <button key={t} className={`ocm-tag-pick ${value.tags.includes(t) ? "on" : ""}`} onClick={() => toggle(t)}>
            <TagChip tag={t} />
            {value.tags.includes(t) && <Check size={14} />}
          </button>
        ))}
      </div>
      {term && !all.includes(term) && (
        <button className="ocm-item" onClick={create}>
          <Plus size={20} /> Create “{term}”
        </button>
      )}
      {!shown.length && !term && <p className="ocm-empty">No tags yet. Type to create one.</p>}
    </>
  );
}
