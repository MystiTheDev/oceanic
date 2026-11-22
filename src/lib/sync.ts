/** LAN sync (phase 7a): pairing and an encrypted test connection. Rust side: src-tauri/src/sync.rs. */
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
  unpair: (id: string) => call<void>("sync_unpair", { id }),
};
