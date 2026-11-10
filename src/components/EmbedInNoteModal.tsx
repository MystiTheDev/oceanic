import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal, ModalButton } from "./Modal";

type NoteOption = { id: string; title: string };

/** Ctrl+Shift+M: choose a note for the open item, or create one. */
export function EmbedInNoteModal({ sourceName, notes, onPick, onCreate, onClose }: {
  sourceName: string;
  notes: NoteOption[];
  onPick: (noteId: string) => void;
  onCreate: (title: string, parentId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(sourceName);
  const [parentId, setParentId] = useState("");
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => notes.filter((n) => (n.title || "Untitled").toLowerCase().includes(q)), [notes, q]);
  const input = "w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[14px] text-neutral-200 outline-none focus:border-sky-500/60";

  return (
    <Modal onClose={onClose} className="w-[460px] p-5">
      <h2 className="text-[16px] font-semibold text-neutral-100">Embed “{sourceName}” in a note</h2>
      {creating ? (
        <>
          <label className="mt-4 block text-[13px] text-neutral-400">Title</label>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mt-1`} />
          <label className="mt-3 block text-[13px] text-neutral-400">Place inside</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${input} mt-1`}>
            <option value="">Top level</option>
            {notes.map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
          </select>
          <div className="mt-5 flex justify-end gap-2">
            <ModalButton onClick={() => setCreating(false)}>Back</ModalButton>
            <ModalButton variant="primary" onClick={() => onCreate(title.trim(), parentId || null)}>Create and embed</ModalButton>
          </div>
        </>
      ) : (
        <>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className={`${input} pl-9`} />
          </div>
          <div className="mt-2 h-[260px] overflow-y-auto">
            {matches.map((n) => (
              <button key={n.id} type="button" onClick={() => onPick(n.id)} className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-[14px] text-neutral-300 hover:bg-white/[0.08]">
                {n.title || "Untitled"}
              </button>
            ))}
            {!matches.length && <p className="px-3 py-6 text-center text-[13px] text-neutral-500">No notes found</p>}
          </div>
          <div className="mt-4 flex justify-between gap-2">
            <ModalButton onClick={() => setCreating(true)}>New note</ModalButton>
            <ModalButton onClick={onClose}>Cancel</ModalButton>
          </div>
        </>
      )}
    </Modal>
  );
}
