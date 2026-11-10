import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { api } from "../data/api";
import { NERIDA_TASK, prettyDate, type TaskDraft, type TaskRequest } from "../lib/neridaTask";

/** Confirm card in Nerida's chat: edit title, date, tag and where it goes, then Add. */
export function NeridaTaskCard({ draft, pageId, pageTitle, onDone }: { draft: TaskDraft; pageId: string | null; pageTitle: string | null; onDone: (summary: string | null) => void }) {
  const [title, setTitle] = useState(draft.title);
  const [date, setDate] = useState(draft.date);
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [target, setTarget] = useState<"new" | "current">("new");
  useEffect(() => void api.getSettings().then((s) => setTags(JSON.parse(s.tagLibrary ?? "[]"))).catch(() => {}), []);

  const add = () => {
    const req: TaskRequest = { title: title.trim() || "New task", dueDate: date, tag: tag || null, target, pageId };
    window.dispatchEvent(new CustomEvent(NERIDA_TASK, { detail: req }));
    const what = target === "current" && pageTitle ? `the due date on **${pageTitle}**` : `**${req.title}**`;
    onDone(`Added ${what} for ${prettyDate(date)}${req.tag ? ` (tag: ${req.tag})` : ""}. It's on your calendar.`);
  };
  const field = "w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[13px] text-neutral-100 outline-none focus:border-sky-400/50";

  return (
    <div className="mt-4 rounded-xl border border-white/[0.1] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-neutral-400"><CalendarPlus className="size-4 text-sky-300" /> Add to calendar?</div>
      {pageId && (
        <div className="mb-2 flex gap-1 rounded-lg bg-white/[0.04] p-0.5 text-[12px]">
          {(["new", "current"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTarget(t)} className={`flex-1 cursor-pointer truncate rounded-md px-2 py-1 ${target === t ? "bg-white/[0.1] text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
              {t === "new" ? "New note" : `This note${pageTitle ? `: ${pageTitle}` : ""}`}
            </button>
          ))}
        </div>
      )}
      {target === "new" && <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={`${field} mb-2`} />}
      <div className="flex gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} [color-scheme:dark]`} />
        <select value={tag} onChange={(e) => setTag(e.target.value)} className={`${field} cursor-pointer [color-scheme:dark] [&>option]:bg-neutral-900 [&>option]:text-neutral-100`}>
          <option value="">No tag</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <button type="button" onClick={() => onDone(null)} className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Cancel</button>
        <button type="button" disabled={!date} onClick={add} className="cursor-pointer rounded-md bg-sky-500/25 px-3 py-1.5 text-[12.5px] text-sky-100 hover:bg-sky-500/35 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}
