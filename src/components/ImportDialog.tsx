import { useState } from "react";
import { AlertTriangle, Check, FileUp, X } from "lucide-react";
import { Modal, ModalButton } from "./Modal";
import { pickImportFiles, type InFile, type ImportFailure } from "../lib/importNotes";
import type { PageMeta } from "../data/workspace";
import type { WorkspaceRecord } from "../data/api";

export type ImportDest = { workspaceId: string; parentId: string | null };
/** pick: choosing files. run: importing. done: summary. */
export type ImportState =
  | { stage: "pick" }
  | { stage: "run"; done: number; total: number; label: string }
  | { stage: "done"; created: PageMeta[]; failed: ImportFailure[] };

const FORMATS = ["Oceanic (.ocean)", "Markdown", "Word (.docx)", "Text", "HTML", "Notion export (.zip)"];

/** Import notes: formats, drop zone, destination, then progress and a summary. */
export function ImportDialog({ state, workspaces, activeWorkspaceId, pages, onStart, onOpen, onClose }: {
  state: ImportState;
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  pages: PageMeta[];
  onStart: (files: InFile[], dest: ImportDest) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<InFile[]>([]);
  const [over, setOver] = useState(false);
  const [ws, setWs] = useState(activeWorkspaceId);
  const [parent, setParent] = useState("");
  const add = (more: InFile[]) => setFiles((f) => [...f, ...more.filter((m) => !f.some((x) => x.name === m.name))]);
  const parents = pages.filter((p) => p.workspaceId === ws).sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled"));
  const sel = "h-8 w-full cursor-pointer rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-200 outline-none focus:border-sky-500/60";
  const running = state.stage === "run";

  return (
    <Modal onClose={running ? undefined : onClose} className="oc-import w-[460px] p-5" label="Import notes">
      {state.stage === "pick" && <>
        <h2 className="text-[15px] font-semibold text-neutral-100">Import notes</h2>
        <p className="mt-1 text-[12.5px] text-neutral-400">{FORMATS.join(" · ")}</p>
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault(); setOver(false);
            add(await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
          }}
          className={`mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${over ? "border-sky-400/70 bg-sky-500/10" : "border-white/[0.14] bg-white/[0.02]"}`}
        >
          <FileUp className="size-6 text-neutral-400" />
          <p className="text-[13px] text-neutral-300">Drop files here, or</p>
          <ModalButton onClick={() => void pickImportFiles().then(add)}>Browse…</ModalButton>
        </div>
        {files.length > 0 && (
          <ul className="scrollbar-thin mt-3 max-h-32 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-1.5 text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-neutral-200">{f.name}</span>
                <button type="button" title="Remove" onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="grid size-5 cursor-pointer place-items-center rounded text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-200"><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-neutral-400">Workspace
            <select value={ws} onChange={(e) => (setWs(e.target.value), setParent(""))} className={sel}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.icon} {w.name}{w.id === activeWorkspaceId ? " (current)" : ""}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-neutral-400">Put inside
            <select value={parent} onChange={(e) => setParent(e.target.value)} className={sel}>
              <option value="">Top level</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.title || "Untitled"}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" disabled={!files.length} onClick={() => onStart(files, { workspaceId: ws, parentId: parent || null })}>
            Import{files.length ? ` ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
          </ModalButton>
        </div>
      </>}

      {state.stage === "run" && <>
        <h2 className="text-[15px] font-semibold text-neutral-100">Importing…</h2>
        <p className="mt-1 truncate text-[12.5px] text-neutral-400">{state.label}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-[color:var(--oc-brand)] transition-[width] duration-200" style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 5}%` }} />
        </div>
        <p className="mt-2 text-right text-[11.5px] text-neutral-500">{state.done} / {state.total}</p>
      </>}

      {state.stage === "done" && <>
        <h2 className="text-[15px] font-semibold text-neutral-100">
          {state.created.length ? `Imported ${state.created.length} page${state.created.length === 1 ? "" : "s"}` : "Nothing was imported"}
        </h2>
        {state.created.length > 0 && (
          <ul className="scrollbar-thin mt-3 max-h-48 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {state.created.map((p) => (
              <li key={p.id} className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-1.5 text-[13px] last:border-b-0">
                <Check className="size-3.5 shrink-0 text-emerald-400" />
                <span className="w-5 shrink-0 text-center">{p.icon}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-200">{p.title || "Untitled"}</span>
                <button type="button" onClick={() => (onOpen(p.id), onClose())} className="cursor-pointer rounded px-2 py-0.5 text-[12px] text-neutral-300 hover:bg-white/[0.08] hover:text-neutral-100">Open</button>
              </li>
            ))}
          </ul>
        )}
        {state.failed.length > 0 && <>
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-amber-300"><AlertTriangle className="size-3.5" />Couldn't import {state.failed.length}:</p>
          <ul className="scrollbar-thin mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {state.failed.map((f, i) => (
              <li key={i} className="flex gap-2 border-b border-white/[0.04] px-3 py-1.5 text-[13px] last:border-b-0">
                <span className="min-w-0 truncate font-medium text-neutral-200">{f.name}</span>
                <span className="ml-auto shrink-0 text-neutral-500">{f.reason}</span>
              </li>
            ))}
          </ul>
        </>}
        <div className="mt-5 flex justify-end">
          <ModalButton variant="primary" onClick={onClose}>Done</ModalButton>
        </div>
      </>}
    </Modal>
  );
}
