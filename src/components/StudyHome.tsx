import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Atom, BookOpen, Calculator, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Compass, Dna, ExternalLink, FileText, Flame, FlaskConical, Globe,
  GraduationCap, GripVertical, Landmark, LayoutGrid, Link2, Maximize2, ListTodo, Monitor, Music, Palette, Pause, Pencil, Play, Plus, RotateCcw, Sparkles, Square, Timer, Trash2, TrendingUp, Upload, X, Zap,
} from "lucide-react";
import { weekOrder } from "../lib/prefs";
import logoRaw from "../assets/logo-raw.png";
import type { PageMeta } from "../data/workspace";
import { colorOf, isoDate, parseIsoDate, tagColor, COLORS, COLOR_IDS, type ColorId } from "../lib/colors";
import { EmojiPicker } from "./EmojiPicker";
import { openContextMenu } from "./ContextMenu";
import {
  ASSIGNMENT, DEFAULT_LAYOUT, EXAM, type GridCard, pauseTimer, resumeTimer, clock, durationLabel, setStudy, startPreset, stopTimer, streak, uid, useStudy, type ClassSlot, type QuickLink, type TimerPreset,
} from "../lib/study";
import { Modal, ModalButton } from "./Modal";
import { ActionPill, Empty, RecentCard, SectionTitle, StatusPill } from "./HomeView";
import { ScrollRow } from "./ScrollRow";

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Student dashboard (Settings → Appearance → Home style). */
export function StudyHome(props: {
  userName: string;
  pages: PageMeta[];
  recent: string[];
  tagLibrary: string[];
  onOpenPage: (id: string) => void;
  onNewPage: () => void;
  onNewMindmap: () => void;
  onImport: () => void;
  onOpenApp: (app: "docs" | "sketch" | "calendar") => void;
  /** Creates a page with these tags (and date); returns its id. */
  onCreate: (title: string, tags: string[], dueDate: string | null, body?: Block[]) => Promise<string | undefined>;
  onSetStatus: (id: string, done: boolean) => void;
  getDoc: (id: string) => Promise<Block[]>;
  setDoc: (id: string, blocks: Block[]) => void;
}) {
  const { pages, onOpenPage } = props;
  const today = isoDate(new Date());
  const byId = new Map(pages.map((p) => [p.id, p]));
  const visited = props.recent.map((id) => byId.get(id)).filter((p): p is PageMeta => !!p).slice(0, 12);
  const pending = pages.filter((p) => p.dueDate && p.status !== "done");
  const overdue = pending.filter((p) => p.dueDate! < today);
  const dueToday = pending.filter((p) => p.dueDate === today);
  const h = new Date().getHours();
  const hello = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="oc-page-in scrollbar-thin h-full overflow-y-auto">
      <div className="oc-stagger mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 pb-24 pt-10">
        {/* ---- Compact hero ---- */}
        <div className="flex flex-wrap items-center gap-4">
          <img src={logoRaw} alt="Oceanic" className="oc-logo-float size-12 rounded-xl object-contain" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold tracking-tight text-neutral-100">
              {hello}
              {props.userName ? `, ${props.userName}` : ""}
            </h1>
            <p className="text-[13px] text-neutral-400">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          </div>
          <StatusPill pages={pending} today={today} overdue={overdue.length} dueToday={dueToday.length} onOpen={onOpenPage} />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionPill tone="#5aa2e9" icon={<Plus className="size-3.5" />} label="New page" onClick={props.onNewPage} />
          <ActionPill tone="#a78bfa" icon={<Sparkles className="size-3.5" />} label="New mindmap" onClick={props.onNewMindmap} />
          <ActionPill tone="#0fb5ba" icon={<FileText className="size-3.5" />} label="Docs" onClick={() => props.onOpenApp("docs")} />
          <ActionPill tone="#ff7a59" icon={<Pencil className="size-3.5" />} label="Sketch" onClick={() => props.onOpenApp("sketch")} />
          <ActionPill tone="#fbbf24" icon={<CalendarDays className="size-3.5" />} label="Calendar" onClick={() => props.onOpenApp("calendar")} />
          <ActionPill tone="#94a3b8" icon={<Upload className="size-3.5" />} label="Import" onClick={props.onImport} />
        </div>

        <DashboardGrid
          cards={{
            quick: <LeftColumn {...props} part="quick" />,
            nav: <LeftColumn {...props} part="nav" />,
            links: <LeftColumn {...props} part="links" />,
            classes: <ClassesGallery {...props} />,
            planner: <PlannerTabs pages={pages} today={today} onOpen={onOpenPage} onSetStatus={props.onSetStatus} />,
            today: <TodayWidget pages={pages} today={today} onOpen={onOpenPage} />,
            focus: <FocusWidget />,
            exams: <ExamsWidget pages={pages} today={today} onOpen={onOpenPage} onCreate={props.onCreate} />,
            todo: <TodoWidget pages={pages} getDoc={props.getDoc} setDoc={props.setDoc} onOpen={onOpenPage} />,
            timetable: <TimetableWidget />,
            stats: <StatsWidget />,
            recent: (
              <section className="min-w-0">
                <SectionTitle icon={<Clock className="size-3.5" />}>Recently visited</SectionTitle>
                {visited.length ? (
                  <ScrollRow deps={visited.length}>
                    {visited.map((p, i) => <RecentCard key={p.id} page={p} delay={i * 40} onOpen={() => onOpenPage(p.id)} />)}
                  </ScrollRow>
                ) : (
                  <Empty>Pages you open will show up here.</Empty>
                )}
              </section>
            ),
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ shared */
function Card({ title, icon, tone, action, children }: { title: string; icon: ReactNode; tone: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="oc-card oc-widget relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4" style={{ "--tone": tone } as React.CSSProperties}>
      {/* Faint corner doodle of the card's icon */}
      <span className="oc-doodle pointer-events-none absolute -right-3 -top-3 [&_svg]:size-24 [&_svg]:stroke-[1.2]">{icon}</span>
      <div className="relative mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}>{icon}</span>
        <h2 className="flex-1 text-[14px] font-semibold text-neutral-100">{title}</h2>
        {action}
      </div>
      <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
const Small = ({ children }: { children: ReactNode }) => <p className="py-2 text-[13px] text-neutral-500">{children}</p>;
function IconBtn({ tip, onClick, children }: { tip: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={tip} onClick={onClick} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-100 [&_svg]:size-4">
      {children}
    </button>
  );
}
const due = (d: string, today: string) => {
  const days = Math.round((parseIsoDate(d).getTime() - parseIsoDate(today).getTime()) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? `${-days}d late` : days < 7 ? parseIsoDate(d).toLocaleDateString(undefined, { weekday: "short" }) : parseIsoDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
function Check2({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => (e.stopPropagation(), onToggle())}
      className={`grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] border transition-all ${done ? "oc-tick border-emerald-500 bg-emerald-500 text-white" : "border-neutral-500 hover:border-neutral-300"}`}
    >
      {done && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

/* ------------------------------------------------------------ Today */
function TodayWidget({ pages, today, onOpen }: { pages: PageMeta[]; today: string; onOpen: (id: string) => void }) {
  const { timetable } = useStudy();
  const classes = timetable.filter((c) => c.day === new Date().getDay()).sort((a, b) => a.start.localeCompare(b.start));
  const dueNow = pages.filter((p) => p.dueDate === today && p.status !== "done" && (p.tags?.includes(ASSIGNMENT) || p.tags?.includes(EXAM)));
  const now = new Date().toTimeString().slice(0, 5);
  return (
    <Card title="Today" icon={<CalendarDays className="size-4" />} tone="#5aa2e9">
      {!classes.length && !dueNow.length && <Small>No classes or deadlines today. Add classes in the timetable below.</Small>}
      {classes.map((c) => {
        const live = c.start <= now && now < c.end;
        return (
          <div key={c.id} className={`mb-1.5 flex items-center gap-3 rounded-lg px-2.5 py-2 ${live ? "bg-white/[0.06]" : ""}`}>
            <span className="h-8 w-1 rounded-full" style={{ background: COLORS[c.color as ColorId]?.solid ?? c.color }} />
            <span className="w-24 shrink-0 text-[12px] tabular-nums text-neutral-400">{c.start}–{c.end}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-neutral-100">{c.subject}</span>
            {c.room && <span className="text-[12px] text-neutral-500">{c.room}</span>}
            {live && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400">Now</span>}
          </div>
        );
      })}
      {dueNow.map((p) => (
        <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.05]">
          <span>{p.tags?.includes(EXAM) ? "🧪" : "📝"}</span>
          <span className="flex-1 truncate text-neutral-200">{p.title || "Untitled"}</span>
          <span className="text-[11px] text-amber-400">Due today</span>
        </button>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------ Focus timer */
function FocusWidget() {
  const { timer, timers, sessions } = useStudy();
  const [editing, setEditing] = useState<TimerPreset | null>(null);
  const pct = timer ? 1 - timer.remaining / timer.total : 0;
  const mm = timer ? clock(timer.remaining) : "";
  const R = 46;
  return (
    <Card
      title="Focus timer"
      icon={<Timer className="size-4" />}
      tone="#f472b6"
      action={<IconBtn tip="New timer" onClick={() => setEditing({ id: uid(), name: "", minutes: 30 })}><Plus /></IconBtn>}
    >
      <div className="flex items-center gap-5">
        <div className="relative grid size-[110px] shrink-0 place-items-center">
          <svg viewBox="0 0 110 110" className="absolute inset-0 -rotate-90">
            <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
              cx="55" cy="55" r={R} fill="none" stroke={timer?.phase === "break" ? "#4ade80" : "#f472b6"} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * (1 - pct)} className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <div className="text-center">
            <p className="text-[22px] font-bold tabular-nums text-neutral-100">{timer ? mm : "—"}</p>
            <p className="max-w-[86px] truncate text-[11px] text-neutral-400">{timer ? timer.name : "Pick a timer"}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {timer ? (
            <div className="mb-3 flex gap-2">
              <button type="button" onClick={timer.endsAt ? pauseTimer : resumeTimer} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-pink-500/20 px-3 text-[13px] text-pink-300 hover:bg-pink-500/30">
                {timer.endsAt ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {timer.endsAt ? "Pause" : "Resume"}
              </button>
              <IconBtn tip="Restart" onClick={() => startPreset(timer.preset, timer.phase)}><RotateCcw /></IconBtn>
              <IconBtn tip="Stop" onClick={stopTimer}><Square /></IconBtn>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {timers.map((p) => (
              <span key={p.id} className="group flex items-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                <button type="button" onClick={() => startPreset(p)} className="cursor-pointer py-1 pl-3 pr-2 text-[12px] text-neutral-200 hover:text-white">
                  {p.name} · {durationLabel(p.minutes)}
                </button>
                <button type="button" title="Edit" onClick={() => setEditing(p)} className="hidden cursor-pointer pr-2 text-neutral-500 hover:text-neutral-200 group-hover:block">
                  <Pencil className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">{sessions} session{sessions === 1 ? "" : "s"} finished this run</p>
        </div>
      </div>
      {editing && <TimerDialog preset={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
/** Hours : minutes : seconds boxes over a value in seconds (max 23:59:59). */
function HmsInput({ value, onChange }: { value: number; onChange: (secs: number) => void }) {
  const parts = [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60];
  const max = [23, 59, 59];
  const set = (i: number, n: number) => {
    const next = [...parts];
    next[i] = Math.min(max[i], Math.max(0, Math.floor(n) || 0));
    onChange(next[0] * 3600 + next[1] * 60 + next[2]);
  };
  return (
    <div className="mt-1 flex items-center gap-1.5">
      {["h", "m", "s"].map((unit, i) => (
        <label key={unit} className="flex h-8 flex-1 items-center rounded-md border border-white/[0.1] bg-white/[0.04] pr-2 focus-within:border-pink-400/50">
          <input
            type="number" min={0} max={max[i]} value={parts[i]}
            onChange={(e) => set(i, Number(e.target.value))}
            onFocus={(e) => e.target.select()}
            className="w-full min-w-0 bg-transparent px-2 text-[13px] tabular-nums text-neutral-100 outline-none"
          />
          <span className="text-[12px] text-neutral-500">{unit}</span>
        </label>
      ))}
    </div>
  );
}

function TimerDialog({ preset, onClose }: { preset: TimerPreset; onClose: () => void }) {
  const { timers } = useStudy();
  const [name, setName] = useState(preset.name);
  const [focus, setFocus] = useState(() => Math.round(preset.minutes * 60));
  const [brk, setBrk] = useState(() => Math.round((preset.breakMinutes ?? 0) * 60));
  const exists = timers.some((t) => t.id === preset.id);
  const field = "mt-1 h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none";
  const save = (start: boolean) => {
    const p: TimerPreset = { id: preset.id, name: name.trim() || "Focus", minutes: Math.max(1, focus) / 60, breakMinutes: brk > 0 ? brk / 60 : undefined };
    setStudy("timers", exists ? timers.map((t) => (t.id === p.id ? p : t)) : [...timers, p]);
    if (start) startPreset(p);
    onClose();
  };
  return (
    <Modal onClose={onClose} className="w-[400px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">{exists ? "Edit timer" : "New timer"}</h2>
      <label className="text-[12px] text-neutral-400">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maths revision" className={field} /></label>
      <p className="mt-3 text-[12px] text-neutral-400">Focus</p>
      <HmsInput value={focus} onChange={setFocus} />
      <p className="mt-3 text-[12px] text-neutral-400">Break after <span className="text-neutral-500">(0 = none)</span></p>
      <HmsInput value={brk} onChange={setBrk} />
      <div className="mt-5 flex items-center gap-2">
        {exists && (
          <button type="button" onClick={() => (setStudy("timers", timers.filter((t) => t.id !== preset.id)), onClose())} className="mr-auto flex cursor-pointer items-center gap-1 text-[13px] text-red-400 hover:text-red-300">
            <Trash2 className="size-3.5" /> Delete
          </button>
        )}
        <span className="flex-1" />
        <ModalButton onClick={() => save(false)}>Save</ModalButton>
        <ModalButton variant="primary" onClick={() => save(true)}>Save & start</ModalButton>
      </div>
    </Modal>
  );
}

/** Popup for New assignment / New exam: title, class, date, priority, notes. */
function NewItemDialog({ kind, onCreate, onOpen, onClose }: { kind: "assignment" | "exam"; onCreate: HomeProps["onCreate"]; onOpen: (id: string) => void; onClose: () => void }) {
  const { subjects } = useStudy();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");
  const [priority, setPriority] = useState<"" | "Low" | "Medium" | "High">("");
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const f = "mt-1 h-9 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 text-[13.5px] text-neutral-100 outline-none focus:border-sky-500/60 [color-scheme:dark]";
  const create = async () => {
    if (!title.trim()) return;
    const body: Block[] = [];
    if (priority) body.push({ type: "paragraph", content: [{ type: "text", text: `Priority: ${priority}`, styles: { bold: true } }] as never });
    if (notes.trim()) notes.trim().split(/\r?\n/).forEach((line) => body.push({ type: "paragraph", content: line as never }));
    const id = await onCreate(title.trim(), [kind === "exam" ? EXAM : ASSIGNMENT, ...(subject ? [subject] : [])], date || null, body);
    onClose();
    if (id && open) onOpen(id);
  };
  return (
    <Modal onClose={onClose} className="w-[440px] p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-neutral-100">{kind === "exam" ? "🧪 New exam" : "📝 New assignment"}</h2>
      <label className="text-[12px] text-neutral-400">Title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} placeholder={kind === "exam" ? "e.g. Physics mid-term" : "e.g. Chemistry lab report"} className={f} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[12px] text-neutral-400">Class
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className={f}>
            <option value="">None</option>
            {subjects.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-neutral-400">{kind === "exam" ? "Exam date" : "Due date"}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={f} />
        </label>
      </div>
      <p className="mb-1 mt-3 text-[12px] text-neutral-400">Priority</p>
      <div className="flex gap-1.5">
        {(["", "Low", "Medium", "High"] as const).map((p) => (
          <button key={p || "none"} type="button" onClick={() => setPriority(p)} className={`h-7 cursor-pointer rounded-full border px-3 text-[12px] transition-colors ${priority === p ? (p === "High" ? "border-red-500/60 bg-red-500/15 text-red-300" : p === "Medium" ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : p === "Low" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/30 bg-white/10 text-neutral-100") : "border-white/[0.1] text-neutral-400 hover:text-neutral-200"}`}>
            {p || "None"}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-[12px] text-neutral-400">Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional details" className={`${f} h-auto resize-none py-2`} />
      </label>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-neutral-300">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="accent-sky-500" /> Open the page after creating
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!title.trim()} onClick={() => void create()}>Create</ModalButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ Exams */
function ExamsWidget({ pages, today, onOpen, onCreate }: { pages: PageMeta[]; today: string; onOpen: (id: string) => void; onCreate: HomeProps["onCreate"] }) {
  const [adding, setAdding] = useState(false);
  const exams = pages.filter((p) => p.tags?.includes(EXAM) && p.dueDate && p.dueDate >= today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return (
    <Card title="Exam countdown" icon={<GraduationCap className="size-4" />} tone="#f87171" action={<IconBtn tip="New exam" onClick={() => setAdding(true)}><Plus /></IconBtn>}>
      {adding && <NewItemDialog kind="exam" onCreate={onCreate} onOpen={onOpen} onClose={() => setAdding(false)} />}
      {!exams.length && !adding && <Small>No upcoming exams. Tag a page "Exam" and give it a date.</Small>}
      <div className="grid grid-cols-2 gap-2">
        {exams.slice(0, 4).map((p) => {
          const days = Math.round((parseIsoDate(p.dueDate!).getTime() - parseIsoDate(today).getTime()) / 864e5);
          return (
            <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="oc-row-in cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-left transition-transform hover:-translate-y-0.5">
              <p className={`text-[26px] font-bold tabular-nums leading-none ${days <= 3 ? "text-red-400" : days <= 10 ? "text-amber-300" : "text-neutral-100"}`}>{days === 0 ? "Today" : days}</p>
              <p className="mt-1 text-[11px] text-neutral-500">{days === 0 ? "good luck!" : `day${days === 1 ? "" : "s"} left`}</p>
              <p className="mt-2 truncate text-[13px] font-medium text-neutral-200">{p.title || "Untitled"}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ To-do */
function TodoWidget({ pages, getDoc, setDoc, onOpen }: { pages: PageMeta[]; getDoc: (id: string) => Promise<Block[]>; setDoc: (id: string, b: Block[]) => void; onOpen: (id: string) => void }) {
  const { todos, todoSource } = useStudy();
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const page = todoSource.pageId ? pages.find((p) => p.id === todoSource.pageId) : undefined;
  useEffect(() => {
    if (todoSource.mode === "page" && todoSource.pageId) getDoc(todoSource.pageId).then(setBlocks).catch(() => setBlocks([]));
  }, [todoSource.mode, todoSource.pageId]);
  // A note's checklist items (nested ones too), kept in sync with the page.
  const items: { block: Block; text: string }[] = [];
  const walk = (bs: Block[]) =>
    bs.forEach((b) => {
      if (b.type === "checkListItem") items.push({ block: b, text: Array.isArray(b.content) ? (b.content as { text?: string }[]).map((c) => c.text ?? "").join("") : "" });
      if (b.children?.length) walk(b.children);
    });
  if (blocks) walk(blocks);
  const toggleBlock = (b: Block) => {
    if (!blocks || !todoSource.pageId) return;
    b.props = { ...b.props, checked: !b.props?.checked };
    const next = [...blocks];
    setBlocks(next);
    setDoc(todoSource.pageId, next);
  };
  const addToPage = (t: string) => {
    if (!blocks || !todoSource.pageId) return;
    const next = [...blocks, { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: t, styles: {} }], children: [] }];
    setBlocks(next);
    setDoc(todoSource.pageId, next);
  };
  return (
    <Card
      title="To-do"
      icon={<ListTodo className="size-4" />}
      tone="#fbbf24"
      action={
        <div className="flex rounded-md bg-white/[0.05] p-0.5 text-[11px]">
          {(["list", "page"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setStudy("todoSource", { ...todoSource, mode: m })} className={`cursor-pointer rounded px-2 py-0.5 ${todoSource.mode === m ? "bg-white/[0.1] text-neutral-100" : "text-neutral-400"}`}>
              {m === "list" ? "Type here" : "Use a note"}
            </button>
          ))}
        </div>
      }
    >
      {todoSource.mode === "page" && (
        <div className="mb-2 flex items-center gap-2">
          <select value={todoSource.pageId ?? ""} onChange={(e) => setStudy("todoSource", { mode: "page", pageId: e.target.value || null })} className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-white/[0.1] bg-[var(--oc-surface)] px-1.5 text-[12px] text-neutral-200 outline-none">
            <option value="">Choose a note…</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.title || "Untitled"}</option>)}
          </select>
          {page && <button type="button" onClick={() => onOpen(page.id)} className="cursor-pointer text-[12px] text-sky-400 hover:underline">Open</button>}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          if (todoSource.mode === "list") setStudy("todos", [...todos, { id: uid(), text: t, done: false }]);
          else addToPage(t);
          setText("");
        }}
        className="mb-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={todoSource.mode === "page" && !page} placeholder="Add a task and press Enter" className="h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none disabled:opacity-40" />
      </form>
      <div className="scrollbar-thin max-h-56 overflow-y-auto">
        {todoSource.mode === "list"
          ? todos.map((t) => (
              <div key={t.id} className="oc-row-in group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                <Check2 done={t.done} onToggle={() => setStudy("todos", todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />
                <span className={`min-w-0 flex-1 truncate text-[13.5px] ${t.done ? "text-neutral-500 line-through" : "text-neutral-100"}`}>{t.text}</span>
                <button type="button" onClick={() => setStudy("todos", todos.filter((x) => x.id !== t.id))} className="hidden cursor-pointer text-neutral-500 hover:text-neutral-200 group-hover:block"><X className="size-3.5" /></button>
              </div>
            ))
          : items.map(({ block, text: t }, i) => (
              <div key={block.id ?? i} className="oc-row-in flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                <Check2 done={!!block.props?.checked} onToggle={() => toggleBlock(block)} />
                <span className={`min-w-0 flex-1 truncate text-[13.5px] ${block.props?.checked ? "text-neutral-500 line-through" : "text-neutral-100"}`}>{t || "Untitled task"}</span>
              </div>
            ))}
        {todoSource.mode === "list" && todos.some((t) => t.done) && (
          <button type="button" onClick={() => setStudy("todos", todos.filter((t) => !t.done))} className="mt-1 cursor-pointer text-[12px] text-neutral-500 hover:text-neutral-300">Clear finished</button>
        )}
        {todoSource.mode === "page" && page && !items.length && <Small>This note has no checklist items yet.</Small>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ Timetable */
function TimetableWidget() {
  const { timetable } = useStudy();
  const [edit, setEdit] = useState<ClassSlot | null>(null);
  const order = weekOrder();
  return (
    <Card
      title="Weekly timetable"
      icon={<CalendarDays className="size-4" />}
      tone="#a78bfa"
      action={<IconBtn tip="Add class" onClick={() => setEdit({ id: uid(), day: new Date().getDay(), subject: "", start: "09:00", end: "10:00", room: "", color: "blue" })}><Plus /></IconBtn>}
    >
      <div className="grid grid-cols-7 gap-1.5">
        {order.map((d) => (
          <div key={d} className="min-w-0">
            <p className={`mb-1 text-center text-[11px] font-semibold ${d === new Date().getDay() ? "text-violet-300" : "text-neutral-500"}`}>{DAYS[d]}</p>
            <div className="flex flex-col gap-1">
              {timetable.filter((c) => c.day === d).sort((a, b) => a.start.localeCompare(b.start)).map((c) => {
                const col = COLORS[c.color as ColorId] ?? COLORS.blue;
                return (
                  <button key={c.id} type="button" onClick={() => setEdit(c)} className="oc-row-in cursor-pointer rounded-md border-l-[3px] px-1.5 py-1 text-left transition-transform hover:-translate-y-0.5" style={{ background: col.bg, borderLeftColor: col.solid }}>
                    <span className="block truncate text-[12px] font-medium text-neutral-100">{c.subject || "Class"}</span>
                    <span className="block truncate text-[10.5px] text-neutral-400">{c.start}{c.room ? ` · ${c.room}` : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!timetable.length && <Small>Add your classes; they repeat every week and show in Today.</Small>}
      {edit && <ClassDialog slot={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}
function ClassDialog({ slot, onClose }: { slot: ClassSlot; onClose: () => void }) {
  const { timetable } = useStudy();
  const [s, setS] = useState(slot);
  const exists = timetable.some((c) => c.id === slot.id);
  const field = "mt-1 h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none [color-scheme:dark]";
  return (
    <Modal onClose={onClose} className="w-[420px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">{exists ? "Edit class" : "Add class"}</h2>
      <label className="text-[12px] text-neutral-400">Subject<input autoFocus value={s.subject} onChange={(e) => setS({ ...s, subject: e.target.value })} className={field} /></label>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <label className="text-[12px] text-neutral-400">Day<select value={s.day} onChange={(e) => setS({ ...s, day: Number(e.target.value) })} className={field}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
        <label className="text-[12px] text-neutral-400">Start<input type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} className={field} /></label>
        <label className="text-[12px] text-neutral-400">End<input type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} className={field} /></label>
      </div>
      <label className="mt-3 block text-[12px] text-neutral-400">Room<input value={s.room} onChange={(e) => setS({ ...s, room: e.target.value })} className={field} /></label>
      <div className="mt-3 flex gap-1.5">
        {COLOR_IDS.map((c) => (
          <button key={c} type="button" title={COLORS[c].label} onClick={() => setS({ ...s, color: c })} className={`size-6 cursor-pointer rounded-full transition-transform hover:scale-110 ${s.color === c ? "ring-2 ring-white" : ""}`} style={{ background: COLORS[c].solid }} />
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        {exists && (
          <button type="button" onClick={() => (setStudy("timetable", timetable.filter((c) => c.id !== slot.id)), onClose())} className="flex cursor-pointer items-center gap-1 text-[13px] text-red-400 hover:text-red-300">
            <Trash2 className="size-3.5" /> Delete
          </button>
        )}
        <span className="flex-1" />
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => (setStudy("timetable", exists ? timetable.map((c) => (c.id === s.id ? s : c)) : [...timetable, s]), onClose())}>Save</ModalButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ Streak + stats */
function StatsWidget() {
  const { focusLog } = useStudy();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 864e5);
    return { label: DAYS[d.getDay()][0], mins: focusLog[isoDate(d)] ?? 0 };
  });
  const max = Math.max(30, ...days.map((d) => d.mins));
  const total = days.reduce((a, d) => a + d.mins, 0);
  const s = streak(focusLog);
  return (
    <Card title="Study streak" icon={<Flame className="size-4" />} tone="#fb923c">
      <div className="flex items-end gap-5">
        <div>
          <p className="text-[34px] font-bold leading-none text-orange-300">{s}<span className={s ? "oc-flame ml-1 inline-block" : "ml-1"}>🔥</span></p>
          <p className="mt-1 text-[11px] text-neutral-500">day{s === 1 ? "" : "s"} in a row</p>
          <p className="mt-3 text-[13px] text-neutral-200">{Math.floor(total / 60)}h {total % 60}m</p>
          <p className="text-[11px] text-neutral-500">focused this week</p>
        </div>
        <div className="flex h-24 flex-1 items-end gap-1.5">
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="oc-bar w-full rounded-t-md bg-orange-400/70" style={{ height: `${Math.max(3, (d.mins / max) * 80)}px`, animationDelay: `${i * 50}ms` }} title={`${d.mins} min`} />
              <span className="text-[10px] text-neutral-500">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ Student OS pieces */
type HomeProps = Parameters<typeof StudyHome>[0];
/** Line illustrations for class cards (large thin icons). */
const ART: Record<string, { label: string; icon: ReactNode }> = {
  maths: { label: "Maths", icon: <Calculator /> },
  physics: { label: "Physics", icon: <Atom /> },
  chemistry: { label: "Chemistry", icon: <FlaskConical /> },
  biology: { label: "Biology", icon: <Dna /> },
  computing: { label: "Computing", icon: <Monitor /> },
  english: { label: "Language", icon: <BookOpen /> },
  history: { label: "History", icon: <Landmark /> },
  geography: { label: "Geography", icon: <Globe /> },
  art: { label: "Art", icon: <Palette /> },
  music: { label: "Music", icon: <Music /> },
  economics: { label: "Economics", icon: <TrendingUp /> },
  general: { label: "General", icon: <GraduationCap /> },
};
/** Guess art from the subject name. */
const guessArt = (s: string) => {
  const n = s.toLowerCase();
  const pairs: [RegExp, string][] = [[/math|calc|algebra/, "maths"], [/phys/, "physics"], [/chem/, "chemistry"], [/bio/, "biology"], [/comput|cs|program|it\b/, "computing"], [/eng|lang|lit|hindi|french|spanish/, "english"], [/hist/, "history"], [/geo/, "geography"], [/art|draw/, "art"], [/music/, "music"], [/econ|account|business|commerce/, "economics"]];
  return pairs.find(([r]) => r.test(n))?.[1] ?? "general";
};

function LeftColumn({ pages, onCreate, onOpenPage, onNewPage, part }: HomeProps & { part: "quick" | "nav" | "links" }) {
  const { links } = useStudy();
  const [adding, setAdding] = useState<null | "assignment" | "exam">(null);
  const [list, setList] = useState<null | "assignments" | "exams" | "notes">(null);
  const [linkForm, setLinkForm] = useState<QuickLink | null>(null);
  const item = "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-[13.5px] text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-neutral-100";
  const shown = list === "assignments" ? pages.filter((p) => p.tags?.includes(ASSIGNMENT)) : list === "exams" ? pages.filter((p) => p.tags?.includes(EXAM)) : pages.filter((p) => !p.tags?.includes(ASSIGNMENT) && !p.tags?.includes(EXAM));
  return (
    <>
      {part === "quick" && <Card title="Quick capture" icon={<Zap className="size-4" />} tone="#5aa2e9">
        <button type="button" onClick={() => setAdding("assignment")} className={item}><ListTodo className="size-4 text-sky-400" /> New assignment</button>
        <button type="button" onClick={onNewPage} className={item}><FileText className="size-4 text-neutral-400" /> New note</button>
        <button type="button" onClick={() => setAdding("exam")} className={item}><GraduationCap className="size-4 text-red-400" /> New exam</button>
        {adding && (
          <NewItemDialog kind={adding} onCreate={onCreate} onOpen={onOpenPage} onClose={() => setAdding(null)} />
        )}
      </Card>}
      {part === "nav" && <Card title="Navigation" icon={<Compass className="size-4" />} tone="#a78bfa">
        <button type="button" onClick={() => document.getElementById("oc-classes")?.scrollIntoView({ behavior: "smooth" })} className={item}><BookOpen className="size-4 text-emerald-400" /> Classes</button>
        <button type="button" onClick={() => setList("assignments")} className={item}><ListTodo className="size-4 text-sky-400" /> Assignments</button>
        <button type="button" onClick={() => setList("exams")} className={item}><GraduationCap className="size-4 text-red-400" /> Exams</button>
        <button type="button" onClick={() => setList("notes")} className={item}><FileText className="size-4 text-neutral-400" /> Notes</button>
      </Card>}
      {part === "links" && <Card title="Quick links" icon={<Link2 className="size-4" />} tone="#2dd4bf" action={<IconBtn tip="Add link" onClick={() => setLinkForm({ id: uid(), label: "", url: "https://", icon: "favicon", color: "blue" })}><Plus /></IconBtn>}>
        {linkForm && <LinkDialog link={linkForm} onClose={() => setLinkForm(null)} />}
        {!links.length && <Small>Add your school portal, classroom or study sites.</Small>}
        {links.map((l) => (
          <div key={l.id} className="group flex items-center" onContextMenu={(e) => openContextMenu(e, [
            { label: "Open", icon: <ExternalLink className="size-4" />, onSelect: () => openLink(l.url) },
            { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setLinkForm(l) },
            "divider",
            { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setStudy("links", links.filter((x) => x.id !== l.id)) },
          ])}>
            <a href={l.url} onClick={(e) => (e.preventDefault(), openLink(l.url))} className={`${item} min-w-0 flex-1`}>
              <LinkIcon link={l} /> <span className="truncate">{l.label}</span>
            </a>
            <button type="button" data-tip="Edit" onClick={() => setLinkForm(l)} className="hidden cursor-pointer px-1 text-neutral-500 hover:text-neutral-200 group-hover:block"><Pencil className="size-3.5" /></button>
            <button type="button" data-tip="Remove" onClick={() => setStudy("links", links.filter((x) => x.id !== l.id))} className="hidden cursor-pointer px-1 text-neutral-500 hover:text-neutral-200 group-hover:block"><X className="size-3.5" /></button>
          </div>
        ))}
      </Card>}
      {list && (
        <Modal onClose={() => setList(null)} className="w-[460px] p-5">
          <h2 className="mb-3 text-[15px] font-semibold capitalize text-neutral-100">{list}</h2>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
            {!shown.length && <Small>Nothing here yet.</Small>}
            {shown.map((p) => (
              <button key={p.id} type="button" onClick={() => (setList(null), onOpenPage(p.id))} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] text-neutral-200 hover:bg-white/[0.06]">
                <span>{p.icon}</span>
                <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
                {p.dueDate && <span className="text-[11px] text-neutral-500">{parseIsoDate(p.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                {p.status === "done" && <Check className="size-3.5 text-emerald-400" />}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
const openLink = (url: string) => void openUrl(url).catch(() => window.open(url, "_blank"));
const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const faviconOf = (url: string) => {
  try {
    return new URL(url).origin + "/favicon.ico";
  } catch {
    return null;
  }
};

/** A link's icon in its color: the site's favicon (first letter if it fails to load) or an emoji. */
function LinkIcon({ link, size = 20 }: { link: QuickLink; size?: number }) {
  const [broken, setBroken] = useState(false);
  const c = colorOf(link.color ?? "blue");
  const fav = !link.icon || link.icon === "favicon" ? faviconOf(link.url) : null;
  useEffect(() => setBroken(false), [link.url]);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md" style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.6 }}>
      {fav && !broken ? (
        <img src={fav} alt="" onError={() => setBroken(true)} style={{ width: size * 0.7, height: size * 0.7 }} />
      ) : link.icon && link.icon !== "favicon" ? (
        <span className="leading-none">{link.icon}</span>
      ) : (
        <span className="font-semibold leading-none">{(link.label || shortUrl(link.url)).charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/** Add / edit a quick link: name, URL, icon (site icon or emoji) and color. */
function LinkDialog({ link, onClose }: { link: QuickLink; onClose: () => void }) {
  const { links } = useStudy();
  const exists = links.some((l) => l.id === link.id);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [icon, setIcon] = useState(link.icon ?? "favicon");
  const [color, setColor] = useState(link.color ?? "blue");
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const full = withScheme(url.trim());
  const valid = (() => {
    try {
      const h = new URL(full).hostname;
      return h.includes(".") || h === "localhost";
    } catch {
      return false;
    }
  })();
  const field = "mt-1 h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none focus:border-teal-400/50";
  const choice = (on: boolean) =>
    `flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-[12.5px] ${on ? "border-teal-400/60 bg-teal-500/15 text-teal-200" : "border-white/[0.1] bg-white/[0.04] text-neutral-300 hover:bg-white/[0.07]"}`;
  const save = () => {
    if (!valid) return;
    const next: QuickLink = { id: link.id, label: label.trim() || shortUrl(full), url: full, icon, color };
    setStudy("links", exists ? links.map((l) => (l.id === next.id ? next : l)) : [...links, next]);
    onClose();
  };
  return (
    <Modal onClose={onClose} className="w-[400px] p-5">
      <form onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="mb-4 flex items-center gap-3">
          <LinkIcon link={{ id: link.id, label, url: full, icon, color }} size={36} />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-neutral-100">{exists ? "Edit link" : "New quick link"}</h2>
            <p className="truncate text-[12px] text-neutral-500">{valid ? full : "Enter a web address"}</p>
          </div>
        </div>
        <label className="text-[12px] text-neutral-400">Name<input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Khan Academy" className={field} /></label>
        <label className="mt-3 block text-[12px] text-neutral-400">URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={field} /></label>
        <p className="mt-3 text-[12px] text-neutral-400">Icon</p>
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={() => setIcon("favicon")} className={choice(icon === "favicon")}>Site icon</button>
          <button type="button" onClick={(e) => setPicker(e.currentTarget)} className={choice(icon !== "favicon")}>
            {icon !== "favicon" && <span className="text-[15px]">{icon}</span>} Emoji…
          </button>
        </div>
        {picker && <EmojiPicker anchor={picker} onSelect={(e) => (setIcon(e), setPicker(null))} onClose={() => setPicker(null)} />}
        <p className="mt-3 text-[12px] text-neutral-400">Color</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {COLOR_IDS.map((id) => (
            <button key={id} type="button" data-tip={COLORS[id].label} onClick={() => setColor(id)} className={`size-6 cursor-pointer rounded-full transition-transform hover:scale-110 ${color === id ? "ring-2 ring-white/70 ring-offset-2 ring-offset-neutral-900" : ""}`} style={{ background: COLORS[id].solid }} />
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2">
          {exists && (
            <button type="button" onClick={() => (setStudy("links", links.filter((l) => l.id !== link.id)), onClose())} className="flex cursor-pointer items-center gap-1 text-[13px] text-red-400 hover:text-red-300">
              <Trash2 className="size-3.5" /> Remove
            </button>
          )}
          <span className="flex-1" />
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={save}>{exists ? "Save" : "Add link"}</ModalButton>
        </div>
      </form>
    </Modal>
  );
}

/** Classes gallery: one card per subject tag, with art, teacher/room and assignment progress. */
function ClassesGallery({ pages, tagLibrary, onCreate, onOpenPage }: HomeProps) {
  const { subjects, classes } = useStudy();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const choices = tagLibrary.filter((t) => t !== ASSIGNMENT && t !== EXAM);
  return (
    <section id="oc-classes">
      <div className="mb-2 flex items-center">
        <h2 className="flex-1 text-[17px] font-semibold text-neutral-100">Classes</h2>
        <button type="button" onClick={() => setPicking((v) => !v)} className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200">
          <Pencil className="size-3.5" /> Choose classes
        </button>
      </div>
      {picking && (
        <div className="oc-docs-pop mb-3 flex flex-wrap gap-1.5 rounded-xl bg-white/[0.03] p-2.5">
          {!choices.length && <span className="text-[12px] text-neutral-500">Create subject tags in Tags &amp; status first (e.g. Physics, Maths).</span>}
          {choices.map((t) => {
            const on = subjects.includes(t);
            return (
              <button key={t} type="button" onClick={() => setStudy("subjects", on ? subjects.filter((x) => x !== t) : [...subjects, t])} className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] ${on ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/[0.1] text-neutral-400 hover:text-neutral-200"}`}>
                {on && "✓ "}{t}
              </button>
            );
          })}
        </div>
      )}
      {!subjects.length && !picking && <Small>Choose which tags are your classes to see them here.</Small>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {subjects.map((s, i) => {
          const c = tagColor(s);
          const info = classes[s] ?? { teacher: "", room: "", art: guessArt(s) };
          const tagged = pages.filter((p) => p.tags?.includes(s));
          const as = tagged.filter((p) => p.tags?.includes(ASSIGNMENT));
          const ex = tagged.filter((p) => p.tags?.includes(EXAM)).length;
          const pct = as.length ? Math.round((as.filter((p) => p.status === "done").length / as.length) * 100) : 0;
          return (
            <div key={s} className="oc-card oc-class group relative overflow-hidden rounded-2xl" style={{ "--tone": c.solid, animationDelay: `${i * 60}ms` } as React.CSSProperties}>
              <button type="button" onClick={() => setEditing(s)} className="oc-class-art relative grid h-28 w-full cursor-pointer place-items-center [&_svg]:size-14 [&_svg]:stroke-[1.1]" style={{ color: c.text }}>
                {ART[info.art]?.icon ?? ART.general.icon}
              </button>
              <div className="relative p-3">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-neutral-100">{s}</span>
                  <button type="button" title={`New ${s} page`} onClick={async () => { const id = await onCreate("", [s], null); if (id) onOpenPage(id); }} className="cursor-pointer text-neutral-400 opacity-0 transition-opacity hover:text-neutral-100 group-hover:opacity-100"><Plus className="size-4" /></button>
                </div>
                <p className="truncate text-[11.5px] text-neutral-400">{[info.teacher, info.room].filter(Boolean).join(" · ") || `${tagged.length} page${tagged.length === 1 ? "" : "s"}`}</p>
                <p className="mt-1 text-[11.5px] text-neutral-400">{as.length} Assignment{as.length === 1 ? "" : "s"}, {ex} Exam{ex === 1 ? "" : "s"}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-9 text-[11px] tabular-nums text-neutral-300">{pct}%</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div className="oc-progress h-full rounded-full" style={{ width: `${pct}%`, background: c.solid }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <ClassInfoDialog subject={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
function ClassInfoDialog({ subject, onClose }: { subject: string; onClose: () => void }) {
  const { classes } = useStudy();
  const [info, setInfo] = useState(classes[subject] ?? { teacher: "", room: "", art: guessArt(subject) });
  const f = "mt-1 h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none";
  return (
    <Modal onClose={onClose} className="w-[440px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">{subject}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[12px] text-neutral-400">Teacher<input autoFocus value={info.teacher} onChange={(e) => setInfo({ ...info, teacher: e.target.value })} className={f} /></label>
        <label className="text-[12px] text-neutral-400">Room<input value={info.room} onChange={(e) => setInfo({ ...info, room: e.target.value })} className={f} /></label>
      </div>
      <p className="mb-1.5 mt-4 text-[12px] text-neutral-400">Card art</p>
      <div className="grid grid-cols-6 gap-1.5">
        {Object.entries(ART).map(([id, a]) => (
          <button key={id} type="button" title={a.label} onClick={() => setInfo({ ...info, art: id })} className={`grid h-12 cursor-pointer place-items-center rounded-lg border transition-colors [&_svg]:size-6 [&_svg]:stroke-[1.4] ${info.art === id ? "border-[color:var(--oc-brand)] bg-[color:var(--oc-brand)]/15 text-neutral-100" : "border-white/[0.08] text-neutral-400 hover:text-neutral-100"}`}>
            {a.icon}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => (setStudy("classes", { ...classes, [subject]: info }), onClose())}>Save</ModalButton>
      </div>
    </Modal>
  );
}

/** Assignments/Exams: This week · This month (mini calendars) · Upcoming (list). */
function PlannerTabs({ pages, today, onOpen, onSetStatus }: { pages: PageMeta[]; today: string; onOpen: (id: string) => void; onSetStatus: (id: string, done: boolean) => void }) {
  const [tab, setTab] = useState<"week" | "month" | "upcoming">("week");
  const [cursor, setCursor] = useState(() => new Date());
  const items = pages.filter((p) => p.dueDate && (p.tags?.includes(ASSIGNMENT) || p.tags?.includes(EXAM)));
  const byDay = new Map<string, PageMeta[]>();
  for (const p of items) byDay.set(p.dueDate!, [...(byDay.get(p.dueDate!) ?? []), p]);
  const start = new Date(cursor);
  if (tab === "week") start.setDate(start.getDate() - start.getDay());
  else (start.setDate(1), start.setDate(1 - start.getDay()));
  const days = Array.from({ length: tab === "week" ? 7 : 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const shift = (n: number) => setCursor((c) => (tab === "week" ? new Date(c.getFullYear(), c.getMonth(), c.getDate() + 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1)));
  const chip = (p: PageMeta) => (
    <button key={p.id} type="button" onClick={() => onOpen(p.id)} title={p.title} className={`oc-row-in block w-full cursor-pointer truncate rounded px-1 text-left text-[11px] ${p.status === "done" ? "line-through opacity-50" : ""} ${p.tags?.includes(EXAM) ? "bg-red-500/15 text-red-300" : "bg-sky-500/15 text-sky-300"}`}>
      {p.tags?.includes(EXAM) ? "🧪" : "📝"} {p.title || "Untitled"}
    </button>
  );
  const upcoming = items.filter((p) => p.dueDate! >= today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return (
    <section className="oc-card relative overflow-hidden rounded-2xl p-4" style={{ "--tone": "#5aa2e9" } as React.CSSProperties}>
      <div className="mb-3 flex items-center gap-1">
        <h2 className="mr-3 text-[17px] font-semibold text-neutral-100">Assignments &amp; Exams</h2>
        {(["week", "month", "upcoming"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`relative h-7 cursor-pointer rounded-md px-2.5 text-[12.5px] ${tab === t ? "bg-white/[0.08] text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
            {t === "week" ? "This week" : t === "month" ? "This month" : "Upcoming"}
          </button>
        ))}
        <span className="flex-1" />
        {tab !== "upcoming" && (
          <>
            <span className="mr-1 text-[12.5px] text-neutral-400">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <IconBtn tip="Previous" onClick={() => shift(-1)}><ChevronLeft /></IconBtn>
            <button type="button" onClick={() => setCursor(new Date())} className="h-7 cursor-pointer rounded-md px-2 text-[12px] text-neutral-300 hover:bg-white/[0.06]">Today</button>
            <IconBtn tip="Next" onClick={() => shift(1)}><ChevronRight /></IconBtn>
          </>
        )}
      </div>
      {tab === "upcoming" ? (
        <div key="up" className="scrollbar-thin max-h-72 overflow-y-auto">
          {!upcoming.length && <Small>Nothing coming up. Use Quick capture to add one.</Small>}
          {upcoming.map((p) => (
            <div key={p.id} onClick={() => onOpen(p.id)} className="oc-row-in flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.05]">
              <Check2 done={p.status === "done"} onToggle={() => onSetStatus(p.id, p.status !== "done")} />
              <span>{p.tags?.includes(EXAM) ? "🧪" : "📝"}</span>
              <span className={`min-w-0 flex-1 truncate text-[13.5px] ${p.status === "done" ? "text-neutral-500 line-through" : "text-neutral-100"}`}>{p.title || "Untitled"}</span>
              <span className="w-20 text-right text-[11.5px] text-neutral-400">{due(p.dueDate!, today)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div key={tab + cursor.toDateString()} className="oc-fade-in grid grid-cols-7 overflow-hidden rounded-lg border border-white/[0.06]">
          {DAYS.map((d) => <div key={d} className="border-b border-white/[0.06] py-1 text-center text-[11px] text-neutral-500">{d}</div>)}
          {days.map((d) => {
            const iso = isoDate(d);
            const list = byDay.get(iso) ?? [];
            const out = tab === "month" && d.getMonth() !== cursor.getMonth();
            return (
              <div key={iso} className={`border-b border-r border-white/[0.04] p-1 ${tab === "week" ? "min-h-28" : "min-h-16"} ${out ? "opacity-35" : ""}`}>
                <span className={`mb-0.5 grid size-5 place-items-center rounded-full text-[11px] ${iso === today ? "bg-red-500 font-semibold text-white" : "text-neutral-400"}`}>{d.getDate()}</span>
                <div className="flex flex-col gap-0.5">{list.slice(0, tab === "week" ? 6 : 2).map(chip)}</div>
                {list.length > (tab === "week" ? 6 : 2) && <span className="text-[10px] text-neutral-500">+{list.length - (tab === "week" ? 6 : 2)} more</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ customisable grid */
const CARD_NAMES: Record<string, string> = {
  quick: "Quick capture", nav: "Navigation", links: "Quick links", classes: "Classes", planner: "Assignments & Exams", today: "Today",
  focus: "Focus timer", exams: "Exam countdown", todo: "To-do", timetable: "Weekly timetable", stats: "Study streak", recent: "Recently visited",
};
const ROW = 36; // px per grid row (24px + 12px gap)
const GAP = 12;
const overlaps = (a: GridCard, b: GridCard) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Keep `moved` where it is; push anything it overlaps (and so on) straight down. */
function settle(cards: GridCard[], moved: GridCard): GridCard[] {
  const out = cards.map((c) => (c.id === moved.id ? moved : { ...c }));
  const queue = [moved];
  while (queue.length) {
    const fixed = queue.shift()!;
    for (const c of out) {
      if (c.id === fixed.id || c.id === moved.id || !overlaps(c, fixed)) continue;
      c.y = fixed.y + fixed.h;
      queue.push(c);
    }
  }
  return out;
}

/** Free 12-column grid like phone widgets: in Customize, drag cards anywhere and resize from the corner. */
function DashboardGrid({ cards }: { cards: Record<string, ReactNode> }) {
  const { layout } = useStudy();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [live, setLive] = useState<GridCard[] | null>(null); // layout while dragging
  const gridRef = useRef<HTMLDivElement>(null);
  const cur = live ?? layout;
  const shown = cur.filter((c) => cards[c.id]);
  const hidden = Object.keys(cards).filter((id) => !layout.some((c) => c.id === id));
  const save = (next: GridCard[]) => setStudy("layout", next);
  const rows = Math.max(1, ...shown.map((c) => c.y + c.h));

  /** Drag to move (mode "move") or resize from the corner (mode "size"). */
  const begin = (e: React.PointerEvent, card: GridCard, mode: "move" | "size") => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current!.getBoundingClientRect();
    const col = (grid.width + GAP) / 12;
    const sx = e.clientX;
    const sy = e.clientY;
    let latest = layout;
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / col);
      const dy = Math.round((ev.clientY - sy) / ROW);
      const next: GridCard =
        mode === "move"
          ? { ...card, x: Math.max(0, Math.min(12 - card.w, card.x + dx)), y: Math.max(0, card.y + dy) }
          : { ...card, w: Math.max(3, Math.min(12 - card.x, card.w + dx)), h: Math.max(3, card.h + dy) };
      latest = settle(layout, next);
      setLive(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      save(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <div className="-mb-3 flex items-center justify-end gap-2">
        {editing && (
          <>
            <span className="mr-auto text-[12px] text-neutral-500">Drag cards anywhere · drag the corner to resize</span>
            <button type="button" onClick={() => save(DEFAULT_LAYOUT)} className="h-7 cursor-pointer rounded-md px-2.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200">Reset</button>
            <div className="relative">
              <button type="button" disabled={!hidden.length} onClick={() => setAdding((v) => !v)} className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-white/[0.1] px-2.5 text-[12.5px] text-neutral-200 hover:bg-white/[0.06] disabled:opacity-40">
                <Plus className="size-3.5" /> Add widget
              </button>
              {adding && (
                <>
                  <div className="fixed inset-0 z-40" onMouseDown={() => setAdding(false)} />
                  <div className="oc-docs-pop absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl">
                    {hidden.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          const def = DEFAULT_LAYOUT.find((c) => c.id === id) ?? { id, x: 0, y: 0, w: 6, h: 8 };
                          save([...layout, { ...def, x: 0, y: rows }]); // added at the bottom
                          setAdding(false);
                        }}
                        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-neutral-200 hover:bg-white/[0.06]"
                      >
                        <Plus className="size-3.5 text-neutral-500" /> {CARD_NAMES[id]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <button type="button" onClick={() => (setEditing((v) => !v), setAdding(false))} className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12.5px] ${editing ? "bg-sky-600 text-white hover:bg-sky-500" : "text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"}`}>
          {editing ? <Check className="size-3.5" /> : <LayoutGrid className="size-3.5" />} {editing ? "Done" : "Customize"}
        </button>
      </div>
      <div
        ref={gridRef}
        className={`oc-freegrid relative grid gap-3 ${editing ? "oc-grid-lines" : ""}`}
        style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridAutoRows: `${ROW - GAP}px`, minHeight: rows * ROW }}
      >
        {shown.map((c, i) => (
          <div
            key={c.id}
            className={`relative min-w-0 transition-[transform] ${editing ? "oc-jiggle rounded-2xl ring-1 ring-dashed ring-white/15" : ""} ${live && live !== layout ? "duration-150" : ""}`}
            style={{ gridColumn: `${c.x + 1} / span ${c.w}`, gridRow: `${c.y + 1} / span ${c.h}`, animationDelay: editing ? `${(i % 4) * -0.08}s` : undefined }}
          >
            <div className={`oc-fill h-full ${editing ? "pointer-events-none select-none" : ""}`}>{cards[c.id]}</div>
            {editing && (
              <>
                {/* Whole card is the move handle while editing */}
                <div onPointerDown={(e) => begin(e, c, "move")} className="absolute inset-0 z-10 cursor-grab rounded-2xl active:cursor-grabbing" title="Drag to move" />
                <div className="absolute -top-2.5 right-2 z-20 flex gap-1">
                  <button type="button" title="Remove" onClick={() => save(layout.filter((x) => x.id !== c.id))} className="grid size-6 cursor-pointer place-items-center rounded-full border border-white/15 bg-[var(--oc-surface)] text-neutral-300 shadow hover:bg-red-500 hover:text-white">
                    <X className="size-3" />
                  </button>
                </div>
                <span className="pointer-events-none absolute left-2 top-2 z-20 text-neutral-500"><GripVertical className="size-4" /></span>
                <div onPointerDown={(e) => begin(e, c, "size")} title="Drag to resize" className="absolute -bottom-1 -right-1 z-20 grid size-5 cursor-nwse-resize place-items-center rounded-md border border-white/20 bg-[var(--oc-surface)] text-neutral-300 shadow">
                  <Maximize2 className="size-3 rotate-90" />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
