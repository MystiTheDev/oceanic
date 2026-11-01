/* ---------------------------------------------------------------------------
 * Backlink extraction: find every `pageLink` chip in a document and record
 * the text of the block around it. Links inside the snippet are kept as
 * `[[pageId]]` markers so the UI can show the linked page's current title.
 * ------------------------------------------------------------------------ */
import type { PartialBlock } from "@blocknote/core";
import type { PageLink } from "../data/api";

type Inline = { type?: string; text?: string; props?: Record<string, unknown>; content?: unknown };

const SNIPPET_MAX = 160;

function inlineText(content: unknown, found: Set<string>): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Inline[])
    .map((c) => {
      if (c.type === "pageLink") {
        const id = String(c.props?.pageId ?? "");
        if (id) found.add(id);
        return `[[${id}]]`;
      }
      if (c.type === "inlineMath") return `$${String(c.props?.latex ?? "")}$`;
      if (c.type === "link") return inlineText(c.content, found);
      return c.text ?? "";
    })
    .join("");
}

export function extractLinks(blocks: PartialBlock[]): PageLink[] {
  const links = new Map<string, string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list as { content?: unknown; children?: unknown }[]) {
      const found = new Set<string>();
      const text = inlineText(block.content, found).replace(/\s+/g, " ").trim();
      for (const id of found) {
        // First mention wins; keep the snippet centred-ish on the link.
        if (links.has(id)) continue;
        const at = Math.max(0, text.indexOf(`[[${id}]]`) - 60);
        const snippet = (at > 0 ? "…" : "") + text.slice(at, at + SNIPPET_MAX);
        links.set(id, snippet + (at + SNIPPET_MAX < text.length ? "…" : ""));
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return [...links].map(([targetId, snippet]) => ({ targetId, snippet }));
}
