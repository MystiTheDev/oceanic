import { buildOceanFile } from "../lib/oceanFile";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
const FORMATS: { id: Format; label: string; hint: string; desc: string; icon: typeof FileText }[] = [
  { id: "ocean", label: "Oceanic file", hint: ".ocean", desc: "Everything kept: subpages, images, properties", icon: Waves },
  { id: "markdown", label: "Markdown", hint: ".md", desc: "Plain text, works anywhere", icon: FileText },
  { id: "html", label: "HTML", hint: ".html", desc: "Opens in any browser", icon: FileCode2 },
  { id: "pdf", label: "PDF", hint: ".pdf", desc: "Print-ready, page numbers", icon: FileDown },
];

/** Notion's Export modal: pick a format, optionally include sub-pages (→ .zip). */
export function ExportDialog({ page, pages, loadBlocks, onDone, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<Format>("markdown");
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [includeSubpages, setIncludeSubpages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subpageCount = subtreeIds(pages, page.id).size - 1;
  const zipped = includeSubpages && subpageCount > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

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
        const target = await pickSaveTarget(`${(page.title || "Untitled").replace(/[\/:*?"<>|]/g, "-")}.ocean`);
        if (!target) return;
        await target.write(await buildOceanFile(page.id, pages, loadBlocks, includeSubpages));
        onDone(`Exported to ${target.label}`);
        onClose();
        return;
      }
      // Ask where to save first (pickers need the click's fresh activation),
      // then render and write the file.
      const opts = { rootId: page.id, pages, format: format as ExportFormat, includeSubpages };
      const target = await pickSaveTarget(exportFilename(opts));
      if (!target) return; // cancelled: keep the dialog open
      const file = await buildExport({ ...opts, loadBlocks });
      await target.write(file.data);
      onDone(`Exported to ${target.label}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="oc-fade-in fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-label="Export"
        onMouseDown={(e) => e.stopPropagation()}
        className="oc-pop-in w-full max-w-[400px] rounded-xl border border-white/[0.08] bg-neutral-900 p-5 shadow-2xl shadow-black/60"
      >
        <h2 className="text-[15px] font-semibold text-neutral-100">Export</h2>
        <p className="mt-1 truncate text-[13px] text-neutral-500">
          {page.icon} {page.title || "Untitled"}
        </p>

        {/* Format */}
        <div className="mt-5 text-xs font-medium text-neutral-500">Export format</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {FORMATS.map(({ id, label, hint, desc, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFormat(id)}
              className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 pb-3 pt-3.5 text-center transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] ${
                format === id
                  ? "border-sky-500/70 bg-sky-500/10 text-neutral-100"
                  : "border-white/[0.08] text-neutral-300 hover:border-white/[0.16] hover:bg-white/[0.04]"
              }`}
            >
              <span
                className={`mb-1 grid size-9 place-items-center rounded-lg transition-colors ${
                  format === id ? "bg-sky-500/20 text-sky-400" : "bg-white/[0.05] text-neutral-400"
                }`}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="text-[13px] font-semibold">{label}</span>
              <span className="text-[11px] text-neutral-500">{hint}</span>
              <span className="mt-1 text-[11px] leading-tight text-neutral-500">{desc}</span>
            </button>
          ))}
        </div>

        {format === "pdf" ? (
          <div className="mt-4 flex items-center justify-between gap-3 px-1 py-1.5">
            <span>
              <span className="block text-[13px] text-neutral-200">Page size</span>
              <span className="block text-[11px] text-neutral-500">
                Opens the print dialog · choose “Save as PDF” · title, date and page numbers included
              </span>
            </span>
            <select
              value={paper}
              onChange={(e) => setPaper(e.target.value as PaperSize)}
              className="h-8 cursor-pointer rounded-md border border-white/[0.08] bg-[var(--oc-raised)] px-2 text-[13px] text-neutral-200 outline-none"
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </div>
        ) : (
        <label
          className={`mt-4 flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 ${
            subpageCount ? "cursor-pointer" : "cursor-default opacity-50"
          }`}
        >
          <span>
            <span className="block text-[13px] text-neutral-200">Include subpages</span>
            <span className="block text-[11px] text-neutral-500">
              {subpageCount
                ? `${subpageCount} nested page${subpageCount === 1 ? "" : "s"} · saved as a .zip`
                : "This page has no subpages"}
            </span>
          </span>
          <Switch
            checked={zipped}
            disabled={!subpageCount}
            onChange={() => setIncludeSubpages((v) => !v)}
          />
        </label>
        )}

        {error && (
          <p className="oc-fade-in mt-3 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 cursor-pointer rounded-md px-3 text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sky-600 px-3.5 text-[13px] font-medium text-[#fff] transition-colors duration-100 hover:bg-sky-500 disabled:opacity-70"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "Exporting…" : format === "pdf" ? "Print to PDF" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-default ${
        checked ? "bg-sky-500" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 size-[14px] rounded-full bg-[#fff] shadow transition-[left] duration-150 ${
          checked ? "left-[16px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
