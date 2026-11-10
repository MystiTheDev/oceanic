/* ---------------------------------------------------------------------------
 * Shared plumbing for embedding docs and sketches into notes.
 * ------------------------------------------------------------------------ */

export type FileEmbedKind = "doc" | "sketch";

/** A doc or sketch file was written; open embeds of that path refresh. */
export const FILE_SAVED = "oceanic:file-saved";
/** An embed's Open button: detail is `{ kind, path }`. */
export const OPEN_EMBED_FILE = "oceanic:open-embed-file";

export const notifyFileSaved = (path: string) => window.dispatchEvent(new CustomEvent(FILE_SAVED, { detail: path }));

/** Saves the open editor; resolves to its file path, or null if cancelled or failed. */
type Saver = () => Promise<string | null>;
let saver: Saver | null = null;
export const registerSaver = (fn: Saver | null) => {
  saver = fn;
};
export const saveOpenEditor = () => (saver ? saver() : Promise.resolve(null));
