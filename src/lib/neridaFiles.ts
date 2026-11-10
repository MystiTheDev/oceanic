import mammoth from "mammoth";
import { pageText, pdfjs } from "../pdf/pdfjs";

/* Attachments for Nerida: turn a dropped/picked file into plain text the model
 * can read. Backend only for now; the composer's attach button is not wired yet. */

export type Attachment = { name: string; text: string; truncated: boolean };

export const ATTACH_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm";
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
export const attachmentsContext = (files: Attachment[]) =>
  files.map((f) => `### File: ${f.name}${f.truncated ? " (truncated)" : ""}\n${f.text}`).join("\n\n");
