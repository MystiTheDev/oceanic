/* ---------------------------------------------------------------------------
 * The reader's annotation store: the doc's annotations, an undo/redo stack of
 * changes, live (unsaved, unrecorded) previews while dragging, and a
 * debounced batch save to SQLite.
 * ------------------------------------------------------------------------ */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../data/api";
import { fromRecord, toRecord, type Ann } from "./annotations";
import { notifyPdfChanged } from "./pdfjs";

/** One annotation before and after an edit (null = didn't exist / removed). */
export type Change = { id: string; before: Ann | null; after: Ann | null };

const SAVE_DELAY = 500;

function applyTo(list: Ann[], changes: Change[], side: "before" | "after"): Ann[] {
  let out = list;
  for (const c of changes) {
    const next = c[side];
    const at = out.findIndex((a) => a.id === c.id);
    if (next && at >= 0) out = out.map((a, i) => (i === at ? next : a));
    else if (next) out = [...out, next];
    else if (at >= 0) out = out.filter((_, i) => i !== at);
  }
  return out;
}

export function useAnnotations(docId: string) {
  const [anns, setAnns] = useState<Ann[]>([]);
  const [loaded, setLoaded] = useState(false);
  const undoStack = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const [, bump] = useState(0);
  const current = useRef<Ann[]>([]);
  current.current = anns;
  const dirty = useRef(new Set<string>());
  const timer = useRef(0);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    undoStack.current = [];
    redoStack.current = [];
    api
      .getPdfAnnotations(docId)
      .then((rows) => {
        if (!live) return;
        setAnns(rows.map(fromRecord));
        setLoaded(true);
      })
      .catch((e) => console.error("Loading annotations failed", e));
    return () => void (live = false);
  }, [docId]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current.size) return;
    const ids = [...dirty.current];
    dirty.current.clear();
    const byId = new Map(current.current.map((a) => [a.id, a]));
    const upserts = ids.filter((id) => byId.has(id)).map((id) => toRecord(byId.get(id)!));
    const deletes = ids.filter((id) => !byId.has(id));
    void api
      .batchPdfAnnotations(upserts, deletes)
      .then(() => notifyPdfChanged(docId))
      .catch((e) => console.error("Saving annotations failed", e));
  }, [docId]);

  // Save whatever is pending when the reader closes.
  useEffect(() => flush, [flush]);

  const schedule = (changes: Change[]) => {
    changes.forEach((c) => dirty.current.add(c.id));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  /** Record an edit (undoable) and save it. */
  const commit = (changes: Change[]) => {
    const real = changes.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
    if (!real.length) return;
    // `before` comes from the caller's snapshot; the list may hold a live preview.
    setAnns((list) => applyTo(list, real, "after"));
    current.current = applyTo(current.current, real, "after");
    undoStack.current.push(real);
    redoStack.current = [];
    schedule(real);
    bump((n) => n + 1);
  };

  /** Show a dragged annotation without recording or saving it (commit on release). */
  const preview = (ann: Ann) => setAnns((list) => list.map((a) => (a.id === ann.id ? ann : a)));

  const step = (from: React.MutableRefObject<Change[][]>, to: React.MutableRefObject<Change[][]>, side: "before" | "after") => {
    const changes = from.current.pop();
    if (!changes) return null;
    to.current.push(changes);
    const ordered = side === "before" ? [...changes].reverse() : changes;
    setAnns((list) => applyTo(list, ordered, side));
    current.current = applyTo(current.current, ordered, side);
    schedule(changes);
    bump((n) => n + 1);
    return changes;
  };
  const undo = () => step(undoStack, redoStack, "before");
  const redo = () => step(redoStack, undoStack, "after");

  return {
    anns,
    loaded,
    commit,
    preview,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    flush,
  };
}
