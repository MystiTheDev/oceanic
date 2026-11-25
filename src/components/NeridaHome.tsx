import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { House, MessageSquare, Pencil, Pin, PinOff, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { chatGroups, nerida, useNerida } from "../lib/nerida";
import { NeridaMark } from "./NeridaOrb";
import { openContextMenu } from "./ContextMenu";

const ROW = "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors";

/** Top-right segmented pill on Home: Home | Nerida. The highlight stretch-slides between items.
 * Plain Home vs Student dashboard is chosen in Settings → General. */
const MODES = ["home", "nerida"] as const;
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
    <div ref={box} className="oc-home-switch absolute right-4 top-3 z-10 flex items-center gap-0.5 rounded-full p-[3px]">
      <span aria-hidden className={`oc-switch-pill ${homeMode === "nerida" ? "oc-switch-nerida" : ""}`} data-dir={pill?.dir ?? 0} style={pill ? { left: pill.l, right: pill.r } : { opacity: 0 }} />
      {btn("home", <House className="size-3.5" />, "Home")}
      {btn("nerida", <Sparkles className="oc-switch-spark size-3.5" />, "Nerida")}
    </div>
  );
}

/** Left sidebar in the Nerida view: the conversation list (notes tree hidden). */
export function NeridaSidebar({ footer, collapsed: target, onExpand }: { footer: ReactNode; collapsed: boolean; onExpand: () => void }) {
  const { chats, activeId } = useNerida();
  // Rail layout waits for the 200ms close animation, so closing hides the full layout like opening reveals it.
  const [collapsed, setCollapsed] = useState(target);
  useEffect(() => {
    if (!target) return setCollapsed(false);
    const t = setTimeout(() => setCollapsed(true), 200);
    return () => clearTimeout(t);
  }, [target]);
  const closing = target && !collapsed;
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const shown = chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    // Expanded: content keeps full width and never wraps, so the animating edge uncovers it.
    <aside className={`oc-fade-in flex h-full w-[256px] shrink-0 flex-col overflow-hidden whitespace-nowrap border-r border-white/[0.06] ${collapsed ? "" : "[&>*]:w-[256px]"} ${closing ? "oc-keep [&_.overflow-y-auto]:!visible" : ""}`}>
      <div className="flex h-14 items-center gap-2.5 px-3 pt-1">
        <NeridaMark size={30} />
        {!collapsed && <span className="bg-gradient-to-r from-white via-sky-200 to-violet-300 bg-clip-text text-[18px] font-extrabold tracking-tight text-transparent">Nerida</span>}

      </div>
      <div className="flex flex-col gap-1 px-2 pb-1">
        <button type="button" title="New chat" onClick={() => nerida.set({ activeId: null })} className={`${ROW} text-neutral-300 hover:bg-white/5`}>
          <Plus className="size-4 shrink-0 text-neutral-500" /> New chat
        </button>
        {collapsed ? (
          <button type="button" title="Search chats" onClick={() => { onExpand(); setTimeout(() => search.current?.focus(), 220); }} className={`${ROW} text-neutral-300 hover:bg-white/5`}>
            <Search className="size-4 shrink-0 text-neutral-500" />
          </button>
        ) : (
          <label className="flex h-8 items-center gap-2 rounded-lg bg-white/[0.04] px-2 transition-shadow focus-within:shadow-[0_0_0_1px_rgba(45,212,191,0.35)]">
            <Search className="size-3.5 shrink-0 text-neutral-500" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-600" />
          </label>
        )}
      </div>
      {/* Collapsed rail: recent chats as icons (title shows as tooltip). */}
      {collapsed && chats.length > 0 && (
        <div className="mx-2 mt-1 flex flex-col gap-1 border-t border-white/[0.06] pt-2">
          {chats.slice(0, 5).map((c) => (
            <button key={c.id} type="button" title={c.title} onClick={() => nerida.set({ activeId: c.id })}
              className={`${ROW} ${c.id === activeId ? "bg-white/[0.08] text-teal-300" : "text-neutral-500 hover:bg-white/5"}`}>
              <MessageSquare className="size-4 shrink-0" />
            </button>
          ))}
        </div>
      )}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && (q
          ? <p className="mt-3 px-2 py-1 text-[13px] text-neutral-500">No chats match “{q}”</p>
          : <p className="mt-3 whitespace-normal px-2 py-1 text-[12.5px] leading-relaxed text-neutral-500">Your chats will show up here. Start one on the right, or type <kbd className="text-neutral-300">/</kbd> for study actions.</p>)}
        {[...(shown.some((c) => c.top) ? [["Pinned", shown.filter((c) => c.top)] as [string, typeof shown]] : []), ...chatGroups(shown.filter((c) => !c.top))].map(([group, list]) => (
          <div key={group}>
            <p className="mt-3 px-2 pb-1 text-[11.5px] font-semibold text-neutral-500">{group}</p>
            {list.map((c) => editing === c.id ? (
              <input key={c.id} autoFocus defaultValue={c.title} className={`${ROW} bg-white/10 text-neutral-100 outline-none`}
                onBlur={(e) => { if (e.target.value.trim()) nerida.rename(c.id, e.target.value.trim()); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }} />
            ) : (
              <div key={c.id} role="button" tabIndex={0} onClick={() => nerida.set({ activeId: c.id })} onDoubleClick={() => setEditing(c.id)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) (e.preventDefault(), nerida.set({ activeId: c.id })); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e, [
                    { label: c.top ? "Unpin" : "Pin to top", icon: c.top ? <PinOff className="size-4" /> : <Pin className="size-4" />, onSelect: () => nerida.toggleTop(c.id) },
                    { label: "Rename", icon: <Pencil className="size-4" />, onSelect: () => setEditing(c.id) },
                    { label: "Delete chat", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => nerida.remove(c.id) },
                  ]);
                }}
                className={`group relative ${ROW} ${c.id === activeId ? "bg-white/[0.08] font-medium text-neutral-100 before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-teal-300" : "text-neutral-300 hover:bg-white/5"}`}>
                <MessageSquare className="size-3.5 shrink-0 text-neutral-500" />
                <span className="min-w-0 flex-1 truncate text-left">{c.title}</span>
                <button type="button" title={c.top ? "Unpin" : "Pin to top"} onClick={(e) => { e.stopPropagation(); nerida.toggleTop(c.id); }} className={`cursor-pointer text-neutral-500 hover:text-neutral-200 ${c.top ? "" : "hidden group-hover:block"}`}>{c.top ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
                <button type="button" title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(c.id); }} className="hidden cursor-pointer text-neutral-500 hover:text-neutral-200 group-hover:block"><Pencil className="size-3.5" /></button>
                <button type="button" title="Delete chat" onClick={(e) => { e.stopPropagation(); nerida.remove(c.id); }} className="hidden cursor-pointer text-neutral-500 hover:text-red-400 group-hover:block"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col">{footer}</div>
    </aside>
  );
}
