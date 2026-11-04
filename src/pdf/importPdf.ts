/* ---------------------------------------------------------------------------
 * Getting PDFs into notes: the file picker, dropped/pasted files, and the
 * event that opens the reader at a page.
 * ------------------------------------------------------------------------ */
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type PdfDocRecord } from "../data/api";
import { finishImport, toBase64 } from "./pdfjs";

export const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** A dropped or pasted file: the webview only has its bytes. */
export async function importPdfFile(file: File): Promise<PdfDocRecord> {
  const doc = await api.importPdfBytes(file.name, toBase64(new Uint8Array(await file.arrayBuffer())));
  void finishImport(doc).catch(() => {});
  return doc;
}

/** Native picker → copy into Oceanic's assets folder. */
export async function pickPdf(): Promise<PdfDocRecord | null> {
  if (!isTauri()) {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf,.pdf" });
    const file = await new Promise<File | undefined>((r) => {
      input.onchange = () => r(input.files?.[0]);
      input.click();
    });
    return file ? importPdfFile(file) : null;
  }
  const path = await open({ title: "Add PDF", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (typeof path !== "string") return null;
  const doc = await api.importPdf(path);
  void finishImport(doc).catch(() => {});
  return doc;
}

/* ------------------------------------------------------------ open reader */
export const OPEN_PDF = "oceanic:open-pdf";
export type PdfTarget = { docId: string; page?: number; annotationId?: string };

/** Where a reader should jump when it opens (or, if already open, right away). */
export const pendingJump = new Map<string, PdfTarget>();

export function openPdfReader(target: PdfTarget) {
  if (target.page || target.annotationId) pendingJump.set(target.docId, target);
  window.dispatchEvent(new CustomEvent<PdfTarget>(OPEN_PDF, { detail: target }));
}
