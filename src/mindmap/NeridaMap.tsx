import { useEffect, useState } from "react";
import { Plus, Square, X } from "lucide-react";
import { api } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { docText, engine, nerida } from "../lib/nerida";
import { BetaPill } from "../components/NeridaOrb";

/* Nerida for mindmaps: suggests subtopics as chips, you pick and add your own,
 * choose a depth, then preview the branches and remove any before adding. */

export type Branch = { id: string; label: string; kids: Branch[] };
/** Set by the Nerida panel's "Make a mindmap": the new map opens this dialog. */
export const MAP_FLAG = "oc-nerida-map";

async function list(prompt: string, max: number) {
  let out = "";
  await engine.chat(nerida.get().model, [{ role: "system", content: "You are Nerida, a study assistant. Reply only with a plain list, one item per line." }, { role: "user", content: prompt }], (t) => {
    out += t;
    if (out.length > 600) void engine.stop();
  });
  const seen = new Set<string>();
  return out
    .split("\n")
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").replace(/\*\*/g, "").replace(/[:.]$/, "").trim())
    .filter((l) => l && l.length < 60 && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, max);
}
const grow = async (label: string, root: string, depth: number): Promise<Branch[]> =>
  depth < 1 ? [] : Promise.all((await list(`List 3 short sub-points (2 to 4 words each) of "${label}", within the topic "${root}". No explanations.`, 4)).map(async (l) => ({ id: crypto.randomUUID(), label: l, kids: await grow(l, root, depth - 1) })));
const drop = (bs: Branch[], id: string): Branch[] => bs.filter((b) => b.id !== id).map((b) => ({ ...b, kids: drop(b.kids, id) }));

const chip = "cursor-pointer rounded-full border px-2.5 py-1 text-[12.5px]";

export function NeridaMapDialog({ topic: start, pages, onAdd, onClose }: { topic: string; pages?: PageMeta[]; onAdd: (b: Branch[]) => void; onClose: () => void }) {
  const [topic, setTopic] = useState(start);
  const [note, setNote] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState("");
  const [depth, setDepth] = useState(2);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<Branch[] | null>(null);

  const suggest = async () => {
    setBusy("Thinking of subtopics…");
    const ctx = note ? docText((await api.getPage(note))?.content ?? null).slice(0, 6000) : "";
    const got = await list(`List 6 short subtopics (2 to 4 words each) of "${topic}" for a study mindmap. No explanations.${ctx ? `\nBase them on this note:\n${ctx}` : ""}`, 8);
    setChips(got);
    setPicked(new Set(got));
    setBusy("");
  };
  useEffect(() => {
    if (!pages) void suggest(); // expanding a topic: suggest at once
    return () => void engine.stop();
  }, []);

  const addOwn = () => {
    const v = own.trim();
    if (!v) return;
    setChips((c) => (c.includes(v) ? c : [...c, v]));
    setPicked((p) => new Set(p).add(v));
    setOwn("");
  };
  const generate = async () => {
    setBusy("Building branches…");
    setPreview(await Promise.all(chips.filter((c) => picked.has(c)).map(async (c) => ({ id: crypto.randomUUID(), label: c, kids: await grow(c, topic, depth - 1) }))));
    setBusy("");
  };
  const tree = (bs: Branch[]) => (
    <ul className="ml-3 border-l border-white/[0.08] pl-2">
      {bs.map((b) => (
        <li key={b.id}>
          <span className="group flex items-center gap-1 py-0.5 text-[13px] text-neutral-200">
            {b.label}
            <button type="button" title="Remove" className="cursor-pointer text-neutral-600 opacity-0 hover:text-neutral-200 group-hover:opacity-100" onClick={() => setPreview((p) => drop(p!, b.id))}><X className="size-3" /></button>
          </span>
          {b.kids.length > 0 && tree(b.kids)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[440px] max-w-[92vw] rounded-xl border border-white/[0.1] bg-neutral-900 p-4 shadow-2xl" onKeyDown={(e) => e.stopPropagation()}>
        <p className="mb-3 text-[15px] font-semibold text-neutral-100">Mindmap with Nerida<BetaPill /></p>
        {busy ? (
          <div className="flex items-center justify-between py-6 text-[13px] text-neutral-400">
            {busy}
            <button type="button" title="Stop" className="cursor-pointer rounded-md p-1.5 hover:bg-white/[0.08]" onClick={() => void engine.stop()}><Square className="size-3.5" fill="currentColor" strokeWidth={0} /></button>
          </div>
        ) : preview ? (
          <>
            <p className="mb-1 text-[12px] text-neutral-500">Preview — hover a topic to remove it.</p>
            <div className="max-h-[50vh] overflow-auto">{tree(preview)}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-neutral-300 hover:bg-white/[0.06]" onClick={() => setPreview(null)}>Back</button>
              <button type="button" disabled={!preview.length} className="cursor-pointer rounded-md bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40" onClick={() => (onAdd(preview), onClose())}>Add to map</button>
            </div>
          </>
        ) : (
          <>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" className="w-full rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[13.5px] text-neutral-100 outline-none" />
            {pages && (
              <select value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[13px] text-neutral-300 outline-none [color-scheme:dark] [&>option]:bg-neutral-900">
                <option value="">From the topic only</option>
                {pages.map((p) => <option key={p.id} value={p.id}>From note: {p.title || "Untitled"}</option>)}
              </select>
            )}
            <button type="button" disabled={!topic.trim()} className={`${chip} mt-2 border-sky-500/40 text-sky-300 disabled:opacity-40`} onClick={() => void suggest()}>{chips.length ? "Suggest again" : "Suggest subtopics"}</button>
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => {
                  const on = picked.has(c);
                  return <button key={c} type="button" className={`${chip} ${on ? "border-sky-500/60 bg-sky-500/15 text-sky-100" : "border-white/[0.1] text-neutral-500"}`} onClick={() => setPicked((p) => { const x = new Set(p); on ? x.delete(c) : x.add(c); return x; })}>{c}</button>;
                })}
              </div>
            )}
            <div className="mt-3 flex gap-1.5">
              <input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOwn()} placeholder="Add your own idea…" className="flex-1 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[13px] text-neutral-100 outline-none" />
              <button type="button" title="Add" className="cursor-pointer rounded-md px-2 hover:bg-white/[0.08]" onClick={addOwn}><Plus className="size-4 text-neutral-300" /></button>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-neutral-400">
              Levels
              {[1, 2, 3].map((d) => <button key={d} type="button" className={`${chip} ${d === depth ? "border-sky-500/60 text-sky-100" : "border-white/[0.1]"}`} onClick={() => setDepth(d)}>{d}</button>)}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-neutral-300 hover:bg-white/[0.06]" onClick={onClose}>Cancel</button>
              <button type="button" disabled={!picked.size} className="cursor-pointer rounded-md bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40" onClick={() => void generate()}>Generate</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
