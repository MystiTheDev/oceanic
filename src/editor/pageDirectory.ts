/* ---------------------------------------------------------------------------
 * A tiny shared store so editor-rendered chips (page links) can show live
 * page titles/icons and navigate, without threading props through BlockNote.
 * App keeps it in sync; chips subscribe with usePageDirectory().
 * ------------------------------------------------------------------------ */
import { useSyncExternalStore } from "react";
import type { PageMeta } from "../data/workspace";

type Directory = {
  pages: Map<string, PageMeta>;
  /** Navigate the current tab (or open a new one with `newTab`). */
  open: (pageId: string, newTab: boolean) => void;
};

let state: Directory = { pages: new Map(), open: () => {} };
const listeners = new Set<() => void>();

export const pageDirectory = {
  set(pages: PageMeta[], open: Directory["open"]) {
    state = { pages: new Map(pages.map((p) => [p.id, p])), open };
    listeners.forEach((l) => l());
  },
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const usePageDirectory = () =>
  useSyncExternalStore(pageDirectory.subscribe, pageDirectory.get, pageDirectory.get);
