import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { sameText, wordDiff } from "../lib/wordDiff";
import { ask } from "./ConfirmDialog";
import { api } from "../data/api";
import { isCloud, modelLabel, nerida, type ModelRef } from "../lib/nerida";

/* Shared by the editor AI popup and (Phase 4.5) Nerida's agent edit cards. */

/** Inline word diff: removed words struck through in red, added words in green. */
export function DiffView({ before, after, className = "" }: { before: string; after: string; className?: string }) {
  if (sameText(before, after)) return <div className={`text-[13px] whitespace-pre-wrap text-neutral-300 ${className}`}>{after}<p className="mt-1 text-[12px] text-neutral-500">No changes.</p></div>;
  return (
    <div className={`text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-200 ${className}`}>
      {wordDiff(before, after).map((p, i) =>
        p.kind === "same" ? <span key={i}>{p.text}</span>
        : p.kind === "del" ? <del key={i} className="rounded-sm bg-red-500/15 text-red-300/90 decoration-red-400/70">{p.text}</del>
        : <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-200 no-underline">{p.text}</ins>,
      )}
    </div>
  );
}

/** A before/after card with Accept / Reject. `extra` goes between them (Insert below, Try again…). */
export function DiffCard({ before, after, onAccept, onReject, acceptLabel = "Accept", extra, warning }: {
  before: string; after: string; onAccept: () => void; onReject: () => void; acceptLabel?: string; extra?: ReactNode; warning?: string;
}) {
  const act = "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] hover:bg-white/[0.08] disabled:opacity-40";
  return (
    <div>
      <div className="max-h-56 overflow-auto rounded-lg bg-white/[0.04] px-2.5 py-2"><DiffView before={before} after={after} /></div>
      {warning && <p className="mt-1.5 rounded-md bg-amber-400/10 px-2 py-1 text-[12px] text-amber-200">⚠️ {warning}</p>}
      <div className="mt-2 flex items-center gap-1">
        <button type="button" disabled={!after} className={`${act} bg-sky-500/20 text-sky-200`} onClick={onAccept}><Check className="size-3.5" /> {acceptLabel}</button>
        {extra}
        <span className="flex-1" />
        <button type="button" className={`${act} text-neutral-400`} onClick={onReject}><X className="size-3.5" /> Reject</button>
      </div>
    </div>
  );
}

/** Cloud models: ask once (shared with the chat panel) before text leaves the device. */
export async function confirmCloud(model: ModelRef = nerida.get().model): Promise<boolean> {
  if (!isCloud(model) || nerida.get().cloudOk) return true;
  if (!(await ask({ title: `Use ${modelLabel(model)}?`, body: `${modelLabel(model)} is a cloud model: your message and the included notes are sent to that provider.`, confirm: "Continue", tone: "warn" }))) return false;
  nerida.set({ cloudOk: true });
  void api.setSetting("neridaCloudOk", "1").catch(() => {});
  return true;
}
