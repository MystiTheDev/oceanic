import mammoth from "mammoth";
import { pageText, pdfjs } from "../pdf/pdfjs";
import { relevantPassages, type SourceBook } from "./neridaGuard";

/* Attachments for Nerida: turn a dropped/picked file into plain text the model
 * can read. Backend only for now; the composer's attach button is not wired yet. */

/** `thumb`: a small preview when the attachment is a picture (its text is Nerida's reading of it). */
export type Attachment = { name: string; text: string; truncated: boolean; thumb?: string };
export const isImageFile = (f: File) => f.type.startsWith("image/");
export const MAX_IMAGES = 4;

export const ATTACH_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,.bmp";
const MAX_CHARS = 40_000; // keeps one file from swamping a small model's context

export async function extractFileText(file: File): Promise<Attachment> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  let text: string;
  if (ext === "pdf") {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages && pages.join("").length < MAX_CHARS; i++) pages.push(await pageText(await pdf.getPage(i)));
    await pdf.destroy();
    text = pages.join("\n\n");
  } else if (ext === "docx") {
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (ext === "html" || ext === "htm") {
    text = new DOMParser().parseFromString(await file.text(), "text/html").body.innerText;
  } else if (ATTACH_ACCEPT.includes(`.${ext}`)) {
    text = await file.text();
  } else {
    throw new Error(`${file.name}: this file type isn't supported yet.`);
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`${file.name} has no readable text (scanned PDFs aren't supported yet).`);
  return { name: file.name, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
}

/** Prompt section for attachments, appended to the notes context. */
export const attachmentsContext = (files: Attachment[], book?: SourceBook, question = "") =>
  book
    ? files.map((f) => book.add("file", `${f.thumb ? "Picture" : "File"} "${f.name}"${f.truncated ? " (truncated)" : ""}`, relevantPassages(f.text, question, 8000))).filter(Boolean).join("\n\n")
    : files.map((f) => `### ${f.thumb ? "Picture" : "File"}: ${f.name}${f.truncated ? " (truncated)" : ""}\n${f.text}`).join("\n\n");
