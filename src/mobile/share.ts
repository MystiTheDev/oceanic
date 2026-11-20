/** Android bridge (SharePlugin.kt): share sheet for export, files opened from other apps. */
import { addPluginListener, invoke } from "@tauri-apps/api/core";

type Picked = { name: string; data: string };
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const toFile = ({ name, data }: Picked) =>
  new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], /\.(ocean|omap)$/i.test(name) ? name : `${name}.ocean`);

export const shareFile = (name: string, bytes: Uint8Array) => invoke("plugin:share|share", { name, data: toB64(bytes) });

/** Calls `open` for the file Oceanic was launched with, and for each one opened later. */
export function onOpenedFile(open: (f: File) => void) {
  void invoke<{ file: Picked | null }>("plugin:share|pending").then((r) => r.file && open(toFile(r.file))).catch(() => {});
  void addPluginListener<Picked>("share", "file", (p) => open(toFile(p))).catch(() => {});
}
