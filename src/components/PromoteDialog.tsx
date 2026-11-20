import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api, REL_TYPES, type Concept, type RelType } from "../data/api";
import { REL_LABELS } from "../data/atlas";
import { Modal, ModalButton } from "./Modal";
import { useEnter } from "../lib/overlay";
import { Toast } from "./Toast";
import { Select } from "./SettingsModal";

/** One idea that can become a concept (a mind map node or a note heading). */
export type PromoteItem = {
  key: string;
  title: string;
  /** Parent item's key, for connecting child to parent. */
  parentKey: string | null;
  /** Indent in the list. */
  depth: number;
  /** Resources to attach to the concept (page id, `heading:…`). */
  entryIds: string[];
};

/** Fired to switch the main view to Atlas. */
export const OPEN_ATLAS = "oc-open-atlas";
/** Fired to open "Send to Atlas" for a note's headings: detail `{ pageId?, blockId? }`. */
export const HEADINGS_TO_ATLAS = "oc-headings-to-atlas";

const norm = (t: string) => t.trim().toLowerCase();

/**
 * Turns the ticked items into Atlas concepts in `workspaceId`. A concept with
 * the same title is reused, not duplicated. Each item connects to its nearest
 * ancestor that is ticked or already in Atlas, with `relType` (null = no connections). Returns how many
 * concepts were created.
 */
async function promote(workspaceId: string, items: PromoteItem[], picked: Set<string>, relType: RelType | null) {
  const existing = await api.listConcepts(workspaceId);
  const byTitle = new Map(existing.map((c) => [norm(c.title), c]));
  const byKey = new Map(items.map((i) => [i.key, i]));
  const idOf = new Map<string, string>();
  let created = 0;
  for (const item of items) {
    if (!picked.has(item.key)) continue;
    let c: Concept | undefined = byTitle.get(norm(item.title));
    if (!c) {
      c = await api.createConcept(workspaceId, item.title.trim());
      byTitle.set(norm(c.title), c);
      created++;
    }
    idOf.set(item.key, c.id);
    for (const e of item.entryIds) await api.attachResource(c.id, e);
  }
  if (relType) {
    for (const item of items) {
      const child = idOf.get(item.key);
      if (!child) continue;
      // Nearest ancestor that is ticked now or already a concept in Atlas.
      let p = item.parentKey;
      while (p && !picked.has(p) && !byTitle.has(norm(byKey.get(p)?.title ?? ""))) p = byKey.get(p)?.parentKey ?? null;
      const parent = p ? (idOf.get(p) ?? byTitle.get(norm(byKey.get(p)!.title))?.id) : undefined;
      if (parent && parent !== child) await api.connectPages(child, parent, relType).catch(() => {});
    }
  }
  return created;
}

/** Checklist dialog: pick ideas, pick how branches connect, send to Atlas. */
export function PromoteDialog({
  items,
  workspaceId,
  preselect = [],
  onClose,
}: {
  items: PromoteItem[];
  workspaceId: string;
  /** Keys ticked when the dialog opens. */
  preselect?: string[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(preselect));
  const [relType, setRelType] = useState<RelType | "none">("part_of");
  const [have, setHave] = useState<Set<string>>(new Set());
  const [wsName, setWsName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listConcepts(workspaceId).then((cs) => setHave(new Set(cs.map((c) => norm(c.title))))).catch(() => {});
    api.getWorkspaces().then((ws) => setWsName(ws.find((w) => w.id === workspaceId)?.name ?? "")).catch(() => {});
  }, [workspaceId]);

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const send = () => {
    setBusy(true);
    promote(workspaceId, items, picked, relType === "none" ? null : relType)
      .then((n) => onDone(n))
      .catch((e) => (console.error("Sending to Atlas failed", e), setBusy(false)));
  };
  const [done, setDone] = useState<number | null>(null);
  const onDone = (n: number) => setDone(n);
  useEnter(() => picked.size && !busy && send(), done === null);

  if (done !== null)
    return (
      <Toast
        message={done ? `${done} concept${done === 1 ? "" : "s"} added to Atlas` : "Linked to existing concepts in Atlas"}
        actionLabel="Open in Atlas"
        onAction={() => (window.dispatchEvent(new Event(OPEN_ATLAS)), onClose())}
        onDismiss={onClose}
      />
    );

  return (
    <Modal onClose={onClose} className="w-[440px]">
      <div className="p-4 text-[13px]">
        <p className="text-[15px] font-semibold text-neutral-100">Send to Atlas</p>
        <p className="mb-3 text-neutral-400">
          Pick the ideas to turn into concepts{wsName && <> in <span className="text-neutral-200">{wsName}</span></>}.
        </p>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {items.map((i) => (
            <li key={i.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 hover:bg-white/[0.04]" style={{ paddingLeft: 8 + i.depth * 16 }}>
                {/* Native input kept (hidden) for keyboard + screen readers; the box is drawn. */}
                <input type="checkbox" checked={picked.has(i.key)} onChange={() => toggle(i.key)} className="peer sr-only" />
                <span
                  className={`grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-100 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500/50 ${
                    picked.has(i.key) ? "border-[var(--color-sky-500)] bg-[var(--color-sky-500)] text-white" : "border-white/25 hover:border-white/50"
                  }`}
                >
                  {picked.has(i.key) && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-200">{i.title || "Untitled"}</span>
                {have.has(norm(i.title)) && <span className="shrink-0 text-[11px] text-neutral-500">already in Atlas</span>}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3 text-neutral-300">
          Connect each idea to its parent as
          <Select<RelType | "none">
            value={relType}
            onChange={setRelType}
            options={[...REL_TYPES.map((t): [RelType, string] => [t, REL_LABELS[t]]), ["none", "Don't connect"]]}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" disabled={!picked.size || busy} onClick={send}>
            Send {picked.size || ""} to Atlas
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}
