/** Android bridge (SharePlugin.kt): share sheet for export, files opened from other apps. */
import { invoke } from "@tauri-apps/api/core";

type Picked = { name: string; data: string };
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const call = <T>(cmd: string, args: object = {}) => invoke<T>("share_call", { cmd, args });
const toFile = ({ name, data }: Picked) =>
  new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], /\.(ocean|omap)$/i.test(name) ? name : `${name}.ocean`);

/** Android Files picker; null when cancelled. */
export const pickFile = () => call<{ file: Picked | null }>("pick").then((r) => (r.file ? toFile(r.file) : null));

export const shareFile = (name: string, bytes: Uint8Array) => call("share", { name, data: toB64(bytes) });

/** Calls `open` for the file Oceanic was launched with, and for each one opened later. */
export function onOpenedFile(open: (f: File) => void) {
  const check = () => void call<{ file: Picked | null }>("pending").then((r) => r.file && open(toFile(r.file))).catch(() => {});
  check();
  // A file opened while running arrives via onNewIntent; pick it up on resume.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}
