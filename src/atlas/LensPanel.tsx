import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Brain, Check, Link2, Plus, Route, Sparkles, Wand2, X } from "lucide-react";
import type { CanvasEdge, Concept, LinkEdge } from "../data/api";
import type { PageMeta } from "../data/workspace";
import * as L from "./lenses";
import { explainLink, neridaIdeas } from "./neridaAtlas";

const DOT: Record<Concept["state"], string> = { unexplored: "#737373", learning: "#f59e0b", understood: "#38bdf8", mastered: "#22c55e", review: "#f43f5e" };
const STATE_NAME: Record<Concept["state"], string> = { unexplored: "New", learning: "Learning", understood: "Got it", mastered: "Mastered", review: "Review" };
export const LENSES: [L.Lens, string, ReactNode, string][] = [
  ["study", "Study", <Brain className="size-3.5" />, "What to review next, from your learning states"],
  ["exam", "Exam map", <Route className="size-3.5" />, "Gather the notes for an exam or subject"],
  ["suggest", "Suggest", <Sparkles className="size-3.5" />, "Notes that look related but aren't linked"],
  ["cleanup", "Cleanup", <Wand2 className="size-3.5" />, "Unlinked, untagged and stale notes"],
];

type Props = {
  lens: L.Lens;
  /** Distance from the canvas' right edge (leaves room for the concept inspector). */
  right: number;
  pages: PageMeta[];
  concepts: Concept[];
  edges: CanvasEdge[];
  links: LinkEdge[];
  /** Cards already joined by a line (pairKey). */
  connected: Set<string>;
  degree: (id: string) => number;
  onPan: (id: string) => void;
  onOpen: (id: string) => void;
  onState: (id: string, state: Concept["state"]) => void;
  onConnect: (a: string, b: string) => void;
  /** Cards to keep bright on the canvas (null = all). */
  onBright: (ids: Set<string> | null) => void;
  onClose: () => void;
};

/** Side panel for the active Atlas lens. */
export function LensPanel(p: Props) {
  const [, name, icon, blurb] = LENSES.find((l) => l[0] === p.lens)!;
  useEffect(() => () => p.onBright(null), []);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} style={{ right: p.right }}
      className="oc-pop-in absolute top-14 z-20 flex max-h-[calc(100%-68px)] w-[min(320px,calc(100%-24px))] flex-col rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] shadow-xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <span className="text-sky-400">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-neutral-100">{name}</p>
          <p className="truncate text-[11.5px] text-neutral-500">{blurb}</p>
        </div>
        <button type="button" aria-label="Close" onClick={p.onClose} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {p.lens === "study" && <Study {...p} />}
        {p.lens === "exam" && <Exam {...p} />}
        {p.lens === "suggest" && <Suggest {...p} />}
        {p.lens === "cleanup" && <Cleanup {...p} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared bits */
const Head = ({ children, n }: { children: ReactNode; n?: number }) => (
  <p className="flex items-center gap-1.5 px-1.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
    {children}{n !== undefined && <span className="rounded-full bg-white/[0.06] px-1.5 text-[10px] text-neutral-400">{n}</span>}
  </p>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="px-2 py-3 text-[12px] leading-relaxed text-neutral-500">{children}</p>;
const btn = "h-6 shrink-0 cursor-pointer rounded-md px-1.5 text-[11px] font-medium text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100";
function Row({ title, sub, dot, onClick, children }: { title: string; sub?: ReactNode; dot?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.04]">
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      <button type="button" onClick={onClick} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block truncate text-[12.5px] text-neutral-200">{title || "Untitled"}</span>
        {sub && <span className="block truncate text-[11px] text-neutral-500">{sub}</span>}
      </button>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- study */
function Study(p: Props) {
  const q = useMemo(() => L.studyQueue(p.concepts, p.edges), [p.concepts, p.edges]);
  useEffect(() => p.onBright(new Set([...q.review, ...q.learning, ...q.ready].map((c) => c.id))), [q]);
  if (!p.concepts.length) return <Empty>Study works on concepts. Right-click the canvas and add concepts, then mark how well you know each one. Atlas then tells you what to review next.</Empty>;
  const total = p.concepts.length;
  const row = (c: Concept, next: Concept["state"][]) => (
    <Row key={c.id} title={c.title} dot={DOT[c.state]} sub={STATE_NAME[c.state]} onClick={() => p.onPan(c.id)}>
      <span className="hidden gap-0.5 group-hover:flex">
        {next.map((s) => <button key={s} type="button" title={`Mark ${STATE_NAME[s]}`} onClick={() => p.onState(c.id, s)} className={btn}>{STATE_NAME[s]}</button>)}
      </span>
    </Row>
  );
  return (
    <>
      <div className="mx-1.5 mb-1 mt-1">
        <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
          {(["mastered", "understood", "learning", "review", "unexplored"] as const).map((s) => {
            const n = p.concepts.filter((c) => c.state === s).length;
            return n ? <span key={s} title={`${STATE_NAME[s]}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: DOT[s] }} /> : null;
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-neutral-400">{q.done} of {total} understood or mastered</p>
      </div>
      <Head n={q.review.length}>Review now</Head>
      {q.review.length ? q.review.map((c) => row(c, ["understood", "mastered"])) : <Empty>Nothing marked for review.</Empty>}
      <Head n={q.learning.length}>Still learning</Head>
      {q.learning.length ? q.learning.map((c) => row(c, ["understood", "review"])) : <Empty>No concepts in progress.</Empty>}
      <Head n={q.ready.length}>Ready to start</Head>
      {q.ready.length ? q.ready.map((c) => row(c, ["learning", "understood"])) : <Empty>Nothing new is unlocked yet.</Empty>}
      {q.blocked.length > 0 && (
        <>
          <Head n={q.blocked.length}>Needs other concepts first</Head>
          {q.blocked.map((c) => row(c, ["learning"]))}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- exam map */
function Exam(p: Props) {
  const [maps, setMaps] = useState<L.ExamMaps>({});
  const [key, setKey] = useState("");
  const [find, setFind] = useState("");
  useEffect(() => void L.loadMaps().then((m) => (setMaps(m), setKey((k) => k || Object.keys(m)[0] || ""))), []);
  const exams = p.pages.filter((x) => x.tags?.includes("Exam"));
  const tags = [...new Set(p.pages.flatMap((x) => x.tags ?? []))].filter((t) => t !== "Exam" && t !== "Assignment").sort();
  const members = (maps[key] ?? []).filter((id) => p.pages.some((x) => x.id === id));
  const set = (ids: string[]) => {
    const next = { ...maps, [key]: [...new Set(ids)] };
    setMaps(next);
    void L.saveMaps(next);
  };
  const rec = key ? L.recommended(key, p.pages, p.links, members) : [];
  // Concepts joined to the map's notes: their learning states are the map's progress.
  const near = useMemo(() => {
    const ids = new Set(members);
    return p.concepts.filter((c) => p.edges.some((e) => (e.sourceId === c.id && ids.has(e.targetId)) || (e.targetId === c.id && ids.has(e.sourceId))));
  }, [members.join(), p.concepts, p.edges]);
  useEffect(() => p.onBright(key ? new Set([...members, ...near.map((c) => c.id), ...(key.startsWith("exam:") ? [key.slice(5)] : [])]) : null), [key, members.join(), near]);
  const title = (id: string) => p.pages.find((x) => x.id === id)?.title || "Untitled";
  const hits = find.trim() ? p.pages.filter((x) => !members.includes(x.id) && x.title.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6) : [];
  const known = near.filter((c) => c.state === "understood" || c.state === "mastered").length;
  return (
    <>
      <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Exam or subject"
        className="mx-1 mb-1 h-8 w-[calc(100%-8px)] cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[12.5px] text-neutral-100 outline-none [color-scheme:dark]">
        <option value="">Pick an exam or subject…</option>
        {exams.length > 0 && <optgroup label="Exams">{exams.map((x) => <option key={x.id} value={`exam:${x.id}`}>{x.title || "Untitled"}</option>)}</optgroup>}
        {tags.length > 0 && <optgroup label="Subjects (tags)">{tags.map((t) => <option key={t} value={`tag:${t}`}>{t}</option>)}</optgroup>}
      </select>
      {!key ? (
        <Empty>{exams.length || tags.length ? "Pick one to build its map. You choose the notes; Atlas recommends ones that share its tag." : "Tag a page “Exam” or give notes a subject tag, then build a map for it here."}</Empty>
      ) : (
        <>
          {near.length > 0 && <p className="px-2 pb-1 text-[11.5px] text-neutral-400">{known} of {near.length} linked concepts understood</p>}
          <Head n={members.length}>In this map</Head>
          {members.length ? members.map((id) => (
            <Row key={id} title={title(id)} onClick={() => p.onPan(id)}>
              <button type="button" title="Remove from map" onClick={() => set(members.filter((m) => m !== id))} className={`${btn} hidden group-hover:block`}><X className="size-3" /></button>
            </Row>
          )) : <Empty>No notes yet. Add recommended ones below, or search for any note.</Empty>}
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Add a note…" className="mx-1 mt-1 h-7 w-[calc(100%-8px)] rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[12px] text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-sky-500/60" />
          {hits.map((x) => <Row key={x.id} title={x.title} onClick={() => (set([...members, x.id]), setFind(""))}><Plus className="size-3.5 text-neutral-500" /></Row>)}
          <Head n={rec.length}>Recommended</Head>
          {rec.length ? (
            <>
              {rec.map((x) => (
                <Row key={x.id} title={x.title} sub={(x.tags ?? []).map((t) => `#${t}`).join(" ")} onClick={() => p.onPan(x.id)}>
                  <button type="button" onClick={() => set([...members, x.id])} className={btn}>Add</button>
                </Row>
              ))}
              {rec.length > 1 && <button type="button" onClick={() => set([...members, ...rec.map((x) => x.id)])} className="mx-1.5 mt-1 cursor-pointer text-[11.5px] text-sky-400 hover:text-sky-300">Add all {rec.length}</button>}
            </>
          ) : <Empty>No other notes share this map's tag.</Empty>}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- suggestions */
function Suggest(p: Props) {
  const [list, setList] = useState<L.Suggestion[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [explain, setExplain] = useState<{ k: string; text: string } | null>(null);
  const [ai, setAi] = useState<"idle" | "busy" | string>("idle");
  useEffect(() => {
    let live = true;
    L.loadDismissed().then(async (d) => {
      setDismissed(d);
      const s = await L.suggest(p.pages, p.connected, d);
      if (live) setList(s);
    });
    return () => void (live = false);
  }, []);
  const shown = (list ?? []).filter((s) => !p.connected.has(L.pairKey(s.a, s.b)) && !dismissed.has(L.pairKey(s.a, s.b)));
  useEffect(() => p.onBright(shown.length ? new Set(shown.flatMap((s) => [s.a, s.b])) : null), [shown.length]);
  const page = (id: string) => p.pages.find((x) => x.id === id)!;
  const dismiss = (s: L.Suggestion) => {
    const d = new Set(dismissed).add(L.pairKey(s.a, s.b));
    setDismissed(d);
    void L.saveDismissed(d);
  };
  const askNerida = async () => {
    setAi("busy");
    try {
      const more = await neridaIdeas(p.pages, p.connected);
      setList((l) => [...more.filter((m) => !(l ?? []).some((x) => L.pairKey(x.a, x.b) === L.pairKey(m.a, m.b))), ...(l ?? [])]);
      setAi(more.length ? "idle" : "Nerida found no new links.");
    } catch (e) {
      setAi(e instanceof Error ? e.message : "Nerida isn't set up yet. Set it up in Settings → Nerida.");
    }
  };
  const runExplain = async (s: L.Suggestion) => {
    const k = L.pairKey(s.a, s.b);
    if (explain?.k === k) return setExplain(null);
    setExplain({ k, text: "…" });
    try {
      await explainLink(page(s.a), page(s.b), (t) => setExplain({ k, text: t }));
    } catch (e) {
      setExplain({ k, text: e instanceof Error ? e.message : "Nerida isn't set up yet. Set it up in Settings → Nerida." });
    }
  };
  return (
    <>
      <button type="button" disabled={ai === "busy"} onClick={askNerida} className="mx-1 mb-1 flex h-8 w-[calc(100%-8px)] cursor-pointer items-center justify-center gap-1.5 rounded-md bg-violet-500/15 text-[12px] font-medium text-violet-200 hover:bg-violet-500/25 disabled:cursor-default disabled:opacity-60">
        <Sparkles className="size-3.5" />{ai === "busy" ? "Nerida is reading your notes…" : "Ask Nerida for more ideas"}
      </button>
      {ai !== "idle" && ai !== "busy" && <p className="px-2 pb-1 text-[11.5px] text-amber-300/90">{ai}</p>}
      {list === null ? <Empty>Reading your notes…</Empty> : !shown.length ? <Empty>No suggestions right now. Write more notes, or ask Nerida.</Empty> : shown.map((s) => {
        const k = L.pairKey(s.a, s.b);
        return (
          <div key={k} className="rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
            <div className="flex items-center gap-1 text-[12.5px] text-neutral-200">
              <button type="button" onClick={() => p.onPan(s.a)} className="min-w-0 cursor-pointer truncate hover:text-white">{page(s.a)?.title || "Untitled"}</button>
              <Link2 className="size-3 shrink-0 text-neutral-500" />
              <button type="button" onClick={() => p.onPan(s.b)} className="min-w-0 cursor-pointer truncate hover:text-white">{page(s.b)?.title || "Untitled"}</button>
            </div>
            <p className="truncate text-[11px] text-neutral-500">{s.source === "nerida" ? "Nerida: " : "Shared: "}{s.why.join(", ")}</p>
            <div className="mt-1 flex gap-1">
              <button type="button" onClick={() => p.onConnect(s.a, s.b)} className="flex h-6 cursor-pointer items-center gap-1 rounded-md bg-sky-500/15 px-2 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25"><Check className="size-3" />Link</button>
              <button type="button" onClick={() => runExplain(s)} className={btn}>Explain</button>
              <button type="button" onClick={() => dismiss(s)} className={btn}>Not related</button>
            </div>
            {explain?.k === k && <p className="mt-1.5 rounded-md bg-violet-500/[0.08] px-2 py-1.5 text-[12px] leading-relaxed text-neutral-300">{explain.text}</p>}
          </div>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------- cleanup */
function Cleanup(p: Props) {
  const c = useMemo(() => L.cleanup(p.pages, p.degree), [p.pages, p.degree]);
  useEffect(() => p.onBright(c.unlinked.length ? new Set(c.unlinked.map((x) => x.id)) : null), [c.unlinked.length]);
  const days = (x: PageMeta) => Math.floor((Date.now() - Date.parse(x.updatedAt!)) / 864e5);
  const sec = (title: string, list: PageMeta[], sub: (x: PageMeta) => string, empty: string) => (
    <>
      <Head n={list.length}>{title}</Head>
      {list.length ? list.slice(0, 30).map((x) => (
        <Row key={x.id} title={x.title} sub={sub(x)} onClick={() => p.onPan(x.id)}>
          <button type="button" onClick={() => p.onOpen(x.id)} className={`${btn} hidden group-hover:block`}>Open</button>
        </Row>
      )) : <Empty>{empty}</Empty>}
    </>
  );
  return (
    <>
      {sec("Not linked to anything", c.unlinked, () => "Drag from its edge to another card, or try Suggest", "Every note is linked.")}
      {sec("No tags", c.untagged, () => "Tags power filters and exam maps", "Every note has a tag.")}
      {sec("Not touched in 90+ days", c.stale, (x) => `${days(x)} days ago`, "Nothing stale.")}
      {c.unlinked.length + c.untagged.length + c.stale.length === 0 && <p className="flex items-center gap-1.5 px-2 pt-2 text-[12px] text-emerald-300"><Check className="size-3.5" />Your map is tidy.</p>}
    </>
  );
}
