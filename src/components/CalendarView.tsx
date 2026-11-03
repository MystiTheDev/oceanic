import { startOfWeek } from "../lib/prefs";
import { studyKind } from "../lib/study";
import { useMemo, useState } from "react";
import { CalendarCheck2, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { PageMeta } from "../data/workspace";
import { COLORS, isoDate, STATUSES, tagColor } from "../lib/colors";
import { flashLanded, setDragGhost } from "../lib/dragGhost";
import { openContextMenu } from "./ContextMenu";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Mode = "month" | "week";

type CalendarViewProps = {
  pages: PageMeta[];
  onOpenPage: (id: string) => void;
  onCreateOn: (date: string) => void;
  onReschedule: (id: string, date: string) => void;
};

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pillColor = (p: PageMeta) =>
  studyKind(p) === "exam" ? COLORS.red : studyKind(p) === "assignment" ? COLORS.blue : (p.tags?.length ? tagColor(p.tags[0]) : p.status ? STATUSES[p.status].color : COLORS.gray);

/**
 * Notion Calendar-style: a left rail with a mini month and unscheduled pages,
 * then a Month or Week board with colored event blocks (by first tag).
 */
export function CalendarView({ pages, onOpenPage, onCreateOn, onReschedule }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<Mode>("month");
  const [weekends, setWeekends] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "assignment" | "exam">("all");
  const today = isoDate(new Date());

  const days = useMemo(() => {
    const first = mode === "month" ? startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : startOfWeek(cursor);
    return Array.from({ length: mode === "month" ? 42 : 7 }, (_, i) => addDays(first, i)).filter(
      (d) => weekends || (d.getDay() !== 0 && d.getDay() !== 6),
    );
  }, [cursor, mode, weekends]);
  const cols = weekends ? 7 : 5;

  const byDay = useMemo(() => {
    const map = new Map<string, PageMeta[]>();
    for (const p of pages) if (p.dueDate && (only === "all" || studyKind(p) === only)) map.set(p.dueDate, [...(map.get(p.dueDate) ?? []), p]);
    return map;
  }, [pages, only]);
  const unscheduled = pages.filter((p) => !p.dueDate && (p.status === "not_started" || p.status === "in_progress"));

  const shift = (dir: number) =>
    setCursor((c) => (mode === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * 7)));
  const title =
    mode === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[days.length - 1].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const drop = (key: string) => {
    if (dragId) {
      onReschedule(dragId, key);
      flashLanded(`main [data-card-id="${dragId}"]`);
    }
    setDragId(null);
    setOverDay(null);
  };

  const pill = (p: PageMeta, tall?: boolean) => (
    <Pill
      key={p.id}
      p={p}
      tall={tall}
      dragging={dragId === p.id}
      onDragStart={(e) => (setDragGhost(e, p.icon, p.title), setDragId(p.id))}
      onDragEnd={() => (setDragId(null), setOverDay(null))}
      onOpen={() => onOpenPage(p.id)}
    />
  );

  return (
    <div className="oc-page-in flex h-full min-h-0">
      {/* ---- Left rail ---- */}
      <aside className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r min-[1100px]:flex border-white/[0.06] px-4 py-5 scrollbar-thin">
        <MiniMonth cursor={cursor} today={today} marked={byDay} onPick={(d) => setCursor(d)} />
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
            <CalendarCheck2 className="size-3.5" /> Unscheduled
          </p>
          {unscheduled.length ? (
            <div className="flex flex-col gap-1">
              {unscheduled.map((p) => pill(p))}
              <p className="mt-1 text-[11px] text-neutral-600">Drag onto a day to schedule.</p>
            </div>
          ) : (
            <p className="text-[12px] text-neutral-600">Pages with a Status but no Date show up here.</p>
          )}
        </div>
      </aside>

      {/* ---- Board ---- */}
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-5 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight text-neutral-100">{title}</h1>
          <Segmented value={only} onChange={setOnly} options={[["all", "All"], ["assignment", "📝 Assignments"], ["exam", "🧪 Exams"]]} />
          <Segmented value={mode} onChange={setMode} options={[["month", "Month"], ["week", "Week"]]} />
          <button
            type="button"
            onClick={() => setWeekends((v) => !v)}
            className={`h-7 cursor-pointer rounded-md border px-2.5 text-[12px] transition-colors ${
              weekends ? "border-white/[0.08] text-neutral-400 hover:bg-white/[0.05]" : "border-sky-500/50 bg-sky-500/10 text-sky-400"
            }`}
          >
            {weekends ? "Hide weekends" : "Weekends hidden"}
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="h-7 cursor-pointer rounded-md border border-white/[0.08] px-2.5 text-[12px] text-neutral-300 transition-colors hover:bg-white/[0.05]"
          >
            Today
          </button>
          <NavButton title="Previous" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" />
          </NavButton>
          <NavButton title="Next" onClick={() => shift(1)}>
            <ChevronRight className="size-4" />
          </NavButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.01]">
          <div className="grid border-b border-white/[0.06]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {days.slice(0, cols).map((d) => (
              <div key={d.getDay()} className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {WEEKDAYS[d.getDay()]}
                {mode === "week" && (
                  <span className={`ml-1.5 text-[13px] ${isoDate(d) === today ? "text-red-400" : "text-neutral-300"}`}>{d.getDate()}</span>
                )}
              </div>
            ))}
          </div>
          <div
            className="grid min-h-0 flex-1"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${days.length / cols}, minmax(0, 1fr))` }}
          >
            {days.map((d) => {
              const key = isoDate(d);
              const inMonth = mode === "week" || d.getMonth() === cursor.getMonth();
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const items = byDay.get(key) ?? [];
              const max = mode === "month" ? 3 : 99;
              return (
                <div
                  key={key}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOverDay(key);
                  }}
                  onDragLeave={() => setOverDay((o) => (o === key ? null : o))}
                  onDrop={() => drop(key)}
                  onDoubleClick={(e) => e.target === e.currentTarget && onCreateOn(key)}
                  onContextMenu={(e) =>
                    openContextMenu(e, [{ label: "New page on this day", icon: <Plus className="size-4" />, onSelect: () => onCreateOn(key) }])
                  }
                  className={`group flex min-h-0 flex-col gap-1 overflow-hidden border-b border-r border-white/[0.05] p-1.5 transition-colors ${
                    overDay === key ? "bg-sky-500/10 shadow-[inset_0_0_0_2px_var(--color-sky-500)]" : weekend ? "bg-white/[0.015]" : ""
                  } ${inMonth ? "" : "opacity-45"}`}
                >
                  {mode === "month" && (
                    <div className="flex h-6 shrink-0 items-center justify-between px-0.5">
                      <button
                        type="button"
                        title="New page"
                        onClick={() => onCreateOn(key)}
                        className="grid size-5 cursor-pointer place-items-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-neutral-200 group-hover:opacity-100"
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <span
                        className={`grid h-6 min-w-6 place-items-center whitespace-nowrap rounded-full px-1.5 text-[12px] font-medium ${
                          key === today ? "bg-red-500 text-[#fff]" : "text-neutral-400"
                        }`}
                      >
                        {d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.getDate()}
                      </span>
                    </div>
                  )}
                  <div className="scrollbar-thin flex min-h-0 flex-col gap-1 overflow-y-auto">
                    {items.slice(0, max).map((p) => pill(p, mode === "week"))}
                    {items.length > max && (
                      <button
                        type="button"
                        onClick={() => (setCursor(d), setMode("week"))}
                        className="cursor-pointer px-1.5 text-left text-[11px] font-medium text-neutral-500 hover:text-neutral-300"
                      >
                        +{items.length - max} more
                      </button>
                    )}
                    {mode === "week" && (
                      <button
                        type="button"
                        onClick={() => onCreateOn(key)}
                        className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] text-neutral-600 opacity-0 transition-opacity hover:bg-white/[0.05] hover:text-neutral-300 group-hover:opacity-100"
                      >
                        <Plus className="size-3.5" /> New
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({
p,
tall,
dragging,
onDragStart,
onDragEnd,
onOpen,
}: {
p: PageMeta;
tall?: boolean;
dragging: boolean;
onDragStart: (e: React.DragEvent) => void;
onDragEnd: () => void;
onOpen: () => void;
}) {
  const c = pillColor(p);
  return (
    <button
      type="button"
      draggable
      data-card-id={p.id}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={p.title || "Untitled"}
      style={{ background: c.bg, borderLeftColor: c.text }}
      className={`oc-cal-pill flex w-full min-w-0 cursor-pointer flex-col rounded-md border-l-[3px] px-1.5 text-left transition-[filter,transform] duration-100 hover:brightness-125 active:scale-[0.98] ${
        tall ? "gap-0.5 py-1.5" : "py-[3px]"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-1 text-[12px] font-medium" style={{ color: c.text }}>
        <span className="shrink-0 text-[11px]">{studyKind(p) === "exam" ? "🧪" : studyKind(p) === "assignment" ? "📝" : p.icon}</span>
        <span className="truncate text-neutral-100">{p.title || "Untitled"}</span>
      </span>
      {tall && p.status && <span className="text-[11px] text-neutral-400">{STATUSES[p.status].label}</span>}
    </button>
  );
}

/** Small month in the rail: click a day to jump there; dots mark scheduled days. */
function MiniMonth({ cursor, today, marked, onPick }: { cursor: Date; today: string; marked: Map<string, PageMeta[]>; onPick: (d: Date) => void }) {
  const [view, setView] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const first = startOfWeek(view);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-neutral-200">
          {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <span className="flex">
          <NavButton title="Previous month" onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}>
            <ChevronLeft className="size-3.5" />
          </NavButton>
          <NavButton title="Next month" onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}>
            <ChevronRight className="size-3.5" />
          </NavButton>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-neutral-600">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">
            {d[0]}
          </span>
        ))}
        {cells.map((d) => {
          const key = isoDate(d);
          const on = key === isoDate(cursor);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(d)}
              className={`relative mx-auto grid size-7 cursor-pointer place-items-center rounded-full text-[11px] transition-colors ${
                key === today ? "bg-red-500 font-semibold text-[#fff]" : on ? "bg-white/[0.12] text-neutral-100" : d.getMonth() === view.getMonth() ? "text-neutral-300 hover:bg-white/[0.06]" : "text-neutral-600 hover:bg-white/[0.04]"
              }`}
            >
              {d.getDate()}
              {marked.has(key) && key !== today && <span className="absolute bottom-0.5 size-1 rounded-full bg-sky-400" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-md bg-white/[0.05] p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`h-6 cursor-pointer rounded px-2.5 text-[12px] transition-colors ${
            value === v ? "bg-white/[0.12] text-neutral-100 shadow-sm" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NavButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
    >
      {children}
    </button>
  );
}
