/* ---------------------------------------------------------------------------
 * The "pdf" block: a preview card for an imported PDF (real page thumbnail,
 * name, page and annotation counts, hover arrows to peek at the first pages).
 * Clicking it opens the reader. Several blocks may share one doc id.
 * ------------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronLeft, ChevronRight, FileText, Highlighter, TriangleAlert } from "lucide-react";
import { api, type PdfDocRecord } from "../data/api";
import { PDF_CHANGED, PDF_PROGRESS, extraction, finishImport, imageSrc, openPdf, pdfErrorMessage, renderPageImage } from "./pdfjs";
import { openPdfReader, pickPdf } from "./importPdf";
import { pdfNames } from "./PdfRef";

/** Pages the card can peek at. */
const PEEK = 5;
/** Peeked page images by `docId:page`, shared by every card. */
const peeks = new Map<string, string>();

/** The doc row, refreshed whenever the reader or an import changes it. */
export function usePdfDoc(docId: string) {
  const [doc, setDoc] = useState<PdfDocRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!docId) return;
    let live = true;
    const load = () =>
      void api
        .getPdfDoc(docId)
        .then((d) => {
          if (d) pdfNames.set(d.id, d.name);
          if (live) setDoc(d);
        })
        .catch(() => live && setDoc(null));
    load();
    const onChange = (e: Event) => (e as CustomEvent<string>).detail === docId && load();
    window.addEventListener(PDF_CHANGED, onChange);
    return () => {
      live = false;
      window.removeEventListener(PDF_CHANGED, onChange);
    };
  }, [docId]);
  return doc;
}

function PdfCard({ docId, name }: { docId: string; name: string }) {
  const doc = usePdfDoc(docId);
  const [page, setPage] = useState(1);
  const [peek, setPeek] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(extraction.get(docId));

  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === docId && setProgress(extraction.get(docId) && { ...extraction.get(docId)! });
    window.addEventListener(PDF_PROGRESS, on);
    return () => window.removeEventListener(PDF_PROGRESS, on);
  }, [docId]);

  // An import that never finished (app closed mid-way) resumes here; a broken file shows why.
  useEffect(() => {
    if (!doc) return;
    if (!doc.thumbPath || !doc.pageCount) finishImport(doc).catch((e) => setError(pdfErrorMessage(e)));
    else openPdf(doc).catch((e) => setError(pdfErrorMessage(e)));
  }, [doc?.id, doc?.thumbPath, doc?.pageCount]);

  // Pages after the first render on demand (page 1 is the stored thumbnail).
  useEffect(() => {
    if (!doc || page === 1) return setPeek(null);
    const key = `${docId}:${page}`;
    if (peeks.has(key)) return setPeek(peeks.get(key)!);
    let live = true;
    setPeek(null);
    openPdf(doc)
      .then((pdf) => pdf.getPage(page))
      .then((p) => renderPageImage(p, 400))
      .then((url) => {
        peeks.set(key, url);
        if (live) setPeek(url);
      })
      .catch(() => {});
    return () => void (live = false);
  }, [doc?.id, page]);

  if (doc === null) {
    return (
      <div className="oc-pdf-card oc-pdf-error" contentEditable={false}>
        <TriangleAlert size={16} /> <span>{name || "PDF"} is missing from Oceanic's storage.</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="oc-pdf-card oc-pdf-error" contentEditable={false}>
        <TriangleAlert size={16} />
        <div>
          <div className="oc-pdf-name">{doc?.name || name}</div>
          <div className="oc-pdf-meta">{error}</div>
        </div>
      </div>
    );
  }
  const pages = doc?.pageCount ?? 0;
  const last = Math.min(PEEK, pages);
  const src = page === 1 ? (doc?.thumbPath ? imageSrc(doc.thumbPath) : null) : peek;
  const step = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setPage((p) => Math.min(last, Math.max(1, p + d)));
  };
  return (
    <div
      className="oc-pdf-card"
      contentEditable={false}
      role="button"
      tabIndex={0}
      onClick={() => openPdfReader({ docId, page: page > 1 ? page : undefined })}
      onKeyDown={(e) => e.key === "Enter" && openPdfReader({ docId })}
    >
      <div className="oc-pdf-thumb">
        {src ? <img src={src} alt="" draggable={false} /> : <div className="oc-pdf-thumb-wait" />}
        {last > 1 && (
          <>
            <button type="button" className="oc-pdf-peek oc-pdf-peek-l" disabled={page <= 1} onClick={step(-1)} data-tip="Previous page">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="oc-pdf-peek oc-pdf-peek-r" disabled={page >= last} onClick={step(1)} data-tip="Next page">
              <ChevronRight size={16} />
            </button>
            <span className="oc-pdf-peek-n">
              {page} / {pages}
            </span>
          </>
        )}
      </div>
      <div className="oc-pdf-info">
        <FileText size={16} className="shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <div className="oc-pdf-name">{doc?.name || name || "PDF"}</div>
          <div className="oc-pdf-meta">
            {pages ? `${pages} page${pages === 1 ? "" : "s"}` : "Opening…"}
            {!!doc?.annotationCount && (
              <>
                {" · "}
                <Highlighter size={11} className="inline -mt-px" /> {doc.annotationCount}
              </>
            )}
          </div>
        </div>
      </div>
      {progress && (
        <div className="oc-pdf-progress" data-tip="Making the text searchable">
          <span>
            Indexing {progress.done}/{progress.total}
          </span>
          <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export const PdfBlock = createReactBlockSpec(
  { type: "pdf", propSchema: { docId: { default: "" }, name: { default: "" } }, content: "none" },
  {
    render: function PdfBlockView({ block, editor }) {
      const { docId, name } = block.props;
      if (!docId) {
        return (
          <button
            type="button"
            contentEditable={false}
            className="oc-audio-empty"
            onClick={async () => {
              const doc = await pickPdf().catch(() => null);
              if (doc) editor.updateBlock(block, { props: { docId: doc.id, name: doc.name } } as never);
            }}
          >
            <FileText size={16} /> Add a PDF
          </button>
        );
      }
      return <PdfCard docId={docId} name={name} />;
    },
    // Exports reference the PDF by name.
    toExternalHTML: ({ block }) => <p>📄 {block.props.name || "PDF"}</p>,
  },
);
