/* ---------------------------------------------------------------------------
 * PDF file bytes. In the app they live in the assets folder (read through
 * `docs_read`); in the browser preview, localStorage is far too small, so
 * they go to IndexedDB under the doc id (`assetPath` = "idb:<id>").
 * ------------------------------------------------------------------------ */
import { isTauri } from "@tauri-apps/api/core";
import { readFileBytes } from "../lib/fileIO";

export const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("oceanic-pdf", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putPdfBytes(id: string, base64: string): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("files", "readwrite");
    t.objectStore("files").put(base64, id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deletePdfBytes(id: string): Promise<void> {
  const db = await idb();
  db.transaction("files", "readwrite").objectStore("files").delete(id);
}

/** The original file, as stored when it was imported. */
export async function getPdfBytes(assetPath: string): Promise<Uint8Array> {
  if (!assetPath.startsWith("idb:")) {
    if (!isTauri()) throw new Error("This PDF lives in the desktop app's storage");
    return readFileBytes(assetPath);
  }
  const db = await idb();
  const b64 = await new Promise<string | undefined>((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").get(assetPath.slice(4));
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!b64) throw new Error("The PDF file is missing");
  return fromBase64(b64);
}
