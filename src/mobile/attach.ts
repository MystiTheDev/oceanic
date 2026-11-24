/**
 * Phone attachments: take a photo, pick images, or pick any file, then turn them
 * into image / file blocks. Files are stored the same way as on the PC
 * (`uploadFile` copies them into the assets folder), so notes stay compatible.
 */
import { uploadFile } from "../editor/audio";

export type AttachKind = "photo" | "image" | "file";

/** Opens the system picker. Call it straight from a tap so Android allows it. */
export function pickFiles(kind: AttachKind): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (kind === "photo") {
      input.accept = "image/*";
      input.setAttribute("capture", "environment");
    } else if (kind === "image") {
      input.accept = "image/*";
      input.multiple = true;
    } else input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/** Image files become image blocks; everything else becomes a file block. */
export async function attachBlocks(files: File[]) {
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    const url = await uploadFile(f).catch(() => null);
    if (!url) continue;
    out.push(
      f.type.startsWith("image/")
        ? { type: "image", props: { url, name: f.name, previewWidth: 512 } }
        : { type: "file", props: { url, name: f.name } },
    );
  }
  return out;
}

/** Title for a note started from an attachment: "Photo 21 Nov", or the first file's name. */
export const titleFor = (kind: AttachKind, files: File[]) =>
  kind === "photo"
    ? `Photo ${new Date().toLocaleDateString([], { day: "numeric", month: "short" })}`
    : files[0]?.name.replace(/\.[^.]+$/, "") || "Untitled";
