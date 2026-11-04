import { buildOceanFile } from "../lib/oceanFile";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PartialBlock } from "@blocknote/core";
import { FileCode2, FileDown, FileText, Loader2, Waves } from "lucide-react";
import { subtreeIds, type PageMeta } from "../data/workspace";
import { buildExport, exportFilename, pickSaveTarget, printPage, type ExportFormat, type PaperSize } from "../lib/export";

type ExportDialogProps = {
  page: PageMeta;
  pages: PageMeta[];
  loadBlocks: (pageId: string) => Promise<PartialBlock[]>;
  onDone: (message: string) => void;
  onClose: () => void;
};

type Format = ExportFormat | "pdf" | "ocean";
const FORMATS: { id: Format; label: string; hint: string; desc: string; gets: string[]; tone: string; icon: typeof FileText }[] = [
  { id: "ocean", label: "Oceanic file", hint: ".ocean", desc: "Re-open in Oceanic exactly as it is", gets: ["Subpages, images, PDFs, banners", "Only format that keeps dates, status & tags", "Double-click to open"], tone: "#2383e2", icon: Waves },
  { id: "markdown", label: "Markdown", hint: ".md", desc: "Plain text for any notes app", gets: ["Obsidian, Notion, GitHub", "Headings, lists, tables"], tone: "#a78bfa", icon: FileText },
  { id: "html", label: "Web page", hint: ".html", desc: "Opens in any browser", gets: ["Styled, readable page", "Easy to share or print"], tone: "#f59e0b", icon: FileCode2 },
  { id: "pdf", label: "PDF", hint: ".pdf", desc: "Print-ready document", gets: ["Title, date, page numbers", "A4 or Letter"], tone: "#ef4444", icon: FileDown },
];

const oceanName = (title: string) => `${(title || "Untitled").replace(/[\\/:*?"<>|]/g, "-")}.ocean`;

/** Images in Markdown/HTML: embedded as data (portable files) or left out. */
async function withImages(blocks: PartialBlock[], include: boolean): Promise<PartialBlock[]> {
  const toData = (url: string) =>
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); }))
      .catch(() => url);
  const walk = async (list: PartialBlock[]): Promise<PartialBlock[]> => {
    const out: PartialBlock[] = [];
    for (const b of list as (PartialBlock & { props?: Record<string, unknown>; children?: PartialBlock[] })[]) {
      if (b.type === "image") {
        if (!include) continue;
        const url = b.props?.url as string | undefined;
        if (url && !url.startsWith("data:")) {
          out.push({ ...b, props: { ...b.props, url: await toData(url) } } as PartialBlock);
          continue;
        }
      }
      out.push(b.children?.length ? ({ ...b, children: await walk(b.children) } as PartialBlock) : b);
    }
    return out;
  };
  return walk(blocks);
}

/** Export window: big format cards (Oceanic file first), options, and what you'll get. */
export function ExportDialog({ page, pages, loadBlocks, onDone, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<Format>("ocean");
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [includeSubpages, setIncludeSubpages] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [includeMeta, setIncludeMeta] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subpageCount = subtreeIds(pages, page.id).size - 1;
  const zipped = includeSubpages && subpageCount > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const showInFolder = (path: string) => reveal && isTauri() && void invoke("docs_reveal", { path }).catch(() => {});

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (format === "pdf") {
        await printPage(page, loadBlocks, paper);
        onClose();
        return;
      }
      if (format === "ocean") {
        const target = await pickSaveTarget(oceanName(page.title));
        if (!target) return;
        await target.write(await buildOceanFile(page.id, pages, loadBlocks, includeSubpages, includeMeta));
        showInFolder(target.label);
        onDone(`Exported to ${target.label}`);
        onClose();
        return;
      }
      // Ask where to save first (pickers need the click's fresh activation),
      // then render and write the file.
      const opts = { rootId: page.id, pages, format: format as ExportFormat, includeSubpages };
      const target = await pickSaveTarget(exportFilename(opts));
      if (!target) return; // cancelled: keep the dialog open
      const file = await buildExport({ ...opts, loadBlocks: async (id) => withImages(await loadBlocks(id), includeImages) });
      await target.write(file.data);
      showInFolder(target.label);
      onDone(`Exported to ${target.label}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const current = FORMATS.find((f) => f.id === format)!;
  return createPortal(
    <div className="oc-fade-in fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label="Export"
        onMouseDown={(e) => e.stopPropagation()}
        className="oc-pop-in w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/[0.08] bg-neutral-900 shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="grid size-10 place-items-center rounded-xl bg-white/[0.05] text-[22px]">{page.icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-neutral-100">Export</h2>
            <p className="truncate text-[12.5px] text-neutral-500">
              {page.title || "Untitled"}
              {subpageCount ? ` · ${subpageCount} subpage${subpageCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>

        <div className="p-5">
          {/* Format cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {FORMATS.map(({ id, label, hint, desc, gets, tone, icon: Icon }, i) => {
              const on = format === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormat(id)}
                  style={{ "--tone": tone, animationDelay: `${i * 50}ms` } as React.CSSProperties}
                  className={`oc-export-card relative flex cursor-pointer gap-3 rounded-xl border p-3.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${on ? "is-on" : "border-white/[0.08] hover:border-white/[0.16] hover:bg-white/[0.03]"}`}
                >
                  {id === "ocean" && <span className="absolute right-2.5 top-2.5 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-300">Recommended</span>}
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${tone} ${on ? 26 : 14}%, transparent)`, color: tone }}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-neutral-100">
                      {label} <span className="text-[11.5px] font-normal text-neutral-500">{hint}</span>
                    </span>
                    <span className="block text-[12px] text-neutral-400">{desc}</span>
                    <span className="mt-1.5 flex flex-col gap-0.5">
                      {gets.map((g) => (
                        <span key={g} className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
                          <span className="size-1 rounded-full" style={{ background: tone }} /> {g}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Options */}
          <div className="mt-4 flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-white/[0.02] px-3">
            {format === "pdf" ? (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block text-[13px] text-neutral-200">Page size</span>
                  <span className="block text-[11px] text-neutral-500">Opens the print dialog · choose “Save as PDF”</span>
                </span>
                <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none">
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                </select>
              </div>
            ) : (
              <>
                <Opt
                  title="Include subpages"
                  desc={subpageCount ? `${subpageCount} nested page${subpageCount === 1 ? "" : "s"}${format === "ocean" ? " in the same file" : " · saved as a .zip"}` : "This page has no subpages"}
                  disabled={!subpageCount}
                >
                  <Switch checked={zipped} disabled={!subpageCount} onChange={() => setIncludeSubpages((v) => !v)} />
                </Opt>
                {format === "ocean" && (
                  <Opt title="Include date, status & tags" desc="Only .ocean files carry these (plus custom tag colors). Others can choose to import them.">
                    <Switch checked={includeMeta} onChange={() => setIncludeMeta((v) => !v)} />
                  </Opt>
                )}
                {format !== "ocean" && (
                  <Opt title="Include images" desc="Embedded in the file so it works anywhere">
                    <Switch checked={includeImages} onChange={() => setIncludeImages((v) => !v)} />
                  </Opt>
                )}
                {isTauri() && (
                  <Opt title="Show in folder after export" desc="Opens File Explorer with the file selected">
                    <Switch checked={reveal} onChange={() => setReveal((v) => !v)} />
                  </Opt>
                )}
              </>
            )}
          </div>

          {/* What will be written */}
          {format !== "pdf" && (
            <p className="mt-3 flex items-center gap-2 truncate px-1 text-[12px] text-neutral-500">
              <span className="text-neutral-400">You'll get</span>
              <span className="truncate rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11.5px] text-neutral-300">
                {format === "ocean" ? oceanName(page.title) : exportFilename({ rootId: page.id, pages, format: format as ExportFormat, includeSubpages })}
              </span>
            </p>
          )}

          {error && <p className="oc-fade-in mt-3 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-9 cursor-pointer rounded-lg px-3.5 text-[13px] text-neutral-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={run} disabled={busy} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-[13px] font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-70">
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? "Exporting…" : format === "pdf" ? "Print to PDF" : `Export as ${current.label}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Opt({ title, desc, disabled, children }: { title: string; desc: string; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2.5 ${disabled ? "cursor-default opacity-50" : "cursor-pointer"}`}>
      <span>
        <span className="block text-[13px] text-neutral-200">{title}</span>
        <span className="block text-[11px] text-neutral-500">{desc}</span>
      </span>
      {children}
    </label>
  );
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-default ${checked ? "bg-sky-500" : "bg-white/15"}`}
    >
      <span className={`absolute top-0.5 size-[14px] rounded-full bg-[#fff] shadow transition-[left] duration-150 ${checked ? "left-[16px]" : "left-0.5"}`} />
    </button>
  );
}
