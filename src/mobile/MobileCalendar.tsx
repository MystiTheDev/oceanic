/**
 * Phone Calendar tab: a month (or week) grid with dots on days that have due
 * pages. Swipe to change month/week; the selected day's pages list below.
 * Week start follows the shared "Start week on" setting.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import type { PageMeta } from "../data/workspace";
import { startOfWeek } from "../lib/prefs";
import { buzz, setMobilePref, useMobilePrefs } from "./mobilePrefs";

export const iso = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const FUN = ["Nothing due. Go touch some grass. 🌱", "A clear day. The ocean is calm. 🌊", "Nothing due. Nap opportunity unlocked. 😴", "Free as a seagull. 🐦", "No deadlines here. Enjoy the breeze. 🍃"];

/** Dot for a day: red if overdue, dim if all done, accent otherwise. */
export function dotClass(list: PageMeta[] | undefined, day: string) {
  if (!list?.length) return "";
  const open = list.some((x) => x.status !== "done");
  return !open ? "ocm-cal-dot done" : day < iso(new Date()) ? "ocm-cal-dot late" : "ocm-cal-dot";
}

/** Due pages by ISO day. */
export const dueByDay = (pages: PageMeta[]) => {
  const m: Record<string, PageMeta[]> = {};
  for (const x of pages) if (x.dueDate) (m[x.dueDate] ??= []).push(x);
  return m;
};

type Props = {
  pages: PageMeta[];
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  hold: (id: string) => { onContextMenu: (e: React.MouseEvent) => void };
  onCreateTask: (date: string) => void;
};

export function MobileCalendar(p: Props) {
  const { calMode: mode } = useMobilePrefs();
  const sel = new Date(p.day + "T00:00");
  const [view, setView] = useState(sel);
  const [dir, setDir] = useState(1);
  const due = dueByDay(p.pages);
  const todayIso = iso(new Date());

  const first = mode === "month" ? startOfWeek(new Date(view.getFullYear(), view.getMonth(), 1)) : startOfWeek(view);
  const rows = mode === "month" ? 6 : 1;
  const days = Array.from({ length: rows * 7 }, (_, i) => addDays(first, i));
  const key = mode + iso(first);
  const shift = (n: number) => {
    buzz();
    setDir(n);
    setView(mode === "month" ? new Date(view.getFullYear(), view.getMonth() + n, 1) : addDays(view, 7 * n));
  };
  const pick = (d: Date) => (buzz(), p.setDay(iso(d)), d.getMonth() !== view.getMonth() && mode === "month" && shift(d < view ? -1 : 1));
  const list = due[p.day] ?? [];
  const label = sel.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  return (
    <>
      <header className="ocm-title ocm-cal-head">
        <div>
          <h1>{view.toLocaleDateString([], { month: "long", year: "numeric" })}</h1>
          <span className="ocm-tabs">
            {(["month", "week"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => (buzz(), setMobilePref({ calMode: m }), setView(sel))}>
                {m === "month" ? "Month" : "Week"}
                {mode === m && <motion.span layoutId="ocm-cal-line" className="ocm-tab-line" />}
              </button>
            ))}
          </span>
        </div>
        <motion.button className="ocm-chip" whileTap={{ scale: 0.92 }} onClick={() => (buzz(), setDir(new Date() < view ? -1 : 1), setView(new Date()), p.setDay(todayIso))}>
          Today
        </motion.button>
      </header>
      <div className="ocm-cal-week">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{d.toLocaleDateString([], { weekday: "narrow" })}</span>
        ))}
      </div>
      <div className="ocm-cal-clip">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={key}
            className="ocm-cal-grid"
            custom={dir}
            variants={{ in: (d: number) => ({ x: `${d * 100}%`, opacity: 0 }), on: { x: 0, opacity: 1 }, out: (d: number) => ({ x: `${d * -100}%`, opacity: 0 }) }}
            initial="in"
            animate="on"
            exit="out"
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.3}
            onDragEnd={(_, i) => Math.abs(i.offset.x) > 50 && shift(i.offset.x < 0 ? 1 : -1)}
          >
            {days.map((d) => {
              const id = iso(d);
              const out = mode === "month" && d.getMonth() !== view.getMonth();
              return (
                <button key={id} className={`ocm-cal-day${id === p.day ? " sel" : ""}${id === todayIso ? " today" : ""}${out ? " out" : ""}`} onClick={() => pick(d)}>
                  {d.getDate()}
                  <i className={dotClass(due[id], id)} />
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="ocm-card-head ocm-cal-label">{label}</div>
      <div className="ocm-list">
        {list.map((x) => (
          <motion.button key={x.id} className="ocm-row" onClick={() => p.onOpen(x.id)} {...p.hold(x.id)} whileTap={{ scale: 0.96 }}>
            <span className="ocm-row-icon">{x.icon || "📄"}</span>
            <span className="ocm-row-main">
              <span className={`ocm-row-title${x.status === "done" ? " ocm-done" : ""}`}>{x.title || "Untitled"}</span>
            </span>
            {x.status !== "done" && p.day < todayIso && <span className="ocm-row-date ocm-overdue">Overdue</span>}
          </motion.button>
        ))}
        {!list.length && <p className="ocm-empty">{FUN[sel.getDate() % FUN.length]}</p>}
        <motion.button className="ocm-chip ocm-cal-new" whileTap={{ scale: 0.94 }} onClick={() => (buzz(), p.onCreateTask(p.day))}>
          <Plus size={15} /> New task due {sel.toLocaleDateString([], { month: "short", day: "numeric" })}
        </motion.button>
      </div>
    </>
  );
}
