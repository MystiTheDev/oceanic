import { useEffect, useState, type ReactNode } from "react";
import { Upload, CalendarDays, Clock, Network, Plus, Sparkles, PenTool, Star, ListTodo, ArrowUp, ChevronDown, Check, Layers } from "lucide-react";
import { dueCards, openReview, useSrs } from "../lib/srs";
import { isAndroid } from "../mobile/formFactor";
import { nerida, useNerida, modelLabel, setDefaultModel } from "../lib/nerida";
import { NERIDA_ASK } from "../lib/neridaPdf";
import logoRaw from "../assets/logo-raw.png";
import { tagColor } from "../lib/colors";
import { api, type MindmapRecord } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { isoDate, parseIsoDate } from "../lib/colors";
import { getSeedBlocks } from "../data/workspace";
import { ScrollRow } from "./ScrollRow";
import { bannerBg, useBanner } from "../lib/banners";
import { TagChip } from "./PageProperties";
import type { AppView } from "./ViewSwitcher";

type HomeViewProps = {
  userName: string;
  pages: PageMeta[];
  /** Page ids, most recently opened first. */
  recent: string[];
  /** Mindmaps, most recently opened first. */
  mindmaps: MindmapRecord[];
  totalMindmaps: number;
  onOpenPage: (id: string) => void;
  onOpenMindmap: (id: string) => void;
  onNewPage: () => void;
  onNewMindmap: () => void;
  onImport: () => void;
  onNewSketch: () => void;
  onChangeView: (view: AppView) => void;
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export const ago = (iso?: string) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** Notion's Home, extended: hero, stats, quick actions, recents, then tasks beside maps. */
export function HomeView(props: HomeViewProps) {
  const { userName, pages, recent, onOpenPage, onNewPage, onChangeView } = props;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const visited = recent.map((id) => byId.get(id)).filter((p): p is PageMeta => !!p).slice(0, 12);

  const today = isoDate(new Date());
  const pending = pages.filter((p) => p.status === "not_started" || p.status === "in_progress" || (p.dueDate && p.status !== "done"));
  const overdue = pending.filter((p) => p.dueDate && p.dueDate < today);
  const dueToday = pending.filter((p) => p.dueDate === today);
  const glass = !isAndroid;
  const favs = pages.filter((p) => p.pinned).slice(0, 8);
  const dueN = dueCards(useSrs().cards).length;
  const tasks = [...pending].sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")).slice(0, 6);
  return (
    <div className={`oc-page-in scrollbar-thin relative h-full overflow-y-auto ${glass ? "oc-home-glass" : ""}`}>
      {glass && <div aria-hidden className="oc-home-aura"><i /><i /><i /></div>}
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-8 pb-24 pt-[14vh]">
        {/* ---- Brand + greeting ---- */}
        <div className="oc-home-brand flex flex-col items-center gap-3 text-center">
          <img src={logoRaw} alt="Oceanic" className="oc-brand-logo oc-logo-float -mb-2 size-24 rounded-[26px] object-contain" />
          <WaveWord text="Oceanic" className="text-[64px]" />
          <h1 className="mt-4 text-[28px] font-bold tracking-tight text-neutral-100">
            {greeting()}
            {userName ? `, ${userName}` : ""}
          </h1>
          <p className="-mt-1 text-[14px] text-neutral-400">
            Today is{" "}
            <span className="font-medium text-[color:var(--oc-brand-light)]">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </span>
          </p>
        </div>

        {glass && <HomeAsk />}

        <div className={glass ? "grid gap-4 min-[900px]:grid-cols-4" : ""}>
          {/* ---- What would you like to do today? ---- */}
          <div className={`${glass ? "oc-home-pane min-[900px]:order-2 min-[900px]:col-span-2" : "oc-home-hero mx-auto max-w-[760px] border border-white/[0.06]"} relative w-full overflow-hidden rounded-2xl px-5 py-4`}>
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-neutral-100">What would you like to do today?</h2>
              {dueN > 0 && (
                <button type="button" onClick={() => openReview()} title="Review flashcards due today"
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#a78bfa]/15 px-2.5 py-1 text-[12px] font-medium text-[#c4b5fd] hover:bg-[#a78bfa]/25">
                  <Layers className="size-3.5" /> {dueN} card{dueN === 1 ? "" : "s"} due
                </button>
              )}
              <StatusPill pages={pending} today={today} overdue={overdue.length} dueToday={dueToday.length} onOpen={onOpenPage} />
            </div>
            <div className={`mt-3 gap-2 ${glass ? "grid grid-cols-3" : "flex flex-wrap"}`}>
              <ActionPill tone="#5aa2e9" icon={<Plus className="size-3.5" />} label="New page" onClick={onNewPage} />
              <ActionPill tone="#a78bfa" icon={<Sparkles className="size-3.5" />} label="Mindmap" onClick={props.onNewMindmap} />
              <ActionPill tone="#2dd4bf" icon={<Network className="size-3.5" />} label="Atlas" onClick={() => onChangeView("atlas")} />
              <ActionPill tone="#fbbf24" icon={<CalendarDays className="size-3.5" />} label="Calendar" onClick={() => onChangeView("calendar")} />
              <ActionPill tone="#94a3b8" icon={<Upload className="size-3.5" />} label="Import" onClick={props.onImport} />
              <ActionPill tone="#f472b6" icon={<PenTool className="size-3.5" />} label="Sketch" onClick={props.onNewSketch} />
            </div>
          </div>
          {glass && <HomeList icon={<ListTodo className="size-3.5" />} className="min-[900px]:order-1" title="Tasks" empty="Nothing due. Nice." items={tasks} today={today} onOpen={onOpenPage} />}
          {glass && <HomeList icon={<Star className="size-3.5" />} className="min-[900px]:order-3" title="Favorites" empty="Star a page to pin it here." items={favs} today={today} onOpen={onOpenPage} />}
        </div>

        {/* ---- Recently visited ---- */}
        <section className="min-w-0">
          <SectionTitle icon={<Clock className="size-3.5" />}>Recently visited</SectionTitle>
          {!visited.length ? <Empty icon={<Clock className="size-4" />} action={{ label: "New page", onClick: onNewPage }}>Pages you open will show up here.</Empty>
          : glass ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {visited.slice(0, 6).map((p, i) => <RecentCard key={p.id} page={p} delay={i * 40} onOpen={() => onOpenPage(p.id)} />)}
            </div>
          ) : (
            <ScrollRow deps={visited.length}>
              {visited.map((p, i) => <RecentCard key={p.id} page={p} delay={i * 40} onOpen={() => onOpenPage(p.id)} />)}
            </ScrollRow>
          )}
        </section>
      </div>
    </div>
  );
}

function HomeList({ className = "", icon, title, empty, items, today, onOpen }: { className?: string; icon: ReactNode; title: string; empty: string; items: PageMeta[]; today: string; onOpen: (id: string) => void }) {
  return (
    <section className={`oc-home-pane oc-home-card scrollbar-thin min-w-0 overflow-y-auto rounded-2xl p-3 min-[900px]:max-h-[148px] ${className}`}>
      <SectionTitle icon={icon}>{title}</SectionTitle>
      {items.length ? items.map((p) => (
        <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="oc-glass-inset mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-neutral-200">
          <span>{p.icon}</span>
          <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
          {p.dueDate && <span className={`text-[11px] ${p.dueDate < today ? "text-red-400" : p.dueDate === today ? "text-[color:var(--oc-brand-light)]" : "text-neutral-500"}`}>{parseIsoDate(p.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
        </button>
      )) : <p className="px-1 py-3 text-[13px] text-neutral-500">{empty}</p>}
    </section>
  );
}

/** Home chat bar: sends the message to a fresh Nerida chat on the Nerida tab. */
function HomeAsk() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { model, providers } = useNerida();
  const models = ["nerida:plus", ...providers.flatMap((p) => p.models.map((m) => `custom:${p.id}:${m}`))];
  const send = () => {
    const t = text.trim();
    if (!t) return;
    nerida.set({ homeMode: "nerida", activeId: null });
    setText("");
    // The Nerida view mounts on the next render; ask once it listens.
    setTimeout(() => window.dispatchEvent(new CustomEvent(NERIDA_ASK, { detail: { text: t, send: true } })), 150);
  };
  return (
    <div className={`oc-home-pane oc-home-card relative flex w-full items-end gap-3 rounded-2xl px-4 py-3 ${open ? "z-30" : ""}`}>
      <Sparkles className="mb-1.5 size-4 shrink-0 text-[#818cf8]" />
      <textarea
        rows={1}
        value={text}
        placeholder="Ask Nerida anything about your notes…"
        onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px"; }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] text-neutral-100 outline-none placeholder:text-neutral-500"
      />
      <div className="relative mb-0.5">
        <button type="button" onClick={() => setOpen(!open)} className="oc-home-model flex max-w-[160px] cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-neutral-300">
          <span className="truncate">{modelLabel(model)}</span>
          <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="oc-glass-menu oc-pop-in absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-xl p-1">
              {models.map((m) => (
                <button key={m} type="button" onClick={() => { setDefaultModel(m); setOpen(false); }} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-neutral-200 hover:bg-white/[0.07]">
                  <span className="min-w-0 flex-1 truncate">{modelLabel(m)}</span>
                  {m === model && <Check className="size-3.5 text-[color:var(--oc-brand-light)]" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button type="button" onClick={send} disabled={!text.trim()} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-[color:var(--oc-brand)] text-white disabled:opacity-40">
        <ArrowUp className="size-4" />
      </button>
    </div>
  );
}

export function ActionPill({ tone, icon, label, onClick }: { tone: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ "--tone": tone } as React.CSSProperties}
      className="oc-action-tile flex h-8 cursor-pointer whitespace-nowrap items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-neutral-200 active:scale-[0.97]"
    >
      <span className="oc-action-icon grid size-5 place-items-center rounded-full">{icon}</span>
      {label}
    </button>
  );
}

/** Most urgent first: overdue, due today, next upcoming, else all caught up. */
export function StatusPill({
  pages,
  today,
  overdue,
  dueToday,
  onOpen,
}: {
  pages: PageMeta[];
  today: string;
  overdue: number;
  dueToday: number;
  onOpen: (id: string) => void;
}) {
  const next = pages.filter((p) => p.dueDate && p.dueDate > today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const [tone, text, target] = overdue
    ? ["#f87171", `${overdue} overdue`, undefined]
    : dueToday
      ? ["#5aa2e9", `${dueToday} due today`, undefined]
      : next
        ? ["#a3a3a3", `Next: ${next.title || "Untitled"} · ${parseIsoDate(next.dueDate!).toLocaleDateString(undefined, { weekday: "short" })}`, next.id]
        : ["#4ade80", "All caught up ✓", undefined];
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onOpen(target)}
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)`, borderColor: `color-mix(in srgb, ${tone} 35%, transparent)` }}
      className="oc-fade-in flex max-w-[50%] shrink-0 items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-[12px] font-medium enabled:cursor-pointer enabled:hover:brightness-125"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="truncate">{text}</span>
    </button>
  );
}

/** Wordmark whose letters bob in a slow wave, shading from white into brand blue. */
export function WaveWord({ text, className = "" }: { text: string; className?: string }) {
  const n = text.length;
  return (
    <span aria-label={text} className={`oc-wave-word font-extrabold leading-none tracking-[-0.035em] ${className}`}>
      {[...text].map((ch, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            animationDelay: `${i * 110}ms`,
            color: `color-mix(in srgb, var(--oc-brand-light) ${Math.round((i / Math.max(1, n - 1)) * 100)}%, var(--oc-text-strong))`,
          }}
        >
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </span>
  );
}

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
      {icon}
      {children}
    </h2>
  );
}

export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="oc-glass flex flex-col items-center gap-2 border-dashed px-4 py-6 text-center text-[13px] text-neutral-500">
      {icon && <span className="grid size-8 place-items-center rounded-full bg-white/[0.05] text-neutral-400">{icon}</span>}
      <p>{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100"
        >
          <Plus className="size-3.5" />
          {action.label}
        </button>
      )}
    </div>
  );
}


/** First line of text in a page, for the card snippet. */
function useSnippet(id: string, updatedAt?: string) {
  const [text, setText] = useState("");
  useEffect(() => {
    api.getPage(id).then((p) => {
      const blocks: any[] = p?.content ? JSON.parse(p.content) : (getSeedBlocks(id) as any[]);
      const lines: string[] = [];
      const walk = (bs: any[]) => {
        for (const b of bs ?? []) {
          if (lines.join(" ").length > 140) return;
          const t = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : typeof b.content === "string" ? b.content : "";
          if (t.trim()) lines.push(t.trim());
          walk(b.children);
        }
      };
      walk(blocks);
      setText(lines.join(" · "));
    });
  }, [id, updatedAt]);
  return text;
}

/** Notion-style cards: tinted cover, icon over the edge, title, snippet, tags, time. */
export function RecentCard({ page, delay, onOpen }: { page: PageMeta; delay: number; onOpen: () => void }) {
  const snippet = useSnippet(page.id, page.updatedAt);
  const tint = tagColor(page.tags?.[0] ?? page.id).solid;
  const banner = useBanner(page.id);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${delay}ms` }}
      className="oc-home-card group flex h-[214px] w-[260px] shrink-0 [.oc-home-glass_&]:w-full cursor-pointer flex-col overflow-hidden oc-glass oc-glass-hover text-left"
    >
      <div className="oc-home-cover h-[84px] shrink-0" style={{ background: banner ? bannerBg(banner) : `linear-gradient(135deg, ${tint}55, ${tint}14 70%, transparent)` }} />
      <span className="-mt-[18px] ml-3.5 inline-block origin-bottom-left text-[28px] leading-none transition-transform duration-200 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-hover:scale-[1.15]">
        {page.icon}
      </span>
      <span className="mt-2 truncate px-3.5 text-[14px] font-semibold text-neutral-100">{page.title || "Untitled"}</span>
      <span className="mt-1 line-clamp-2 px-3.5 text-[12px] leading-[17px] text-neutral-500">{snippet || "Empty page"}</span>
      <span className="mt-auto flex items-center gap-1.5 px-3.5 pb-3">
        {page.tags?.slice(0, 1).map((t) => <TagChip key={t} tag={t} small />)}
        <span className="ml-auto text-[11px] text-neutral-500">{ago(page.updatedAt)}</span>
      </span>
    </button>
  );
}

