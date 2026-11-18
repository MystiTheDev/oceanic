import { invoke } from "@tauri-apps/api/core";

/* Native Open / Save dialogs run from Rust. Whatever the user picks is added
 * to the file scope there, so the file commands accept it; paths the page
 * makes up on its own are refused. Same shape as @tauri-apps/plugin-dialog. */

type Filter = { name: string; extensions: string[] };
type OpenOptions = { title?: string; filters?: Filter[]; directory?: boolean; multiple?: boolean; defaultPath?: string; /** "storage": the folder is only good for one database move. */ purpose?: "storage" };
type SaveOptions = { title?: string; filters?: Filter[]; defaultPath?: string };

export const open = (options: OpenOptions = {}) => invoke<string | string[] | null>("pick_open", { options });

/** The first filter's first extension is added when the typed name has none of the filter extensions. */
export const save = (options: SaveOptions = {}) =>
  invoke<string | null>("pick_save", { options, ensureExt: options.filters?.[0]?.extensions[0] ?? null });
