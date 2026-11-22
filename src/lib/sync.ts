/** LAN sync 7a pairing + 7b metadata sync. Rust side: src-tauri/src/sync.rs. */
import { invoke } from "@tauri-apps/api/core";

export type SyncPeer = { id: string; name: string; addr: string };
export type SyncInfo = {
  id: string;
  name: string;
  ip: string | null;
  port: number;
  peers: SyncPeer[];
  pairing: { code: string; secondsLeft: number } | null;
  listenError: string | null;
  /** Changes not yet sent to every paired device. */
  pending: number;
  log: SyncLogEntry[];
};
export type SyncLogEntry = { at: number; peer: string; added: number; edited: number; deleted: number; error: string | null };
export type SyncResult = { added: number; edited: number; deleted: number };

/** "3 added, 1 edited" or "Up to date". */
export const syncSummary = (r: SyncResult) =>
  [r.added && `${r.added} added`, r.edited && `${r.edited} edited`, r.deleted && `${r.deleted} deleted`].filter(Boolean).join(", ") || "Up to date";

/** "just now", "5 min ago", or a date. */
export const syncAgo = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : new Date(at).toLocaleString();
};
export type FoundLaptop = { name: string; addr: string };

const msg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.");
const call = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(msg(e));
  }
};

export const sync = {
  info: () => call<SyncInfo>("sync_info"),
  pairStart: () => call<string>("sync_pair_start"),
  pairCancel: () => call<void>("sync_pair_cancel"),
  discover: () => call<FoundLaptop[]>("sync_discover"),
  pairJoin: (addr: string, code: string) => call<string>("sync_pair_join", { addr, code }),
  test: (id: string) => call<string>("sync_test", { id }),
  now: (id: string) => call<SyncResult>("sync_now", { id }),
  unpair: (id: string) => call<void>("sync_unpair", { id }),
};
