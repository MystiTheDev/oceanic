/* ---------------------------------------------------------------------------
 * Doc / sketch embed: a read-only live preview of a file inside a note. The
 * file stays the source of truth; a missing file can be relinked or removed.
 * ------------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ExternalLink } from "lucide-react";
import { readFileBytes } from "../lib/fileIO";
import { FILE_SAVED, OPEN_EMBED_FILE } from "../lib/embedSource";

type Line = { heading: boolean; text: string };
type Preview = { kind: "image"; url: string } | { kind: "text"; lines: Line[] } | { kind: "missing" };

const MAX_LINES = 40;

/** Text of an editor JSON node. */
const textOf = (n: { text?: string; content?: unknown[] }): string =>
  n.text ?? (n.content ?? []).map((c) => textOf(c as never)).join("");

/** Doc content (editor JSON or HTML) reduced to its first lines of text. */
function docLines(content: unknown): Line[] {
  if (typeof content === "string") {
    const body = new DOMParser().parseFromString(content, "text/html").body;
    return [...body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li")]
      .map((el) => ({ heading: /^H\d$/.test(el.tagName), text: el.textContent ?? "" }))
      .slice(0, MAX_LINES);
  }
  const blocks = (content as { content?: { type: string }[] }).content ?? [];
  return blocks.slice(0, MAX_LINES).map((b) => ({ heading: b.type === "heading", text: textOf(b as never) }));
}

async function loadPreview(kind: string, path: string): Promise<Preview> {
  const bytes = await readFileBytes(path);
  if (kind === "sketch") {
    const type = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
    return { kind: "image", url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })) };
  }
  const { importDocx } = await import("../docs/docxIO");
  return { kind: "text", lines: docLines((await importDocx(bytes)).content) };
}

export const FileEmbed = createReactBlockSpec(
  {
    type: "fileEmbed",
    propSchema: { kind: { default: "doc" }, path: { default: "" }, name: { default: "" } },
    content: "none",
  },
  {
    render: function FileEmbedView({ block, editor }) {
      const { kind, path, name } = block.props;
      const [preview, setPreview] = useState<Preview | null>(null);

      useEffect(() => {
        let alive = true;
        let url = "";
        const load = () =>
          loadPreview(kind, path)
            .catch((): Preview => ({ kind: "missing" }))
            .then((p) => {
              if (url) URL.revokeObjectURL(url);
              url = p.kind === "image" ? p.url : "";
              if (alive) setPreview(p);
              else if (url) URL.revokeObjectURL(url);
            });
        void load();
        const onSaved = (e: Event) => (e as CustomEvent<string>).detail === path && void load();
        const onFocus = () => void load();
        window.addEventListener(FILE_SAVED, onSaved);
        window.addEventListener("focus", onFocus);
        return () => {
          alive = false;
          if (url) URL.revokeObjectURL(url);
          window.removeEventListener(FILE_SAVED, onSaved);
          window.removeEventListener("focus", onFocus);
        };
      }, [kind, path]);

      const open = () => window.dispatchEvent(new CustomEvent(OPEN_EMBED_FILE, { detail: { kind, path } }));
      const relink = async () => {
        const pick = kind === "sketch" ? (await import("../sketch/store")).pickImage : (await import("../docs/store")).pickDocx;
        const next = await pick();
        if (next) {
          const file = next.split(/[\\/]/).pop()!.replace(/\.(docx|png|jpe?g)$/i, "");
          editor.updateBlock(block, { props: { path: next, name: file } } as never);
        }
      };
      const missing = preview?.kind === "missing";
      const icon = kind === "sketch" ? "🎨" : "📄";

      return (
        <div className="oc-mm-embed" contentEditable={false}>
          <div className="oc-mm-embed-head">
            <span className="oc-mm-embed-title">{icon} {name || "Untitled"}</span>
            {missing ? (
              <span className="flex gap-1.5">
                <button type="button" onClick={() => void relink()}>Relink</button>
                <button type="button" onClick={() => editor.removeBlocks([block])}>Remove</button>
              </span>
            ) : (
              <button type="button" onClick={open}><ExternalLink size={13} /> Open</button>
            )}
          </div>
          {missing ? (
            <p className="oc-mm-embed-hint px-3 py-3">This file was moved or deleted.</p>
          ) : (
            <div className="oc-mm-embed-canvas oc-file-embed" onDoubleClick={open}>
              {preview?.kind === "image" && <img src={preview.url} alt={name} draggable={false} />}
              {preview?.kind === "text" && preview.lines.map((l, i) => (l.heading ? <h4 key={i}>{l.text}</h4> : <p key={i}>{l.text || " "}</p>))}
            </div>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => <p>{block.props.kind === "sketch" ? "🎨" : "📄"} {block.props.name}</p>,
  },
);
