import { invoke } from "@tauri-apps/api/core";

/** Read a file through `docs_read`, which returns base64 (raw number[] arrays
    serialize to ~4x-size JSON). Every caller must decode it, never cast it. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const bin = atob(await invoke<string>("docs_read", { path }));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
