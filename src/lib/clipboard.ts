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
