/* ---------------------------------------------------------------------------
 * Clipboard for the custom context menu. Copy / Cut go through the browser's
 * own command (keeps rich formatting from the editor); Paste reads plain text
 * through Tauri's clipboard plugin in the desktop app, or the async Clipboard
 * API in a browser.
 * ------------------------------------------------------------------------ */
import { isTauri } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

export const copySelection = () => document.execCommand("copy");
export const cutSelection = () => document.execCommand("cut");

export async function readClipboardText(): Promise<string> {
  try {
    return isTauri() ? await readText() : await navigator.clipboard.readText();
  } catch (e) {
    console.error("Reading the clipboard failed", e);
    return "";
  }
}

/** Put a picture on the system clipboard as a real image (PNG), so it pastes into any app. */
export async function copyImageToClipboard(url: string) {
  const blob = await fetch(url).then((r) => r.blob());
  // The clipboard only takes PNG: re-encode anything else through a canvas.
  let png = blob;
  if (blob.type !== "image/png") {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    png = await new Promise<Blob>((r, f) => c.toBlob((b) => (b ? r(b) : f(new Error("encode failed"))), "image/png"));
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
