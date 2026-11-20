import { useState } from "react";
import { AlertCircle, Bot, Check, ChevronRight, FilePlus2, GraduationCap, Pencil, Search, Trash2, Undo2, X } from "lucide-react";
import { nerida, useNerida, type AgentLog } from "../lib/nerida";
import { answerCard, canUndo, undo, useAgentCards } from "../lib/neridaAgent";
import { DiffCard } from "./NeridaDiff";

/* Agent mode UI: the toggle, the Accept/Reject cards, and the activity log on each reply. */

const ICON = { read: Search, create: FilePlus2, edit: Pencil, delete: Trash2, study: GraduationCap, error: AlertCircle } as const;
const TONE = { read: "text-neutral-500", create: "text-emerald-300", edit: "text-sky-300", delete: "text-rose-300", study: "text-violet-300", error: "text-amber-300" } as const;

export const openNote = (pageId: string) => window.dispatchEvent(new CustomEvent("oc-open-block", { detail: { pageId } }));
export const openAgentTest = (pageIds: string[]) => window.dispatchEvent(new CustomEvent("oc-nerida-test", { detail: pageIds }));

/** What Nerida did, one line per action; reads and searches fold into one line. Undo on applied changes. */
export function AgentLogList({ actions, onChange }: { actions: AgentLog[]; onChange?: (a: AgentLog[]) => void }) {
  const [openReads, setOpenReads] = useState(false);
  const [, bump] = useState(0);
  if (!actions.length) return null;
  const reads = actions.filter((a) => a.kind === "read");
  const rest = actions.filter((a) => a.kind !== "read");
  const doUndo = async (a: AgentLog) => {
    await undo(a.id);
    onChange?.(actions.map((x) => (x.id === a.id ? { ...x, state: "undone" } : x)));
    bump((n) => n + 1);
  };
  const row = (a: AgentLog) => {
    const I = ICON[a.kind];
    const off = a.state === "undone" || a.state === "rejected";
    return (
      <li key={a.id} className={`flex items-center gap-1.5 py-0.5 text-[12.5px] ${off ? "text-neutral-500 line-through decoration-neutral-600" : "text-neutral-300"}`}>
        <I className={`size-3.5 shrink-0 ${TONE[a.kind]}`} />
        {a.pageId && !off ? <button type="button" className="min-w-0 cursor-pointer truncate text-left hover:text-neutral-100 hover:underline" onClick={() => openNote(a.pageId!)}>{a.text}</button> : <span className="min-w-0 truncate">{a.text}</span>}
        {a.test && <button type="button" className="ml-1 shrink-0 cursor-pointer rounded-md bg-violet-400/15 px-1.5 text-[12px] text-violet-200 hover:bg-violet-400/25" onClick={() => openAgentTest(a.test!)}>Start test</button>}
        {a.state === "applied" && canUndo(a.id) && (
          <button type="button" title="Undo" className="ml-auto flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 text-[11.5px] text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-200" onClick={() => void doUndo(a)}><Undo2 className="size-3" /> Undo</button>
        )}
        {a.state === "undone" && <span className="ml-auto shrink-0 text-[11px] no-underline">undone</span>}
      </li>
    );
  };
  return (
    <ul className="mb-2 rounded-lg border border-white/[0.06] bg-black/10 px-2 py-1">
      {reads.length > 0 && (
        <li>
          <button type="button" className="flex cursor-pointer items-center gap-1 py-0.5 text-[12px] text-neutral-500 hover:text-neutral-300" onClick={() => setOpenReads((o) => !o)}>
            <ChevronRight className={`size-3 transition-transform ${openReads ? "rotate-90" : ""}`} /> Looked at {reads.length} thing{reads.length > 1 ? "s" : ""}
          </button>
          {openReads && <ul className="ml-4">{reads.map(row)}</ul>}
        </li>
      )}
      {rest.map(row)}
    </ul>
  );
}

/** Changes waiting for Accept/Reject (the loop waits on them). */
export function AgentCards() {
  const cards = useAgentCards();
  if (!cards.length) return null;
  const act = "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] hover:bg-white/[0.08]";
  return (
    <div className="mt-2 flex flex-col gap-2">
      {cards.map((c) => (
        <div key={c.id} className="oc-msg-in rounded-xl border border-sky-300/20 bg-sky-400/[0.04] p-2.5">
          <p className="mb-1.5 text-[12.5px] font-medium text-neutral-100">{c.title}</p>
          {c.before !== undefined || c.after !== undefined ? (
            <DiffCard before={c.before ?? ""} after={c.after ?? ""} warning={c.warning} onAccept={() => answerCard(c.id, true)} onReject={() => answerCard(c.id, false)} />
          ) : (
            <>
              {c.lines && <ul className="max-h-48 overflow-auto rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[12.5px] text-neutral-300">{c.lines.map((l, i) => <li key={i} className="py-0.5">• {l}</li>)}</ul>}
              {c.warning && <p className="mt-1.5 rounded-md bg-amber-400/10 px-2 py-1 text-[12px] text-amber-200">⚠️ {c.warning}</p>}
              <div className="mt-2 flex items-center gap-1">
                <button type="button" className={`${act} ${c.kind === "delete" ? "bg-rose-500/20 text-rose-200" : "bg-sky-500/20 text-sky-200"}`} onClick={() => answerCard(c.id, true)}><Check className="size-3.5" /> {c.kind === "delete" ? "Move to Trash" : "Accept"}</button>
                <span className="flex-1" />
                <button type="button" className={`${act} text-neutral-400`} onClick={() => answerCard(c.id, false)}><X className="size-3.5" /> Reject</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Composer toggle: agent mode on/off, and (when on) auto-apply for creating things. */
export function AgentToggle({ disabled }: { disabled?: boolean }) {
  const { agent, autoApply } = useNerida();
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" disabled={disabled} aria-pressed={agent} title={agent ? "Agent mode on: Nerida can create and edit notes (you approve changes)" : "Agent mode: let Nerida create and edit notes"}
        onClick={() => nerida.setAgent(!agent)}
        className={`flex h-7 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-[12px] hover:bg-white/[0.06] disabled:cursor-default ${agent ? "text-teal-300" : "text-neutral-400 hover:text-neutral-200"}`}>
        <Bot className="size-4" />{agent && "Agent"}
      </button>
      {agent && (
        <button type="button" role="switch" aria-checked={autoApply} disabled={disabled} onClick={() => nerida.setAutoApply(!autoApply)}
          data-tip={autoApply ? "Auto-apply new things: on" : "Auto-apply new things: off"}
          data-tip-sub="When on, Nerida creates notes, folders, events, links, flashcards and mind maps without asking. Edits, moves, renames, tags and Trash always ask first."
          className={`flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 text-[11.5px] hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50 ${autoApply ? "text-teal-300" : "text-neutral-400 hover:text-neutral-200"}`}>
          <span className={`relative h-3.5 w-6 rounded-full transition-colors ${autoApply ? "bg-teal-400/80" : "bg-white/[0.15]"}`}>
            <span className={`absolute top-0.5 left-0.5 size-2.5 rounded-full bg-white shadow transition-transform ${autoApply ? "translate-x-2.5" : ""}`} />
          </span>
          Auto
        </button>
      )}
    </span>
  );
}
