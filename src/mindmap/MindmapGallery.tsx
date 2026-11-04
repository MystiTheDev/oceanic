import { requestDelete } from "../lib/confirmDelete";
import { OpenNowRow, type OpenItem } from "../components/OpenNowRow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { importOmap } from "../lib/omapFile";
import { readFileBytes } from "../lib/fileIO";
import { HomeMotif } from "../components/HomeMotif";
import { useEffect, useMemo, useState } from "react";
import { ScrollRow } from "../components/ScrollRow";
import { Copy, ImagePlus, LayoutGrid, List, MoreHorizontal, Network, PenLine, Plus, Search, Trash2 } from "lucide-react";
import { api, type MindmapRecord } from "../data/api";
import { openContextMenu } from "../components/ContextMenu";
import { Modal, ModalButton } from "../components/Modal";
import { Preview } from "../editor/mindmapBlock";
import mindmapLogo from "../assets/mindmap-logo.png";
import { ROOT, SUBJECTS, fromRecord, layout, logoOf, subjectOf, toRecord, type MNode } from "./model";
import { MapLogo, askNewMap, changeMapLogo } from "./MapDialogs";

const SAVED = "oceanic:mindmap-saved";
const announce = (id: string) => window.dispatchEvent(new CustomEvent(SAVED, { detail: id }));
/** Mindmap's Delete (permanent), per Settings → Deleting; blocked while the map is open. */
export const askDeleteMindmap = (m: { id: string; title: string }) =>
  requestDelete({ app: "mindmap", kind: "permanent", title: m.title, entry: `mindmap:${m.id}`, run: async () => (await api.deleteMindmap(m.id), announce(m.id)) });

/**
 * Asks for the new map's name and logo, then creates it from a subject preset
 * (its branches pre-filled) and returns its id. Cancelling never resolves, so
 * callers that `await` it simply do nothing.
 */
export async function createMindmap(subjectId: string): Promise<string> {
  const subj = subjectOf(subjectId);
  const answer = await askNewMap(subjectId ? subj.label : "Untitled mindmap", subjectId ? subj.icon : "🧠");
  if (!answer) return new Promise<string>(() => {});
  const { name: title, logo } = answer;
  const m = await api.createMindmap(title, subjectId);
  const base = m.nodes?.length ? m.nodes.map(fromRecord) : presetNodes(subjectId).slice(0, 1);
  const nodes = subj.branches.length ? layout(presetNodes(subjectId)) : base;
  const named = nodes.map((n) => (n.id === ROOT ? { ...n, label: title, style: { ...n.style, logo } } : n));
  await api.saveMindmap(m.id, title, subjectId, named.map(toRecord));
  queueMicrotask(() => announce(m.id));
  return m.id;
}

/** Centre topic plus the subject's starter branches. */
function presetNodes(subjectId: string): MNode[] {
  const subj = subjectOf(subjectId);
  const title = subjectId ? subj.label : "Untitled mindmap";
  return [
    { id: ROOT, label: title, x: 0, y: 0, parentId: null, linkedPageId: null, style: { shape: "pill" } },
    ...subj.branches.map((b, i) => ({ id: `b${i}`, label: b, x: 0, y: 0, parentId: ROOT, linkedPageId: null, style: {} })),
  ];
}

/** Template previews only: branches in Mindmap brand colours. */
const BRANCH_COLORS = ["purple", "blue", "pink", "green", "orange"];
const tinted = (nodes: MNode[]) =>
  nodes.map((n, i) => (n.parentId ? { ...n, style: { ...n.style, color: BRANCH_COLORS[i % BRANCH_COLORS.length] } } : n));

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

type Sort = "edited" | "created" | "name";
const SORTS: Record<Sort, string> = { edited: "Last edited", created: "Created", name: "Name" };

/** Map nodes for thumbnails, cached per map version. */
function useNodes(m: MindmapRecord) {
  const [nodes, setNodes] = useState<MNode[] | null>(null);
  useEffect(() => {
    api.getMindmapById(m.id).then((x) => setNodes(x ? x.nodes.map(fromRecord) : []));
  }, [m.id, m.updatedAt]);
  return nodes;
}

/** Oceanic Mindmap home: branded header, template strip, then every map as grid or list. */
export function MindmapGallery({ onOpen, openNow, onFocusTab, onCloseTab }: { onOpen: (id: string) => void; openNow: OpenItem[]; onFocusTab: (tabId: string) => void; onCloseTab: (tabId: string) => void }) {
  const [maps, setMaps] = useState<MindmapRecord[] | null>(null);
  const [renaming, setRenaming] = useState<MindmapRecord | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("edited");
  const [mode, setMode] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("oceanic.mindmapGallery") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const reload = () => api.getAllMindmaps().then(setMaps);
  useEffect(() => {
    void reload();
    window.addEventListener(SAVED, reload);
    return () => window.removeEventListener(SAVED, reload);
  }, []);

  const setView = (m: "grid" | "list") => {
    setMode(m);
    try {
      localStorage.setItem("oceanic.mindmapGallery", m);
    } catch {
      /* storage blocked */
    }
  };

  const create = async (s: string) => onOpen(await createMindmap(s));

  const rename = async (m: MindmapRecord, title: string) => {
    const full = await api.getMindmapById(m.id);
    if (!full || !title.trim()) return;
    const nodes = full.nodes.map((n) => (n.id === ROOT ? { ...n, label: title.trim() } : n));
    await api.saveMindmap(m.id, title.trim(), m.subjectTag, nodes);
    announce(m.id);
  };
  const duplicate = async (m: MindmapRecord) => {
    const full = await api.getMindmapById(m.id);
    if (!full) return;
    const copy = await api.createMindmap(`${m.title} (copy)`, m.subjectTag);
    const nodes = full.nodes.map((n) => (n.id === ROOT ? { ...n, label: `${m.title} (copy)` } : n));
    await api.saveMindmap(copy.id, `${m.title} (copy)`, m.subjectTag, nodes);
    announce(copy.id);
  };
  const menu = (e: React.MouseEvent, m: MindmapRecord) =>
    openContextMenu(e, [
      { label: "Open", onSelect: () => onOpen(m.id) },
      { label: "Rename", icon: <PenLine className="size-4" />, onSelect: () => setRenaming(m) },
      { label: "Change logo", icon: <ImagePlus className="size-4" />, onSelect: async () => void changeMapLogo(m, logoOf((await api.getMindmapById(m.id))?.nodes.map(fromRecord), m.subjectTag)) },
      { label: "Duplicate", icon: <Copy className="size-4" />, onSelect: () => void duplicate(m) },
      "divider",
      { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => askDeleteMindmap(m) },
    ]);

  const usedSubjects = useMemo(() => [...new Set((maps ?? []).map((m) => m.subjectTag))], [maps]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (maps ?? []).filter((m) => (subject === null || m.subjectTag === subject) && m.title.toLowerCase().includes(q));
    if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "created") list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }, [maps, subject, query, sort]);

  return (
    <div className="oc-app-home oc-docs-home-in scrollbar-thin relative h-full overflow-y-auto" style={{ "--home-tone": "var(--oc-mm-violet)" } as React.CSSProperties}>
      <HomeMotif kind="mindmap" />
      <div className="oc-stagger relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 pb-24 pt-[10vh]">
        {/* ---- Brand ---- */}
        <div className="oc-home-brand flex flex-col items-center gap-3 text-center">
          <span className="oc-mm-logo-wrap -mb-3 size-32">
            <span className="oc-mm-ring" />
            <span className="oc-mm-ring" />
            <span className="oc-mm-ring" />
            <img src={mindmapLogo} alt="Oceanic Mindmap" className="oc-mm-logo relative size-32 object-contain" />
          </span>
          <span aria-label="Oceanic Mindmap" className="oc-node-word text-[52px] font-extrabold leading-none tracking-[-0.035em]">
            {[..."Oceanic Mindmap"].map((ch, i, all) => (
              <span
                key={i}
                aria-hidden
                style={{
                  // intro, then the sweep (starts after every letter has landed)
                  animationDelay: `${250 + i * 45}ms, ${1400 + i * 80}ms`,
                  color: `color-mix(in srgb, var(--oc-mm-violet-light) ${Math.round((i / (all.length - 1)) * 100)}%, var(--oc-text-strong))`,
                }}
              >
                {ch === " " ? "\u00a0" : ch}
              </span>
            ))}
          </span>
          <p className="text-[14px] text-neutral-400">Create wonderful Mind Maps without ever switching!!</p>
        </div>

        <OpenNowRow items={openNow} icon={<Network className="size-4" />} tone="var(--oc-mm-violet)" onFocus={onFocusTab} onClose={onCloseTab} />
        {/* ---- Templates ---- */}
        <div className="oc-mm-hero rounded-2xl border px-6 py-5">
          <h2 className="mb-3 text-[16px] font-semibold text-neutral-100">Start a new map</h2>
          <ScrollRow>
            {SUBJECTS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void create(s.id)}
                style={{ animationDelay: `${i * 30}ms` }}
                className="oc-home-card oc-glass oc-mm-template flex w-[168px] shrink-0 cursor-pointer flex-col overflow-hidden text-left"
              >
                <div className="oc-mm-template-art pointer-events-none h-[84px] p-1.5">
                  {s.id ? (
                    <Preview nodes={tinted(layout(presetNodes(s.id)))} />
                  ) : (
                    <div className="grid h-full place-items-center text-[28px] text-neutral-500">
                      <Plus size={26} />
                    </div>
                  )}
                </div>
                <span className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium text-neutral-100">
                  <span>{s.id ? s.icon : "✨"}</span>
                  {s.id ? s.label : "Blank map"}
                </span>
              </button>
            ))}
          </ScrollRow>
        </div>

        {/* ---- Your maps ---- */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Your maps</h2>
            <button
              type="button"
              onClick={async () => {
                const f = await openDialog({ title: "Open a mindmap", filters: [{ name: "Oceanic mindmap", extensions: ["omap"] }] });
                if (typeof f !== "string") return;
                try {
                  const r = await importOmap(await readFileBytes(f));
                  // Already in Oceanic: no duplicate, open the existing map.
                  if (r.existing) window.alert(`“${r.title}” already exists in Oceanic, so it wasn't imported. Opening the existing map.`);
                  onOpen(r.id);
                } catch (e) {
                  window.alert(`Couldn't open this mindmap: ${e instanceof Error ? e.message : e}`);
                }
              }}
              className="order-last ml-auto flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
            >
              Open .omap
            </button>
            <Chip active={subject === null} onClick={() => setSubject(null)}>
              All
            </Chip>
            {usedSubjects.map((s) => (
              <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>
                {subjectOf(s).icon} {s ? subjectOf(s).label : "General"}
              </Chip>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <label className="flex h-8 w-44 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 focus-within:border-[color:var(--oc-brand-light)]/50">
                <Search className="size-3.5 shrink-0 text-neutral-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter maps…"
                  className="w-full bg-transparent text-[13px] text-neutral-200 outline-none placeholder:text-neutral-500"
                />
              </label>
              <button
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openContextMenu(
                    { clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} } as never,
                    (Object.keys(SORTS) as Sort[]).map((k) => ({ label: SORTS[k], checked: sort === k, onSelect: () => setSort(k) })),
                  );
                }}
                className="h-8 cursor-pointer rounded-lg border border-white/[0.08] px-2.5 text-[12px] text-neutral-400 hover:bg-white/[0.05]"
              >
                {SORTS[sort]}
              </button>
              <div className="flex rounded-lg bg-white/[0.05] p-0.5">
                {(["grid", "list"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    title={m === "grid" ? "Grid" : "List"}
                    onClick={() => setView(m)}
                    className={`grid size-7 cursor-pointer place-items-center rounded-md transition-colors ${
                      mode === m ? "bg-white/[0.12] text-neutral-100" : "text-neutral-500 hover:text-neutral-200"
                    }`}
                  >
                    {m === "grid" ? <LayoutGrid size={14} /> : <List size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {maps && shown.length === 0 ? (
            <p className="oc-glass border-dashed px-4 py-8 text-center text-[13px] text-neutral-500">
              {maps.length ? "No maps match." : "No mindmaps yet. Pick a template above to start one."}
            </p>
          ) : mode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {shown.map((m, i) => (
                <GridCard key={m.id} map={m} delay={i * 30} onOpen={() => onOpen(m.id)} onMenu={(e) => menu(e, m)} />
              ))}
              <button
                type="button"
                onClick={() => void create("")}
                className="oc-glass oc-glass-hover flex h-[168px] cursor-pointer flex-col items-center justify-center gap-1.5 border-dashed text-[13px] text-neutral-500 hover:text-neutral-300"
              >
                <Plus size={18} /> New mindmap
              </button>
            </div>
          ) : (
            <div className="oc-glass overflow-hidden">
              <div className="grid grid-cols-[64px_minmax(0,1fr)_140px_80px_90px_36px] items-center gap-3 border-b border-white/[0.06] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <span />
                <span>Name</span>
                <span>Subject</span>
                <span>Topics</span>
                <span>Edited</span>
                <span />
              </div>
              {shown.map((m) => (
                <ListRow key={m.id} map={m} onOpen={() => onOpen(m.id)} onMenu={(e) => menu(e, m)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {renaming && (
        <Modal onClose={() => setRenaming(null)}>
          <form
            className="flex flex-col gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const title = new FormData(e.currentTarget).get("title") as string;
              void rename(renaming, title);
              setRenaming(null);
            }}
          >
            <h2 className="text-[15px] font-semibold text-neutral-100">Rename mindmap</h2>
            <input
              name="title"
              autoFocus
              defaultValue={renaming.title}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[14px] text-neutral-100 outline-none focus:border-sky-500/60"
            />
            <div className="flex justify-end gap-2">
              <ModalButton onClick={() => setRenaming(null)}>Cancel</ModalButton>
              <button type="submit" className="h-8 cursor-pointer rounded-md bg-sky-600 px-3 text-[13px] font-medium text-[#fff] hover:bg-sky-500">
                Rename
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function GridCard({ map, delay, onOpen, onMenu }: { map: MindmapRecord; delay: number; onOpen: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const nodes = useNodes(map);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      onContextMenu={onMenu}
      style={{ animationDelay: `${delay}ms` }}
      className="oc-home-card oc-glass oc-glass-hover group relative flex h-[168px] cursor-pointer flex-col overflow-hidden text-left"
    >
      <div className="pointer-events-none h-[104px] shrink-0 bg-[var(--oc-canvas)] p-1.5">{nodes && <Preview nodes={nodes} />}</div>
      <div className="flex min-w-0 items-center gap-1.5 px-3 pt-2 text-[13px] font-medium text-neutral-100">
        <span className="shrink-0">{logoOf(nodes, map.subjectTag)}</span>
        <span className="truncate">{map.title}</span>
      </div>
      <span className="px-3 pt-0.5 text-[11px] text-neutral-500">
        {map.nodeCount} topic{map.nodeCount === 1 ? "" : "s"} · {ago(map.updatedAt)}
      </span>
      <MenuButton onMenu={onMenu} className="absolute right-2 top-2" />
    </div>
  );
}

function ListRow({ map, onOpen, onMenu }: { map: MindmapRecord; onOpen: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const nodes = useNodes(map);
  const subj = subjectOf(map.subjectTag);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      onContextMenu={onMenu}
      className="group grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_140px_80px_90px_36px] items-center gap-3 border-b border-white/[0.04] px-3 py-2 text-[13px] transition-colors last:border-0 hover:bg-white/[0.04]"
    >
      <div className="pointer-events-none h-10 overflow-hidden rounded-md bg-[var(--oc-canvas)] p-0.5">{nodes && <Preview nodes={nodes} />}</div>
      <span className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-100">
        <span className="shrink-0">
          <MapLogo map={map} />
        </span>
        <span className="truncate">{map.title}</span>
      </span>
      <span className="truncate text-neutral-400">
        {subj.icon} {map.subjectTag ? subj.label : "General"}
      </span>
      <span className="text-neutral-400">{map.nodeCount}</span>
      <span className="text-neutral-500">{ago(map.updatedAt)}</span>
      <MenuButton onMenu={onMenu} />
    </div>
  );
}

function MenuButton({ onMenu, className = "" }: { onMenu: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <button
      type="button"
      title="More"
      onClick={(e) => {
        e.stopPropagation();
        onMenu(e);
      }}
      className={`grid size-7 cursor-pointer place-items-center rounded-md bg-[var(--oc-surface)]/80 text-neutral-400 opacity-0 transition-opacity hover:text-neutral-100 group-hover:opacity-100 ${className}`}
    >
      <MoreHorizontal size={15} />
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 cursor-pointer rounded-full border px-3 text-[12px] transition-colors ${
        active
          ? "border-[color:var(--oc-brand-light)]/50 bg-[color:var(--oc-brand)]/15 text-[color:var(--oc-brand-light)]"
          : "border-white/[0.08] text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}
