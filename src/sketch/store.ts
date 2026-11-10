import { writeDoc } from "../docs/store";
import { useSyncExternalStore } from "react";
import { readFileBytes } from "../lib/fileIO";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../data/api";
import type { DocFile } from "../docs/store";

/** Oceanic Sketch: real PNG/JPG files in a folder (Documents\Oceanic Sketch by default). */
export type SketchLayout = "paint" | "photoshop";
type State = { folder: string | null; files: DocFile[]; recent: string[]; layout: SketchLayout };

let state: State = { folder: null, files: [], recent: [], layout: "paint" };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useSketch = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

/* Like Paint: a new canvas lives in memory until its first save picks a file. */
type Untitled = { name: string; w: number; h: number; dirty?: boolean };
const untitled = new Map<string, Untitled>();
let untitledN = 0;
export const isUnsavedSketch = (path: string) => path.startsWith("new:");
export const untitledSketch = (path: string) => untitled.get(path);
export function newSketch(w: number, h: number) {
  const id = `new:${Date.now().toString(36)}`;
  untitled.set(id, { name: `Untitled${++untitledN === 1 ? "" : ` ${untitledN}`}`, w, h });
  return id;
}
export const markSketchDirty = (path: string) => {
  const u = untitled.get(path);
  if (u) u.dirty = true;
};
export const isDirtySketch = (path: string) => !!untitled.get(path)?.dirty;
export const forgetSketch = (path: string) => untitled.delete(path);

export const sketchTitle = (path: string) =>
  isUnsavedSketch(path) ? (untitled.get(path)?.name ?? "Untitled") : path.split(/[\\/]/).pop()!.replace(/\.(png|jpe?g)$/i, "");

export function loadSketchSettings(stored: Record<string, string>) {
  set({
    folder: stored.sketchFolder || null,
    recent: JSON.parse(stored.recentSketches ?? "[]"),
    layout: stored.sketchLayout === "photoshop" ? "photoshop" : "paint",
  });
  void refreshSketches();
}

export async function refreshSketches() {
  if (!isTauri()) return;
  if (!state.folder) {
    try {
      const dir = await invoke<string>("sketch_default_dir");
      set({ folder: dir });
      api.setSetting("sketchFolder", dir).catch(() => {});
    } catch {
      return;
    }
  }
  try {
    set({ files: await invoke<DocFile[]>("sketch_list", { dir: state.folder }) });
  } catch {
    set({ files: [] });
  }
}

/** Drop an image from the recents list (file untouched). */
export function forgetRecentSketch(path: string) {
  const recent = state.recent.filter((p) => p !== path);
  set({ recent });
  api.setSetting("recentSketches", JSON.stringify(recent)).catch(() => {});
}
/** Folder images go to the Recycle Bin. */
export async function trashSketch(path: string) {
  await invoke("docs_trash", { path });
  forgetRecentSketch(path);
  await refreshSketches();
}
export const revealSketch = (path: string) => invoke("docs_reveal", { path });

export async function pickSketchFolder() {
  const dir = await open({ directory: true, title: "Choose your Oceanic Sketch folder" });
  if (typeof dir !== "string") return;
  set({ folder: dir });
  api.setSetting("sketchFolder", dir).catch(() => {});
  await refreshSketches();
}

export async function pickImage(): Promise<string | null> {
  const f = await open({ title: "Open an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }] });
  return typeof f === "string" ? f : null;
}

export async function pickSketchSavePath(name: string): Promise<string | null> {
  const p = await save({
    title: "Save image",
    defaultPath: state.folder ? `${state.folder}\\${name}.png` : `${name}.png`,
    filters: [
      { name: "PNG image", extensions: ["png"] },
      { name: "JPEG image", extensions: ["jpg", "jpeg"] },
    ],
  });
  return p ? (/\.(png|jpe?g)$/i.test(p) ? p : p + ".png") : null;
}

export function touchRecentSketch(path: string) {
  const recent = [path, ...state.recent.filter((p) => p !== path)].slice(0, 20);
  set({ recent });
  api.setSetting("recentSketches", JSON.stringify(recent)).catch(() => {});
}

export function setSketchLayout(layout: SketchLayout) {
  set({ layout });
  api.setSetting("sketchLayout", layout).catch(() => {});
}

export const readImageFile = readFileBytes;
export const writeImageFile = writeDoc;
