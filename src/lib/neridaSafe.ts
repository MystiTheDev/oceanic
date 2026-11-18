/* Nerida's replies can be steered by text it read (a PDF, a web result, an
 * imported note). Before a reply goes into a note or doc, anything that would
 * make the app contact a server is defused: images are dropped and links,
 * bare URLs and raw HTML become plain text. Maths ($…$) and formatting stay. */

const URL_RE = /\b(?:https?|ftp|file|mailto|javascript|data):[^\s<>`)\]]*|\bwww\.[^\s<>`)\]]+/gi;

/** Markdown safe to insert: no images, no clickable links, no HTML tags. */
export function neridaSafeMarkdown(md: string): string {
  // Code spans and blocks are left alone: they never render as links or images.
  const parts = md.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2) return part;
      return (
        part
          // Reference definitions: [id]: https://…
          .replace(/^\s{0,3}\[[^\]\n]+\]:\s*\S+.*$/gm, "")
          // Images: ![alt](url) / ![alt][ref] → nothing (the alt text is kept when it says something).
          .replace(/!\[([^\]\n]*)\]\s*(?:\([^)\n]*\)|\[[^\]\n]*\])/g, (_, alt: string) => (alt.trim() ? `(${alt.trim()})` : ""))
          // Links: [text](url) → text (url); [text][ref] → text. The URL is defused below.
          .replace(/\[([^\]\n]+)\]\s*\(\s*<?([^)\s>]*)>?[^)\n]*\)/g, (_, text: string, url: string) => (url ? `${text} (${url})` : text))
          .replace(/\[([^\]\n]+)\]\s*\[[^\]\n]*\]/g, "$1")
          // Autolinks <https://…> and any HTML tag (<img>, <a>, <iframe>…).
          .replace(/<((?:https?|mailto|ftp):[^>\s]+)>/gi, "$1")
          .replace(/<\/?[a-z][^>]*>/gi, "")
          // Bare URLs: code spans show them without becoming links.
          .replace(URL_RE, (u) => "`" + u.replace(/`/g, "") + "`")
      );
    })
    .join("");
}
