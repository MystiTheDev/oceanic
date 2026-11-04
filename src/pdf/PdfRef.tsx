/* ---------------------------------------------------------------------------
 * Quotes from PDFs: the inline "p. N" chip (`pdfRef`) that opens the reader
 * at that page and flashes the highlight it was taken from, and the event a
 * reader sends to append a quote block to the note it was opened from.
 * ------------------------------------------------------------------------ */
import { createReactInlineContentSpec } from "@blocknote/react";
import { openPdfReader } from "./importPdf";

/** PDF names for exports (filled by the cards and readers that load docs). */
export const pdfNames = new Map<string, string>();

export const PdfRef = createReactInlineContentSpec(
  {
    type: "pdfRef",
    propSchema: { docId: { default: "" }, page: { default: 1 }, annotationId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const { docId, page, annotationId } = inlineContent.props;
      return (
        <span
          className="oc-timestamp oc-pdf-ref"
          contentEditable={false}
          data-tip={`Open ${pdfNames.get(docId) ?? "the PDF"} at page ${page}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openPdfReader({ docId, page, annotationId: annotationId || undefined })}
        >
          p. {page}
        </span>
      );
    },
    // Exports reference the PDF by name.
    toExternalHTML: ({ inlineContent }) => (
      <span>
        ({pdfNames.get(inlineContent.props.docId) ?? "PDF"}, p. {inlineContent.props.page})
      </span>
    ),
  },
);

export const SEND_TO_NOTE = "oceanic:pdf-send-to-note";
export type SendToNote = {
  docId: string;
  page: number;
  annotationId: string;
  text: string;
  /** Set by the handler: the note's title, or null when no note could take it. */
  result?: string | null;
};

/** Ask the app to append a quote to the PDF's note; returns that note's title (null: none found). */
export function sendToNote(q: Omit<SendToNote, "result">): string | null {
  const detail: SendToNote = { ...q, result: null };
  window.dispatchEvent(new CustomEvent(SEND_TO_NOTE, { detail }));
  return detail.result ?? null;
}
