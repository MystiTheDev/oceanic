import { readFileBytes } from "../lib/fileIO";
import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../data/api";
import { notifyFileSaved } from "../lib/embedSource";

/** Oceanic Docs: real .docx files in a folder the user picks (plus any opened elsewhere). */
export type DocFile = { name: string; path: string; modified: number };
export type DocsUiStyle = "ribbon" | "docs" | "minimal";
type State = { folder: string | null; files: DocFile[]; recent: string[]; uiStyle: DocsUiStyle; copies?: Record<string, string> };

let state: State = { folder: null, files: [], recent: [], uiStyle: "ribbon" };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useDocs = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
export const docsState = () => state;

export const docTitle = (path: string) =>
  isUnsaved(path) ? (untitled.get(path)?.name ?? "Document") : path.split(/[\\/]/).pop()!.replace(/\.docx$/i, "");

/* Like Word: a new document lives in memory until its first save picks a file. */
type Untitled = { name: string; content: unknown };
const untitled = new Map<string, Untitled>();
let untitledN = 0;
export const isUnsaved = (path: string) => path.startsWith("new:");
export const untitledContent = (path: string) => untitled.get(path)?.content;
export function newUntitled(name?: string, content?: unknown) {
  const id = `new:${Date.now().toString(36)}`;
  untitled.set(id, { name: name ?? `Document${++untitledN}`, content: content ?? "<p></p>" });
  return id;
}
/** Latest content of an unsaved doc (kept so "Save changes?" can save it after the editor closes). */
export function setUntitledContent(path: string, content: unknown, page: unknown) {
  const u = untitled.get(path);
  if (u) Object.assign(u, { content, page, dirty: true });
}
export const isDirtyUntitled = (path: string) => !!(untitled.get(path) as { dirty?: boolean } | undefined)?.dirty;
export const untitledPage = (path: string) => (untitled.get(path) as { page?: unknown } | undefined)?.page;
export const forgetUntitled = (path: string) => untitled.delete(path);

/** Save As dialog (starts in the Docs folder when one is set). */
export async function pickSavePath(name: string): Promise<string | null> {
  const p = await save({
    title: "Save document",
    defaultPath: state.folder ? `${state.folder}\\${name}.docx` : `${name}.docx`,
    filters: [{ name: "Word document", extensions: ["docx"] }],
  });
  return p ? (/\.docx$/i.test(p) ? p : p + ".docx") : null;
}

export function loadDocsSettings(stored: Record<string, string>) {
  set({
    folder: stored.docsFolder || null,
    recent: JSON.parse(stored.recentDocs ?? "[]"),
    uiStyle: (stored.docsUiStyle as DocsUiStyle) || "ribbon",
    copies: JSON.parse(stored.docsCopies ?? "{}"),
  });
  void refreshFiles();
}

/** No folder chosen yet: use Documents\Oceanic Docs (created on first use). */
async function ensureDefaultFolder() {
  if (state.folder || !isTauri()) return;
  try {
    const dir = await invoke<string>("docs_default_dir");
    set({ folder: dir });
    api.setSetting("docsFolder", dir).catch(() => {});
  } catch {}
}

/** Working copies of Word files made elsewhere: copy path → original path (persisted). */
export const originalOf = (path: string): string | undefined => state.copies?.[path];
export async function makeWorkingCopy(original: string, bytes: Uint8Array): Promise<string | null> {
  await ensureDefaultFolder();
  if (!state.folder) return null;
  const target = await invoke<string>("docs_free_path", { dir: state.folder, name: docTitle(original) + " (Oceanic)" });
  await writeDoc(target, bytes);
  const copies = { ...(state.copies ?? {}), [target]: original };
  set({ copies });
  api.setSetting("docsCopies", JSON.stringify(copies)).catch(() => {});
  void refreshFiles();
  return target;
}

export const renameDoc = (path: string, name: string) => invoke<string>("docs_rename", { path, name });
export const trashDoc = (path: string) => invoke("docs_trash", { path });
export const duplicateDoc = (path: string) => invoke<string>("docs_duplicate", { path });
export const revealDoc = (path: string) => invoke("docs_reveal", { path });
/** After a rename/delete, keep the recent list pointing at real files. */
export function replaceRecent(from: string, to: string | null) {
  const recent = state.recent.flatMap((p) => (p === from ? (to ? [to] : []) : [p]));
  set({ recent });
  api.setSetting("recentDocs", JSON.stringify(recent)).catch(() => {});
}

export async function refreshFiles() {
  await ensureDefaultFolder();
  if (!state.folder || !isTauri()) return;
  try {
    set({ files: await invoke<DocFile[]>("docs_list", { dir: state.folder }) });
  } catch {
    set({ files: [] });
  }
}

export async function pickFolder() {
  const dir = await open({ directory: true, title: "Choose your Oceanic Docs folder" });
  if (typeof dir !== "string") return;
  set({ folder: dir });
  api.setSetting("docsFolder", dir).catch(() => {});
  await refreshFiles();
}

/** "Open…" any .docx; returns its path. */
export async function pickDocx(): Promise<string | null> {
  const file = await open({ title: "Open a Word document", filters: [{ name: "Word document", extensions: ["docx"] }] });
  return typeof file === "string" ? file : null;
}

export function touchRecent(path: string) {
  const recent = [path, ...state.recent.filter((p) => p !== path)].slice(0, 20);
  set({ recent });
  api.setSetting("recentDocs", JSON.stringify(recent)).catch(() => {});
}

export function setUiStyle(uiStyle: DocsUiStyle) {
  set({ uiStyle });
  api.setSetting("docsUiStyle", uiStyle).catch(() => {});
}

/** Binary IPC as base64 strings: raw number[] arrays serialize to ~4x-size
    JSON, which made big .docx files (lots of images) slow to open and save. */
export const readDoc = readFileBytes;

/** Binary IPC as base64 strings (see readDoc). */
export const writeDoc = (path: string, data: Uint8Array) => {
  // Chunks of 0x8000 keep String.fromCharCode inside the stack limit.
  let bin = "";
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000) as never);
  return invoke("docs_write", { path, data: btoa(bin) }).then(() => notifyFileSaved(path));
};

/** New file in the Docs folder (asks for the folder first if none). */
export async function newDocPath(name = "Untitled document"): Promise<string | null> {
  if (!state.folder) await pickFolder();
  if (!state.folder) return null;
  return invoke<string>("docs_free_path", { dir: state.folder, name });
}
