import { startOfWeek } from "../lib/prefs";
import { studyKind } from "../lib/study";
import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock, Plus, Trash2 } from "lucide-react";
import type { PageMeta } from "../data/workspace";
import { COLORS, isoDate, STATUSES, tagColor } from "../lib/colors";
import { flashLanded, setDragGhost } from "../lib/dragGhost";
import { openContextMenu } from "./ContextMenu";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Mode = "month" | "week" | "workweek" | "day" | "agenda";
const MODES: [Mode, string][] = [["day", "Day"], ["workweek", "Work week"], ["week", "Week"], ["month", "Month"], ["agenda", "Agenda"]];

type CalendarViewProps = {
  pages: PageMeta[];
  onOpenPage: (id: string) => void;
  onCreateOn: (date: string) => void;
  onReschedule: (id: string, date: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
};

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isOverdue = (p: PageMeta, today: string) => !!p.dueDate && p.dueDate < today && p.status !== "done";
const pillColor = (p: PageMeta) =>
  studyKind(p) === "exam" ? COLORS.red : studyKind(p) === "assignment" ? COLORS.blue : (p.tags?.length ? tagColor(p.tags[0]) : p.status ? STATUSES[p.status].color : COLORS.gray);

/**
 * Notion Calendar-style: a left rail with a mini month and unscheduled pages,
 * then a Month or Week board with colored event blocks (by first tag).
 */
export function CalendarView({ pages, onOpenPage, onCreateOn, onReschedule, onToggleDone, onDelete }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<Mode>("month");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [railMin, setRailMin] = useState(() => localStorage.getItem("oc-cal-rail-min") === "1");
  const toggleRail = () => setRailMin((v) => (localStorage.setItem("oc-cal-rail-min", v ? "0" : "1"), !v));
  const [only, setOnly] = useState<"all" | "assignment" | "exam">("all");
  const today = isoDate(new Date());
  const weekends = mode !== "workweek";
  const span = mode === "month" ? 42 : mode === "day" ? 1 : 7;

  const days = useMemo(() => {
    const first = mode === "month" ? startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : mode === "day" ? cursor : startOfWeek(cursor);
    return Array.from({ length: span }, (_, i) => addDays(first, i)).filter(
      (d) => weekends || (d.getDay() !== 0 && d.getDay() !== 6),
    );
  }, [cursor, mode, weekends, span]);
  const cols = mode === "day" ? 1 : weekends ? 7 : 5;

  const byDay = useMemo(() => {
    const map = new Map<string, PageMeta[]>();
    for (const p of pages) if (p.dueDate && (only === "all" || studyKind(p) === only)) map.set(p.dueDate, [...(map.get(p.dueDate) ?? []), p]);
    return map;
  }, [pages, only]);
  const unscheduled = pages.filter((p) => !p.dueDate && (p.status === "not_started" || p.status === "in_progress"));

  const shift = (dir: number) =>
    setCursor((c) => (mode === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (mode === "day" ? 1 : mode === "agenda" ? 30 : 7))));
  // Outlook-style shortcuts: Ctrl+Alt+1..5 views, T today, Left/Right previous/next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.ctrlKey && e.altKey && /^Digit[1-5]$/.test(e.code)) (e.preventDefault(), setMode(MODES[+e.code[5] - 1][0]));
      else if (e.ctrlKey || e.altKey || e.metaKey) return;
      else if (e.key === "t" || e.key === "T") setCursor(new Date());
      else if (e.key === "ArrowLeft") shift(-1);
      else if (e.key === "ArrowRight") shift(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const agenda = useMemo(() => {
    const groups: [string, PageMeta[]][] = [["Overdue", pages.filter((p) => isOverdue(p, today) && (only === "all" || studyKind(p) === only)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))]];
    for (let i = 0; i < 30; i++) {
      const key = isoDate(addDays(cursor, i));
      groups.push([key, (byDay.get(key) ?? []).filter((p) => !isOverdue(p, today))]);
    }
    return groups.filter(([, items]) => items.length);
  }, [pages, byDay, cursor, today, only]);
  const nextWeek = Array.from({ length: 8 }, (_, i) => isoDate(addDays(new Date(), i))).map((k) => [k, byDay.get(k) ?? []] as const).filter(([, v]) => v.length);
  const dayLabel = (k: string) => (k === today ? "Today" : new Date(k + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
  const title =
    mode === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : mode === "day"
      ? cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : mode === "agenda"
      ? `Agenda · from ${cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
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
      overdue={isOverdue(p, today)}
      onToggleDone={() => onToggleDone(p.id)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: p.status === "done" ? "Mark not done" : "Mark done", icon: <Check className="size-4" />, onSelect: () => onToggleDone(p.id) },
          { label: "Delete", icon: <Trash2 className="size-4" />, onSelect: () => onDelete(p.id) },
        ])
      }
      dragging={dragId === p.id}
      onDragStart={(e) => (setDragGhost(e, p.icon, p.title), setDragId(p.id))}
      onDragEnd={() => (setDragId(null), setOverDay(null))}
      onOpen={() => onOpenPage(p.id)}
    />
  );

  return (
    <div className="oc-page-in flex h-full min-h-0">
      {/* ---- Left rail ---- */}
      {railMin ? (
      <aside className="order-last hidden w-11 shrink-0 flex-col items-center gap-1 border-l border-white/[0.06] py-4 min-[1100px]:flex">
        {[
          [ChevronsLeft, "Expand panel"],
          [CalendarDays, "Mini month"],
          [Clock, `Today & next 7 days (${nextWeek.reduce((n, [, v]) => n + v.length, 0)})`],
          [CalendarCheck2, `Unscheduled (${unscheduled.length})`],
        ].map(([Icon, label], i) => {
          const I = Icon as typeof Clock;
          return (
            <button key={i} type="button" title={label as string} onClick={toggleRail} className={`grid size-8 cursor-pointer place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 ${i === 0 ? "mb-2" : ""}`}>
              <I className="size-4" />
            </button>
          );
        })}
      </aside>
      ) : (
      <aside className="order-last hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-l min-[1100px]:flex border-white/[0.06] px-4 py-5 scrollbar-thin">
        <button type="button" title="Minimise panel" onClick={toggleRail} className="-mb-3 -mt-1 grid size-7 shrink-0 cursor-pointer place-items-center self-end rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-200">
          <ChevronsRight className="size-4" />
        </button>
        <MiniMonth cursor={cursor} today={today} marked={byDay} onPick={(d) => setCursor(d)} />
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Today &amp; next 7 days</p>
          {nextWeek.length ? (
            nextWeek.map(([k, items]) => (
              <div key={k} className="mb-2">
                <p className={`mb-1 text-[11px] font-medium ${k === today ? "text-red-400" : "text-neutral-400"}`}>{dayLabel(k)}</p>
                <div className="flex flex-col gap-1">{items.map((p) => pill(p))}</div>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-neutral-600">Nothing due this week.</p>
          )}
        </div>
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
      )}

      {/* ---- Board ---- */}
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-5 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight text-neutral-100">{title}</h1>
          <Segmented value={only} onChange={setOnly} options={[["all", "All"], ["assignment", "📝 Assignments"], ["exam", "🧪 Exams"]]} />
          <Segmented value={mode} onChange={setMode} options={MODES} />
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

        {mode === "agenda" ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.01] p-4">
            {agenda.length ? (
              agenda.map(([k, items]) => (
                <div key={k} className="mb-4 flex gap-4">
                  <p className={`w-32 shrink-0 pt-1.5 text-[13px] font-semibold ${k === "Overdue" || k === today ? "text-red-400" : "text-neutral-300"}`}>
                    {k === "Overdue" ? "Overdue" : dayLabel(k)}
                  </p>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">{items.map((p) => pill(p, true))}</div>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-neutral-500">Nothing due in the next 30 days.</p>
            )}
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.01]">
          <div className="grid border-b border-white/[0.06]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {days.slice(0, cols).map((d) => (
              <div key={d.getDay()} className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {WEEKDAYS[d.getDay()]}
                {mode !== "month" && (
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
                    {items.slice(0, max).map((p) => pill(p, mode !== "month"))}
                    {items.length > max && (
                      <button
                        type="button"
                        onClick={() => (setCursor(d), setMode("day"))}
                        className="cursor-pointer px-1.5 text-left text-[11px] font-medium text-neutral-500 hover:text-neutral-300"
                      >
                        +{items.length - max} more
                      </button>
                    )}
                    {mode !== "month" && (
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
        )}
      </div>
    </div>
  );
}

function Pill({
p,
tall,
overdue,
onToggleDone,
onContextMenu,
dragging,
onDragStart,
onDragEnd,
onOpen,
}: {
p: PageMeta;
tall?: boolean;
overdue: boolean;
onToggleDone: () => void;
onContextMenu: (e: React.MouseEvent) => void;
dragging: boolean;
onDragStart: (e: React.DragEvent) => void;
onDragEnd: () => void;
onOpen: () => void;
}) {
  const c = pillColor(p);
  const done = p.status === "done";
  return (
    <div
      role="button"
      draggable
      data-card-id={p.id}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onContextMenu={(e) => (e.stopPropagation(), onContextMenu(e))}
      title={p.title || "Untitled"}
      style={{ background: c.bg, borderLeftColor: overdue ? "var(--color-red-500)" : c.text }}
      className={`oc-cal-pill flex w-full min-w-0 cursor-pointer flex-col rounded-md border-l-[3px] px-1.5 text-left transition-[filter,transform] duration-100 hover:brightness-125 active:scale-[0.98] ${
        tall ? "gap-0.5 py-1.5" : "py-[3px]"
      } ${dragging ? "opacity-40" : ""} ${done ? "opacity-55" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-1 text-[12px] font-medium" style={{ color: c.text }}>
        <span
          role="checkbox"
          aria-checked={done}
          title={done ? "Mark not done" : "Mark done"}
          onClick={(e) => (e.stopPropagation(), onToggleDone())}
          className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${done ? "border-emerald-400 bg-emerald-500 text-[#fff]" : "border-neutral-500 hover:border-neutral-200"}`}
        >
          {done && <Check className="size-2.5" strokeWidth={3} />}
        </span>
        <span className="shrink-0 text-[11px]">{studyKind(p) === "exam" ? "🧪" : studyKind(p) === "assignment" ? "📝" : p.icon}</span>
        <span className={`truncate text-neutral-100 ${done ? "line-through" : ""}`}>{p.title || "Untitled"}</span>
      </span>
      {(tall || overdue) && (
        <span className={`pl-[18px] text-[11px] ${overdue ? "font-medium text-red-400" : "text-neutral-400"}`}>
          {overdue ? `Overdue · ${new Date(p.dueDate + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : p.status ? STATUSES[p.status].label : ""}
        </span>
      )}
    </div>
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
