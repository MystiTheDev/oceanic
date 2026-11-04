import { useState } from "react";
import { Modal, ModalButton } from "./Modal";

export type MetaChoice = { meta: boolean; newTags: string[] } | null;

/**
 * Asked before importing .ocean notes that carry date/status/tags:
 * note only, or note plus its properties — and which unknown tags to create.
 */
export function ImportMetaDialog({ titles, existingTags, newTags, onDone }: { titles: string[]; existingTags: string[]; newTags: string[]; onDone: (c: MetaChoice) => void }) {
  const [meta, setMeta] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set(newTags));
  const flip = (t: string) => setPicked((s) => (s.has(t) ? (s.delete(t), new Set(s)) : new Set(s.add(t))));
  return (
    <Modal onClose={() => onDone(null)} className="w-[440px] p-5">
      <h2 className="text-[16px] font-semibold text-neutral-100">Import {titles.length === 1 ? `“${titles[0] || "Untitled"}”` : `${titles.length} notes`}</h2>
      <p className="mt-1 text-[13px] text-neutral-400">This file includes a date, status and tags. What do you want to import?</p>
      <div className="mt-4 flex flex-col gap-2">
        {[
          [false, "Note only", "Content, icon and banner"],
          [true, "Note + date, status & tags", "Keeps everything as it was exported"],
        ].map(([v, label, desc]) => (
          <label key={String(v)} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${meta === v ? "border-[var(--oc-accent,#2383e2)] bg-white/[0.04]" : "border-white/[0.08]"}`}>
            <input type="radio" checked={meta === v} onChange={() => setMeta(v as boolean)} className="mt-0.5" />
            <span>
              <span className="block text-[14px] text-neutral-100">{label as string}</span>
              <span className="block text-[12px] text-neutral-500">{desc as string}</span>
            </span>
          </label>
        ))}
      </div>
      {meta && (existingTags.length > 0 || newTags.length > 0) && (
        <div className="mt-4 text-[13px]">
          {existingTags.length > 0 && <p className="text-neutral-400">Already in Oceanic: <span className="text-neutral-200">{existingTags.join(", ")}</span></p>}
          {newTags.length > 0 && (
            <>
              <p className="mt-2 text-neutral-400">New tags from this file. Add them to your tags?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {newTags.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1 text-neutral-200">
                    <input type="checkbox" checked={picked.has(t)} onChange={() => flip(t)} /> {t}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={() => onDone(null)}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => onDone({ meta, newTags: meta ? [...picked] : [] })}>Import</ModalButton>
      </div>
    </Modal>
  );
}
