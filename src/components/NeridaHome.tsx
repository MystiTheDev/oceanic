import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { House, MessageSquare, Pencil, Pin, PinOff, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { chatGroups, nerida, useNerida } from "../lib/nerida";
import { NeridaMark } from "./NeridaOrb";
import { openContextMenu } from "./ContextMenu";

const ROW = "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors";
const ago = (t: number) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

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
    <aside className={`oc-nerida-side oc-fade-in flex h-full w-[256px] shrink-0 flex-col overflow-hidden whitespace-nowrap border-r border-white/[0.06] ${collapsed ? "" : "[&>*]:w-[256px]"} ${closing ? "oc-keep [&_.overflow-y-auto]:!visible" : ""}`}>
      <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.06] px-3 pt-1">
        <span className="oc-nerida-side-orb"><NeridaMark size={32} /></span>
        {!collapsed && <span className="bg-gradient-to-r from-white via-sky-200 to-violet-300 bg-clip-text text-[19px] font-extrabold tracking-tight text-transparent">Nerida</span>}

      </div>
      <div className="flex flex-col gap-1 px-2 pb-1">
        {collapsed ? (
          <button type="button" title="Search chats" onClick={() => { onExpand(); setTimeout(() => search.current?.focus(), 220); }} className={`${ROW} text-neutral-300 hover:bg-white/5`}>
            <Search className="size-4 shrink-0 text-neutral-500" />
          </button>
        ) : (
          <label className="oc-nerida-side-search flex h-9 items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 transition-shadow focus-within:shadow-[0_0_0_1px_rgba(45,212,191,0.45)]">
            <Search className="size-4 shrink-0 text-neutral-500" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500" />
          </label>
        )}
        <button type="button" title="New chat" onClick={() => nerida.set({ activeId: null })} className="oc-nerida-side-new flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-semibold transition-[background,border-color]">
          <Plus className="size-4 shrink-0 text-teal-300" /> New chat
        </button>
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
          ? <p className="oc-nerida-side-miss">No chats match “{q}”</p>
          : !collapsed && <div className="oc-nerida-side-empty">
              <NeridaMark size={34} />
              <p className="oc-nerida-side-empty-title">No chats yet</p>
              <p className="oc-nerida-side-empty-copy">Ask anything about your notes, or type <kbd className="text-neutral-300">/</kbd> for study actions.</p>
            </div>)}
        {[...(shown.some((c) => c.top) ? [["Pinned", shown.filter((c) => c.top)] as [string, typeof shown]] : []), ...chatGroups(shown.filter((c) => !c.top))].map(([group, list]) => (
          <div key={group}>
            <p className="oc-nerida-side-group mt-3 px-2 pb-1 text-[11.5px] font-semibold text-neutral-500">{group}</p>
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
                className={`group relative ${ROW} oc-nerida-side-row ${c.id === activeId ? "oc-nerida-side-row-on font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-teal-300" : "text-neutral-300 hover:bg-white/5"}`}>
                <span className="oc-nerida-side-row-icon"><MessageSquare className="size-3.5" /></span>
                <span className="min-w-0 flex-1 truncate text-left">{c.title}</span>
                <span className="shrink-0 text-[10.5px] text-neutral-500 group-hover:hidden">{ago(c.updatedAt)}</span>
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
