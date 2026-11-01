import type { PartialBlock } from "@blocknote/core";
import type { PageStatus } from "./api";

/* ---------------------------------------------------------------------------
 * Page metadata — flat list, hierarchy expressed through `parentId`.
 * ------------------------------------------------------------------------ */
export type PageMeta = {
  id: string;
  icon: string;
  title: string;
  pinned: boolean;
  parentId: string | null;
  /** Set when the page itself was moved to Trash; its sub-pages go with it. */
  trashedAt?: number;
  /** ISO timestamp of the last save. */
  updatedAt?: string;
  createdAt?: string;
  workspaceId: string;
  /** `YYYY-MM-DD`; puts the page on the calendar. */
  dueDate?: string | null;
  status?: PageStatus | null;
  tags?: string[];
};

export type PageNode = {
  page: PageMeta;
  children: PageNode[];
};

/* ---------------------------------------------------------------------------
 * Tree helpers
 * ------------------------------------------------------------------------ */
export function buildPageTree(pages: PageMeta[]): PageNode[] {
  const groups = new Map<string | null, PageMeta[]>();
  for (const page of pages) {
    const siblings = groups.get(page.parentId) ?? [];
    siblings.push(page);
    groups.set(page.parentId, siblings);
  }

  const build = (parentId: string | null): PageNode[] =>
    (groups.get(parentId) ?? []).map((page) => ({
      page,
      children: build(page.id),
    }));

  return build(null);
}

/** `id` plus every page nested under it. */
export function subtreeIds(pages: PageMeta[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** True when the page, or any ancestor, sits in Trash. */
export function isInTrash(pages: PageMeta[], page: PageMeta): boolean {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (let p: PageMeta | undefined = page; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    if (p.trashedAt) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * Seed documents — shown for pages whose stored content is still NULL
 * (the starter page until its first edit, and brand-new pages).
 * ------------------------------------------------------------------------ */
const welcomeDoc: PartialBlock[] = [
  {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Welcome to Oceanic — a calm, bleeding-edge workspace for your thoughts. ",
        styles: {},
      },
      {
        type: "text",
        text: "This page is fully editable.",
        styles: { bold: true },
      },
    ],
  },
  { type: "paragraph" },
  { type: "heading", props: { level: 1 }, content: "Getting around" },
  {
    type: "bulletListItem",
    content: "Press Ctrl + K anywhere for quick search.",
  },
  {
    type: "bulletListItem",
    content: "Open pages side by side with the browser-style tab bar.",
  },
  {
    type: "bulletListItem",
    content: "Pin the pages you live in so they surface under Favorites.",
  },
  { type: "paragraph" },
  { type: "heading", props: { level: 1 }, content: "Why Oceanic?" },
  { type: "quote", content: "Deep work deserves deep water." },
  {
    type: "checkListItem",
    props: { checked: true },
    content: "Collapsible sidebar",
  },
  { type: "checkListItem", content: "Tabs, canvas and a lovely dark theme" },
  { type: "divider" },
  {
    type: "paragraph",
    content: "Start typing “/” to insert blocks. Try it down here ↓",
  },
];

const seedDocs: Record<string, PartialBlock[]> = {
  welcome: welcomeDoc,
};

/** New pages start empty, as in Notion. */
const genericDoc: PartialBlock[] = [{ type: "paragraph" }];

export function getSeedBlocks(id: string): PartialBlock[] {
  return seedDocs[id] ?? genericDoc;
}
