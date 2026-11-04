/* ---------------------------------------------------------------------------
 * pdf.js setup and the shared helpers built on it: one open document per
 * doc id, readable error messages, thumbnails and text extraction.
 * ------------------------------------------------------------------------ */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { api, type PdfDocRecord } from "../data/api";
import { getPdfBytes, toBase64 } from "./bytes";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

const open = new Map<string, Promise<PDFDocumentProxy>>();

/** The parsed document for `doc`, opened once and shared by the card and the reader. */
export function openPdf(doc: Pick<PdfDocRecord, "id" | "assetPath">): Promise<PDFDocumentProxy> {
  let p = open.get(doc.id);
  if (!p) {
    // pdf.js transfers the buffer to its worker, so it gets its own copy.
    p = getPdfBytes(doc.assetPath).then((bytes) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise);
    p.catch(() => open.delete(doc.id));
    open.set(doc.id, p);
  }
  return p;
}

/** "Password-protected" / "damaged" instead of pdf.js's internal exception names. */
export function pdfErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "PasswordException") return "This PDF is password-protected. Remove the password and add it again.";
  if (name === "InvalidPDFException") return "This file is damaged or isn't a valid PDF.";
  if (name === "MissingPDFException") return "The PDF file is missing from Oceanic's storage.";
  return e instanceof Error ? e.message : "This PDF couldn't be opened.";
}

/** Stored path → URL an <img> can load (asset protocol in the app, data URL in the browser). */
export const imageSrc = (path: string) => (path.startsWith("data:") || !isTauri() ? path : convertFileSrc(path));

/** Render one page to a PNG data URL `width` CSS pixels wide (at device resolution). */
export async function renderPageImage(page: PDFPageProxy, width: number): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width / base.width) * Math.min(2, window.devicePixelRatio || 1) });
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}

/** A page's text in reading order; line breaks where pdf.js reports them. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    out += item.str + (item.hasEOL ? "\n" : "");
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

/* ------------------------------------------------- import post-processing */

export const PDF_CHANGED = "oceanic:pdf-changed";
export const PDF_PROGRESS = "oceanic:pdf-progress";
/** Text extraction progress by doc id: pages done / total. Gone when finished. */
export const extraction = new Map<string, { done: number; total: number }>();
/** In-flight imports, so a card that mounts mid-way shares the result (or the error). */
const running = new Map<string, Promise<void>>();

const changed = (id: string) => window.dispatchEvent(new CustomEvent(PDF_CHANGED, { detail: id }));

/**
 * After import (or for a doc whose import was interrupted): record the page
 * count, render the page-1 thumbnail, then extract every page's text in the
 * background so global search finds it. Progress shows on the card.
 */
export function finishImport(doc: PdfDocRecord): Promise<void> {
  let job = running.get(doc.id);
  if (!job) {
    job = runImport(doc).finally(() => running.delete(doc.id));
    running.set(doc.id, job);
  }
  return job;
}

async function runImport(doc: PdfDocRecord): Promise<void> {
  try {
    const pdf = await openPdf(doc);
    if (!doc.pageCount) await api.savePdfDocState(doc.id, pdf.numPages, doc.lastPage || 1, doc.zoom || "width");
    if (!doc.thumbPath) {
      const url = await renderPageImage(await pdf.getPage(1), 400);
      await api.savePdfThumb(doc.id, url.slice(url.indexOf(",") + 1));
    }
    changed(doc.id);
    if ((await api.getPdfText(doc.id)).length === pdf.numPages) return;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      pages.push(await pageText(await pdf.getPage(n)).catch(() => ""));
      extraction.set(doc.id, { done: n, total: pdf.numPages });
      window.dispatchEvent(new CustomEvent(PDF_PROGRESS, { detail: doc.id }));
    }
    await api.savePdfText(doc.id, pages);
  } finally {
    extraction.delete(doc.id);
    window.dispatchEvent(new CustomEvent(PDF_PROGRESS, { detail: doc.id }));
  }
}

export const notifyPdfChanged = changed;
export { toBase64 };
