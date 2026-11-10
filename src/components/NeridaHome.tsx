import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { House, LayoutDashboard, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { nerida, useNerida } from "../lib/nerida";
import { BetaPill, NeridaMark } from "./NeridaOrb";
import { openContextMenu } from "./ContextMenu";

const ROW = "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors";

/** Top-right segmented pill on Home: Home | Dashboard | Nerida. The highlight stretch-slides between items. */
const MODES = ["home", "dashboard", "nerida"] as const;
export function HomeSwitch() {
  const { homeMode } = useNerida();
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef(homeMode);
  const [pill, setPill] = useState<{ l: number; r: number; dir: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current?.children[MODES.indexOf(homeMode) + 1] as HTMLElement | undefined;
    if (!el || !box.current) return;
    const dir = Math.sign(MODES.indexOf(homeMode) - MODES.indexOf(prev.current));
    prev.current = homeMode;
    setPill({ l: el.offsetLeft, r: box.current.clientWidth - el.offsetLeft - el.offsetWidth, dir });
  }, [homeMode]);
  const btn = (mode: (typeof MODES)[number], icon: ReactNode, label: ReactNode) => (
    <button type="button" onClick={() => { nerida.set({ homeMode: mode }); try { localStorage.setItem("oc-home-mode", mode); } catch { /* not saved */ } }}
      className={`relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-200 ${homeMode === mode ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
      <span key={String(homeMode === mode)} className={homeMode === mode ? "oc-nudge flex" : "flex"}>{icon}</span>
      {label}
    </button>
  );
  return (
    <div ref={box} className="absolute right-4 top-3 z-10 flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-neutral-900/80 p-0.5 backdrop-blur">
      <span aria-hidden className={`oc-switch-pill ${homeMode === "nerida" ? "oc-switch-nerida" : ""}`} data-dir={pill?.dir ?? 0} style={pill ? { left: pill.l, right: pill.r } : { opacity: 0 }} />
      {btn("home", <House className="size-3.5" />, "Home")}
      {btn("dashboard", <LayoutDashboard className="size-3.5" />, "Dashboard")}
      {btn("nerida", <NeridaMark size={14} />, <>Nerida<BetaPill /></>)}
    </div>
  );
}

/** Left sidebar in the Nerida view: the conversation list (notes tree hidden). */
export function NeridaSidebar({ footer }: { footer: ReactNode }) {
  const { chats, activeId } = useNerida();
  const [q, setQ] = useState("");
  const shown = chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="oc-fade-in flex h-full w-[256px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06]">
      <div className="flex h-14 items-center gap-2.5 px-3 pt-1">
        <NeridaMark size={30} />
        <span className="bg-gradient-to-r from-white via-sky-200 to-violet-300 bg-clip-text text-[18px] font-extrabold tracking-tight text-transparent">Nerida</span>
        <BetaPill />
      </div>
      <div className="flex flex-col gap-1 px-2 pb-1">
        <button type="button" onClick={() => nerida.set({ activeId: null })} className={`${ROW} text-neutral-300 hover:bg-white/5`}>
          <Plus className="size-4 shrink-0 text-neutral-500" /> New chat
        </button>
        <label className="flex h-8 items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-2">
          <Search className="size-3.5 shrink-0 text-neutral-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-600" />
        </label>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        <p className="mt-3 px-2 pb-1 text-[12px] font-semibold text-neutral-500">Chats</p>
        {shown.length === 0 && <p className="px-2 py-1 text-[13px] text-neutral-600">{q ? "No matching chats" : "No chats yet"}</p>}
        {shown.map((c) => (
          <button key={c.id} type="button" onClick={() => nerida.set({ activeId: c.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              openContextMenu(e, [{ label: "Delete chat", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => nerida.remove(c.id) }]);
            }}
            className={`${ROW} ${c.id === activeId ? "bg-white/10 font-medium text-neutral-100" : "text-neutral-300 hover:bg-white/5"}`}>
            <MessageSquare className="size-3.5 shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate text-left">{c.title}</span>
          </button>
        ))}
      </div>
      {footer}
    </aside>
  );
}
