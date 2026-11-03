import { useState, useSyncExternalStore } from "react";
import { Trash2, X } from "lucide-react";
import { api } from "../data/api";
import { Modal, ModalButton } from "../components/Modal";

/** One "Ask before deleting" switch per app (Settings → Deleting); all on by default. */
export type DeleteApp = "notes" | "docs" | "sketch" | "mindmap";
export const DELETE_APPS: { id: DeleteApp; label: string }[] = [
  { id: "notes", label: "Oceanic notes" },
  { id: "docs", label: "Oceanic Docs" },
  { id: "sketch", label: "Oceanic Sketch" },
  { id: "mindmap", label: "Oceanic Mindmap" },
];
const key = (app: DeleteApp) => `confirmDelete.${app}`;

/** How the item goes away; picks the dialog's wording. */
export type DeleteKind = "trash" | "recycle" | "remove" | "permanent";
export type DeleteRequest = {
  app: DeleteApp;
  title: string;
  kind: DeleteKind;
  /** Tab entry (`doc:…`, `sketch:…`, `mindmap:…`) — open ones must be closed first. */
  entry?: string;
  run: () => unknown | Promise<unknown>;
};

type State = { ask: Record<DeleteApp, boolean>; pending: DeleteRequest | null; blocked: boolean };
let state: State = { ask: { notes: true, docs: true, sketch: true, mindmap: true }, pending: null, blocked: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => ((state = { ...state, ...patch }), listeners.forEach((l) => l()));
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const useConfirmDelete = () => useSyncExternalStore(subscribe, () => state);

export function loadConfirmDeleteSettings(stored: Record<string, string>) {
  const ask = { ...state.ask };
  for (const { id } of DELETE_APPS) ask[id] = stored[key(id)] !== "false";
  set({ ask });
}
export function setAskBeforeDelete(app: DeleteApp, on: boolean) {
  set({ ask: { ...state.ask, [app]: on } });
  api.setSetting(key(app), String(on)).catch(() => {});
}

/** App registers how to tell whether an entry is open in some tab. */
let isOpen: (entry: string) => boolean = () => false;
export const setOpenProbe = (probe: (entry: string) => boolean) => void (isOpen = probe);

/** Delete through the app's rules: blocked while open, confirmed when that app asks. */
export function requestDelete(req: DeleteRequest) {
  const blocked = !!req.entry && isOpen(req.entry);
  if (!blocked && !state.ask[req.app]) return void Promise.resolve(req.run()).catch((e) => alert(`Couldn't delete: ${e}`));
  set({ pending: req, blocked });
}

const COPY: Record<DeleteKind, { title: string; verb: string; body: string }> = {
  trash: { title: "Move to Trash?", verb: "Move to Trash", body: "will move to Oceanic's Trash with its sub-pages. You can restore it from there." },
  recycle: { title: "Delete file?", verb: "Delete", body: "will be moved to the Recycle Bin. You can restore it from there." },
  remove: { title: "Remove from list?", verb: "Remove", body: "will be removed from your recent files. The file itself stays where it is." },
  permanent: { title: "Delete permanently?", verb: "Delete", body: "will be deleted. This can't be undone." },
};

/** The one confirmation dialog every app's Delete goes through. */
export function DeleteConfirmHost() {
  const { pending, blocked } = useConfirmDelete();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const c = COPY[pending.kind];
  const close = () => (setError(""), set({ pending: null, blocked: false }));
  const go = async () => {
    setBusy(true);
    try {
      await pending.run();
      close();
    } catch (e) {
      setError(`Couldn't delete: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={close} className="w-[400px] p-5">
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-400">{pending.kind === "remove" ? <X className="size-4" /> : <Trash2 className="size-4" />}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-neutral-100">{c.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">
            <span className="font-medium text-neutral-200">“{pending.title || "Untitled"}”</span> {c.body}
          </p>
          {blocked && <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[12.5px] text-amber-300">This is open in a tab. Close it first.</p>}
          {error && <p className="mt-2 text-[12.5px] text-red-400">{error}</p>}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={close}>Cancel</ModalButton>
        <ModalButton variant="danger" onClick={() => void go()} disabled={blocked || busy}>{c.verb}</ModalButton>
      </div>
    </Modal>
  );
}
