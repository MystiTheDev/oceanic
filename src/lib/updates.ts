import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../data/api";

/** App updates: check, toast, download with progress, restart, then "What's new" once. */
export type UpdatePhase = "idle" | "checking" | "uptodate" | "available" | "downloading" | "installing" | "restarting" | "error";
type State = {
  phase: UpdatePhase;
  version: string;
  notes: string;
  progress: number; // 0..1
  toast: boolean;
  modal: boolean;
  error: string;
  /** Plain-words reason for the error (the raw text stays in `error`). */
  errorText: string;
  /** Which step failed, so Retry repeats the right one. */
  errorKind: "check" | "install";
  /** Shown once after an update installed. */
  whatsNew: { version: string; notes: string } | null;
};
let state: State = { phase: "idle", version: "", notes: "", progress: 0, toast: false, modal: false, error: "", errorText: "", errorKind: "check", whatsNew: null };
export const RELEASES_URL = "https://github.com/MystiTheDev/oceanic/releases";
/** A check that hasn't answered by then counts as failed (it used to hang on "Checking…" forever). */
const CHECK_TIMEOUT = 15_000;
/** Bumped per check: a late answer from a timed-out check is ignored. */
let checkId = 0;
const friendly = (e: string) =>
  /timed? ?out|timeout/i.test(e)
    ? "The update server didn't answer in time."
    : /network|connect|dns|resolve|offline|unreachable|request/i.test(e)
      ? "Couldn't reach the update server. Check your internet connection."
      : /signature|pubkey/i.test(e)
        ? "The update's signature couldn't be verified."
        : "Something went wrong while checking.";
let update: Update | null = null;
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => ((state = { ...state, ...p }), listeners.forEach((l) => l()));
export const useUpdates = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
export const openUpdateModal = () => set({ modal: true, toast: false });
export const closeUpdateModal = () => set({ modal: false });
export const dismissToast = () => set({ toast: false });
export const closeWhatsNew = () => set({ whatsNew: null });

/** `manual`: user asked (show "up to date" / errors and open the modal directly). Background checks stay silent. */
export async function checkForUpdates(manual = false) {
  if (!isTauri() || ["downloading", "installing", "restarting"].includes(state.phase)) return;
  // A check is already running: bring its popup back instead of doing nothing.
  if (state.phase === "checking") return void (manual && set({ modal: true }));
  const id = ++checkId;
  set({ phase: "checking", error: "", errorText: "", modal: manual ? true : state.modal });
  let timer = 0;
  try {
    const found = await Promise.race([
      check({ timeout: CHECK_TIMEOUT }),
      new Promise<never>((_, fail) => (timer = window.setTimeout(() => fail(new Error("Update check timed out")), CHECK_TIMEOUT + 1000))),
    ]);
    if (id !== checkId) return;
    update = found;
    if (!update) return set({ phase: "uptodate" });
    set({ phase: "available", version: update.version, notes: update.body ?? "", toast: !manual, modal: manual });
  } catch (e) {
    if (id !== checkId) return;
    const error = String(e);
    // Shown when the user asked, or if they reopened the popup while it ran.
    set(manual || state.modal ? { phase: "error", error, errorText: friendly(error), errorKind: "check" } : { phase: "idle" });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function installUpdate() {
  if (!update) return;
  set({ phase: "downloading", progress: 0 });
  let total = 0;
  let got = 0;
  try {
    // Remember the notes so the new version can say "What's new" once.
    await api.setSetting("pendingWhatsNew", JSON.stringify({ version: update.version, notes: update.body ?? "" }));
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") (got += ev.data.chunkLength), set({ progress: total ? got / total : Math.min(0.95, state.progress + 0.01) });
      else if (ev.event === "Finished") set({ phase: "installing", progress: 1 });
    });
    set({ phase: "restarting" });
    await relaunch();
  } catch (e) {
    set({ phase: "error", error: String(e), errorText: "The update couldn't be downloaded or installed.", errorKind: "install" });
  }
}

/** Retry whatever failed last. */
export const retryUpdate = () => (state.errorKind === "install" && update ? installUpdate() : checkForUpdates(true));

/** On startup: show "What's new" if we just updated; then check now and every 4 hours. */
export async function startUpdates(stored: Record<string, string>) {
  if (!isTauri()) return;
  try {
    const pending = stored.pendingWhatsNew ? (JSON.parse(stored.pendingWhatsNew) as { version: string; notes: string }) : null;
    if (pending && pending.version === (await getVersion())) set({ whatsNew: pending });
    if (pending) api.setSetting("pendingWhatsNew", "").catch(() => {});
  } catch {}
  window.setTimeout(() => void checkForUpdates(), 8000);
  window.setInterval(() => void checkForUpdates(), 4 * 60 * 60 * 1000);
}

/** Dev only: preview the update UI without a real release (window.__ocUpdateDemo()). */
if (import.meta.env.DEV) {
  const notes = "- Student dashboard with a free widget grid\n- Oceanic Sketch: layers and shapes\n- Docs: pages, borders and Word shortcuts\n- Remembers your window size";
  (window as unknown as Record<string, unknown>).__ocUpdateDemo = (step: "toast" | "modal" | "progress" | "whatsnew" = "toast") => {
    if (step === "whatsnew") return set({ whatsNew: { version: "1.1.0", notes } });
    set({ phase: "available", version: "1.1.0", notes, toast: step === "toast", modal: step !== "toast" });
    if (step === "progress") {
      set({ phase: "downloading", progress: 0 });
      const t = window.setInterval(() => {
        if (state.progress >= 1) return window.clearInterval(t), set({ phase: "installing" });
        set({ progress: Math.min(1, state.progress + 0.04) });
      }, 120);
    }
  };
}
