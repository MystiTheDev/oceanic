import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlarmClock, Flag, GraduationCap, Hourglass, Pause, Play, Plus, RotateCcw, Settings2, SkipForward, Timer as TimerIcon, Trash2, Upload, X } from "lucide-react";
import { Modal } from "../components/Modal";
import * as T from "./store";
import { StudyTab } from "./StudyUI";
import { SOUNDS, clearCustom, loadCustom, play, saveCustom } from "./sound";

type Tab = "countdown" | "pomodoro" | "stopwatch" | "alarm" | "study" | "settings";
const TABS: [Tab, string, ReactNode][] = [
  ["countdown", "Timer", <Hourglass className="size-4" />],
  ["pomodoro", "Pomodoro", <TimerIcon className="size-4" />],
  ["stopwatch", "Stopwatch", <Flag className="size-4" />],
  ["alarm", "Alarms", <AlarmClock className="size-4" />],
  ["study", "Study", <GraduationCap className="size-4" />],
  ["settings", "Settings", <Settings2 className="size-4" />],
];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const field = "h-8 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none focus:border-sky-500/60";
const btn = "oc-press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium disabled:cursor-default disabled:opacity-40";
const primary = `${btn} oc-gbtn oc-gbtn--sky text-white`;
const plain = `${btn} oc-gbtn text-neutral-200`;
const icon = "oc-press oc-ic-hover grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100";

/** Timers dialog: create and manage every kind of timer, plus sound settings. */
export function TimersPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("countdown");
  const [dir, setDir] = useState(1);
  const idx = TABS.findIndex(([id]) => id === tab);
  const go = (id: Tab) => (setDir(TABS.findIndex(([x]) => x === id) >= idx ? 1 : -1), setTab(id));
  const s = T.useTimers();
  useEffect(() => void T.askNotifyPermission(), []);
  const of = (k: T.Kind) => s.timers.filter((t) => t.kind === k);
  return (
    <Modal glass onClose={onClose} label="Timers" className="oc-timers-panel flex h-[min(600px,86vh)] w-[min(620px,94vw)] flex-col">
      <div className="flex items-center gap-3 px-5 pb-2 pt-4">
        <h2 className="flex-1 text-[17px] font-bold tracking-tight text-neutral-100">Timers</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/[0.06] text-neutral-400 hover:bg-white/[0.12] hover:text-neutral-100">
          <X className="size-4" />
        </button>
      </div>
      <div role="tablist" className="relative mx-4 flex overflow-x-auto rounded-xl bg-white/[0.04] p-1 scrollbar-none">
        <span aria-hidden className="oc-tab-pill absolute inset-y-1 rounded-lg" style={{ left: `calc(4px + ${idx} * (100% - 8px) / ${TABS.length})`, width: `calc((100% - 8px) / ${TABS.length})` }} />
        {TABS.map(([id, name, ic]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => go(id)}
            className={`oc-press oc-ic-hover relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${tab === id ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-200"}`}>
            {ic}
            <span className="max-sm:hidden">{name}</span>
          </button>
        ))}
      </div>
      <div key={tab} style={{ ["--dir" as string]: dir }} className="oc-tab-in min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        {tab === "countdown" && <CountdownTab list={of("countdown")} presets={s.presets} />}
        {tab === "pomodoro" && <PomodoroTab list={of("pomodoro")} st={s.settings} />}
        {tab === "stopwatch" && <StopwatchTab list={of("stopwatch")} />}
        {tab === "alarm" && <AlarmTab list={of("alarm")} />}
        {tab === "study" && <StudyTab />}
        {tab === "settings" && <SettingsTab st={s.settings} />}
      </div>
      <Tips />
    </Modal>
  );
}

/** Swaps native title tooltips inside the panel for a small animated glass tip. */
function Tips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[title],[data-tip]");
      if (!el || !el.closest(".oc-timers-panel, .oc-timer-widget")) return setTip(null);
      if (el.title) (el.dataset.tip = el.title), el.removeAttribute("title");
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.tip!, x: r.left + r.width / 2, y: r.top });
    };
    const hide = () => setTip(null);
    addEventListener("mouseover", over);
    addEventListener("pointerdown", hide);
    return () => (removeEventListener("mouseover", over), removeEventListener("pointerdown", hide));
  }, []);
  return tip ? createPortal(<div key={tip.text + tip.x} role="tooltip" className="oc-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body) : null;
}

/* ---------------------------------------------------------------- shared */
function Card({ t, children, sub }: { t: T.Timer; children?: ReactNode; sub?: ReactNode }) {
  const v = T.valueOf(t);
  const pct = (t.kind === "countdown" || t.kind === "pomodoro") && t.total ? 1 - v / t.total : 0;
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
      {pct > 0 && <div className="absolute inset-y-0 left-0 bg-sky-500/[0.08] transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />}
      <div className="relative flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <input aria-label="Label" value={t.label} onChange={(e) => T.rename(t.id, e.target.value)} className="w-full truncate bg-transparent text-[12.5px] text-neutral-400 outline-none focus:text-neutral-100" />
          <p className={`font-mono text-[26px] font-semibold tabular-nums leading-tight ${t.running ? "text-neutral-100" : "text-neutral-500"}`}>{t.kind === "alarm" ? `${pad(t.hh)}:${pad(t.mm)}` : T.fmt(v, t.kind === "stopwatch")}</p>
          {sub && <div className="text-[11.5px] text-neutral-500">{sub}</div>}
        </div>
        {children}
        <button type="button" aria-label="Delete" title="Delete" onClick={() => T.remove(t.id)} className={icon}><Trash2 className="size-4" /></button>
      </div>
    </div>
  );
}
const pad = (n: number) => String(n).padStart(2, "0");
const PlayBtn = ({ t }: { t: T.Timer }) => (
  <button type="button" aria-label={t.running ? "Pause" : "Start"} title={t.running ? "Pause" : "Start"} onClick={() => T.toggle(t.id)} className={`${icon} bg-white/[0.06] text-neutral-100`}>
    {t.running ? <Pause className="size-4" /> : <Play className="size-4" />}
  </button>
);
const ResetBtn = ({ t }: { t: T.Timer }) => (
  <button type="button" aria-label="Reset" title="Reset" onClick={() => T.reset(t.id)} className={icon}><RotateCcw className="oc-ic-spin size-4" /></button>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-[12.5px] text-neutral-500">{children}</p>;
const List = ({ children }: { children: ReactNode }) => <div className="mt-4 flex flex-col gap-2">{children}</div>;

/* ---------------------------------------------------------------- countdown */
function CountdownTab({ list, presets }: { list: T.Timer[]; presets: T.Preset[] }) {
  const [h, setH] = useState(0), [m, setM] = useState(5), [sec, setS] = useState(0);
  const [label, setLabel] = useState("");
  const ms = (h * 3600 + m * 60 + sec) * 1000;
  const num = (v: number, set: (n: number) => void, max: number, name: string) => (
    <label className="flex flex-col items-center gap-1 text-[11px] text-neutral-500">
      <input type="number" inputMode="numeric" min={0} max={max} value={v} aria-label={name}
        onChange={(e) => set(Math.max(0, Math.min(max, Math.floor(+e.target.value || 0))))}
        onFocus={(e) => e.target.select()}
        className={`${field} h-12 w-16 text-center font-mono text-[22px] tabular-nums`} />
      {name}
    </label>
  );
  const start = () => (T.addCountdown(ms, label.trim() || "Timer"), setLabel(""));
  return (
    <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), start())}>
        {num(h, setH, 99, "hours")}
        {num(m, setM, 59, "min")}
        {num(sec, setS, 59, "sec")}
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className={`${field} mb-[19px] min-w-0 flex-1`} />
        <div className="mb-[19px] flex gap-2">
          <button type="button" disabled={!ms} onClick={() => T.addPreset(label, ms)} className={plain} title="Save as preset">Save</button>
          <button type="submit" disabled={!ms} className={primary}><Play className="size-3.5" />Start</button>
        </div>
      </form>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <span key={p.id} className="group flex items-center rounded-full bg-white/[0.05] text-[12px] text-neutral-300">
            <button type="button" onClick={() => T.addCountdown(p.ms, p.label)} className="cursor-pointer rounded-l-full py-1 pl-3 pr-1.5 hover:text-neutral-100">
              {p.label} <span className="text-neutral-500">{T.fmt(p.ms)}</span>
            </button>
            <button type="button" aria-label={`Remove preset ${p.label}`} onClick={() => T.removePreset(p.id)} className="grid size-6 cursor-pointer place-items-center rounded-r-full text-neutral-600 hover:text-neutral-200"><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <List>
        {list.length ? list.map((t) => (
          <Card key={t.id} t={t} sub={!t.running && T.valueOf(t) === 0 ? "Done" : `of ${T.fmt(t.total)}`}>
            <button type="button" onClick={() => T.addMinute(t.id)} className={plain} title="Add 1 minute">+1 min</button>
            <ResetBtn t={t} />
            <PlayBtn t={t} />
          </Card>
        )) : <Empty>No timers yet. Set a time and press Start, or pick a preset.</Empty>}
      </List>
    </>
  );
}

/* ---------------------------------------------------------------- pomodoro */
function PomodoroTab({ list, st }: { list: T.Timer[]; st: T.Settings }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[12.5px] text-neutral-400">{st.work} min focus, {st.short} min break, {st.long} min long break every {st.rounds} rounds.</p>
        <button type="button" onClick={T.addPomodoro} className={primary}><Plus className="size-3.5" />New Pomodoro</button>
      </div>
      <PomoSettings st={st} />
      <List>
        {list.length ? list.map((t) => (
          <Card key={t.id} t={t} sub={<span className={t.phase === "work" ? "text-sky-400" : "text-emerald-400"}>{T.phaseName[t.phase]} · round {t.round}</span>}>
            <button type="button" aria-label="Skip phase" title="Skip to next phase" onClick={() => T.skipPhase(t.id)} className={icon}><SkipForward className="size-4" /></button>
            <ResetBtn t={t} />
            <PlayBtn t={t} />
          </Card>
        )) : <Empty>Start a Pomodoro to cycle focus and breaks.</Empty>}
      </List>
    </>
  );
}
function PomoSettings({ st }: { st: T.Settings }) {
  const n = (k: "work" | "short" | "long" | "rounds", name: string, max: number) => (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
      {name}
      <input type="number" min={1} max={max} value={st[k]} onChange={(e) => T.setSettings({ [k]: Math.max(1, Math.min(max, Math.floor(+e.target.value || 1))) })} className={`${field} w-20`} />
    </label>
  );
  return (
    <div className="mt-3 flex flex-wrap gap-3 rounded-xl bg-white/[0.03] p-3">
      {n("work", "Focus (min)", 180)}
      {n("short", "Break (min)", 60)}
      {n("long", "Long break (min)", 120)}
      {n("rounds", "Rounds", 12)}
    </div>
  );
}

/* ---------------------------------------------------------------- stopwatch */
function StopwatchTab({ list }: { list: T.Timer[] }) {
  return (
    <>
      <div className="flex justify-end"><button type="button" onClick={T.addStopwatch} className={primary}><Plus className="size-3.5" />New stopwatch</button></div>
      <List>
        {list.length ? list.map((t) => (
          <div key={t.id}>
            <Card t={t}>
              <button type="button" disabled={!t.running} onClick={() => T.lap(t.id)} className={plain}><Flag className="size-3.5" />Lap</button>
              <ResetBtn t={t} />
              <PlayBtn t={t} />
            </Card>
            {t.laps.length > 0 && (
              <ol className="mx-3 mt-1 max-h-40 overflow-y-auto rounded-b-lg bg-white/[0.02] px-3 py-1.5 font-mono text-[12px] tabular-nums text-neutral-400 scrollbar-thin">
                {t.laps.map((l, i) => [l, i] as const).reverse().map(([l, i]) => (
                  <li key={i} className="flex justify-between py-0.5">
                    <span>Lap {i + 1}</span>
                    <span className="text-neutral-500">+{T.fmt(l - (t.laps[i - 1] ?? 0), true)}</span>
                    <span className="text-neutral-200">{T.fmt(l, true)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )) : <Empty>No stopwatches running.</Empty>}
      </List>
    </>
  );
}

/* ---------------------------------------------------------------- alarms */
function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Repeat on">
      {DAYS.map((d, i) => {
        const on = days.includes(i);
        return (
          <button key={i} type="button" aria-pressed={on} title={DAY_NAMES[i]} onClick={() => onChange(on ? days.filter((x) => x !== i) : [...days, i].sort())}
            className={`grid size-7 cursor-pointer place-items-center rounded-full text-[11px] font-semibold transition-colors ${on ? "bg-sky-500 text-white" : "bg-white/[0.05] text-neutral-500 hover:text-neutral-200"}`}>{d}</button>
        );
      })}
    </div>
  );
}
const repeatText = (days: number[]) =>
  !days.length ? "Once" : days.length === 7 ? "Every day" : days.join() === "1,2,3,4,5" ? "Weekdays" : days.join() === "0,6" ? "Weekends" : days.map((d) => DAY_NAMES[d]).join(", ");
function AlarmTab({ list }: { list: T.Timer[] }) {
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const add = () => {
    const [hh, mm] = time.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    T.addAlarm(hh, mm, days, label.trim() || "Alarm");
    setLabel("");
  };
  return (
    <>
      <form className="flex flex-col gap-2 rounded-xl bg-white/[0.03] p-3" onSubmit={(e) => (e.preventDefault(), add())}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className={`${field} h-10 font-mono text-[18px] [color-scheme:dark]`} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className={`${field} min-w-0 flex-1`} />
          <button type="submit" className={primary}><Plus className="size-3.5" />Add alarm</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-500">
          <DayPicker days={days} onChange={setDays} />
          <span>{repeatText(days)}</span>
          <span className="flex gap-1">
            <button type="button" onClick={() => setDays([1, 2, 3, 4, 5])} className="cursor-pointer rounded px-1.5 hover:text-neutral-200">Weekdays</button>
            <button type="button" onClick={() => setDays([])} className="cursor-pointer rounded px-1.5 hover:text-neutral-200">Clear days</button>
          </span>
        </div>
      </form>
      <List>
        {list.length ? list.map((t) => (
          <Card key={t.id} t={t} sub={
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <DayPicker days={t.days} onChange={(d) => T.updateAlarm(t.id, { days: d })} />
              <span>{repeatText(t.days)}{t.running && t.next ? ` · in ${T.fmt(T.valueOf(t))}` : ""}</span>
            </span>
          }>
            <input type="time" aria-label="Alarm time" value={`${pad(t.hh)}:${pad(t.mm)}`} onChange={(e) => { const [hh, mm] = e.target.value.split(":").map(Number); if (!Number.isNaN(hh) && !Number.isNaN(mm)) T.updateAlarm(t.id, { hh, mm }); }} className={`${field} w-[124px] [color-scheme:dark]`} />
            <Switch on={t.running} onChange={(v) => T.updateAlarm(t.id, { running: v })} label="Alarm on" />
          </Card>
        )) : <Empty>No alarms. Alarms are saved and ring while Oceanic is open.</Empty>}
      </List>
    </>
  );
}
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${on ? "bg-sky-500" : "bg-white/[0.12]"}`}>
      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/* ---------------------------------------------------------------- settings */
function SettingsTab({ st }: { st: T.Settings }) {
  const [hasCustom, setHasCustom] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => void loadCustom().then(setHasCustom), []);
  const row = (name: string, el: ReactNode, hint?: string) => (
    <div className="flex items-center gap-3 border-b border-white/[0.05] py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-neutral-200">{name}</p>
        {hint && <p className="text-[11.5px] text-neutral-500">{hint}</p>}
      </div>
      {el}
    </div>
  );
  return (
    <div>
      {row("Sound", (
        <div className="flex flex-wrap justify-end gap-1">
          {SOUNDS.map(([id, name]) => (
            <button key={id} type="button" aria-pressed={st.sound === id} disabled={id === "custom" && !hasCustom}
              onClick={() => (T.setSettings({ sound: id }), play(id, st.volume))}
              className={`h-7 cursor-pointer rounded-full px-3 text-[12px] transition-colors disabled:cursor-default disabled:opacity-40 ${st.sound === id ? "bg-sky-500 text-white" : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1]"}`}>{name}</button>
          ))}
        </div>
      ), "Click one to hear it.")}
      {row("Custom sound", (
        <div className="flex gap-1.5">
          <input ref={file} type="file" accept="audio/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              await saveCustom(f);
              setErr("");
              setHasCustom(true);
              T.setSettings({ sound: "custom" });
              play("custom", st.volume);
            } catch (x) {
              setErr(x instanceof Error ? x.message : "Couldn't save that file.");
            }
          }} />
          <button type="button" onClick={() => file.current?.click()} className={plain}><Upload className="size-3.5" />{hasCustom ? "Replace" : "Upload"}</button>
          {hasCustom && <button type="button" onClick={async () => (await clearCustom(), setHasCustom(false), st.sound === "custom" && T.setSettings({ sound: "chime" }))} className={plain}>Remove</button>}
        </div>
      ), err || "mp3, wav or ogg, up to 2 MB.")}
      {row("Volume", (
        <input type="range" min={0} max={1} step={0.05} value={st.volume} aria-label="Volume" style={{ ["--v" as string]: `${st.volume * 100}%` }} data-val={`${Math.round(st.volume * 100)}%`}
          onChange={(e) => T.setSettings({ volume: +e.target.value })} onPointerUp={() => play(st.sound, st.volume)} className="oc-trange w-40" />
      ), `${Math.round(st.volume * 100)}%`)}
      {row("Ring for", (
        <select value={st.ringFor} onChange={(e) => T.setSettings({ ringFor: +e.target.value })} className={`${field} [color-scheme:dark]`}>
          {[5, 15, 30, 60, 120].map((n) => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} min`}</option>)}
        </select>
      ), "The chime repeats until you dismiss it, up to this long.")}
      {row("System notification", <Switch on={st.notify} onChange={(v) => (T.setSettings({ notify: v }), v && T.askNotifyPermission())} label="System notification" />, "Also show an OS notification when a timer ends.")}
      <p className="mt-3 text-[11.5px] text-neutral-500">Running timers stop when Oceanic is fully closed. Presets, alarms and these settings are saved.</p>
    </div>
  );
}
