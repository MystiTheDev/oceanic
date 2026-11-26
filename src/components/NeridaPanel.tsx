import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { runTools, searchWeb } from "../lib/neridaTools";
import { SourceBook, type SourceRef } from "../lib/neridaGuard";
import { forget as forgetIndex, noteChars, refresh as refreshIndex, searchNotes as searchIndex } from "../lib/noteIndex";
import { canSeeImages, readImage, readNoteImages, shrink, unreadImages } from "../lib/neridaImages";
import { ImageAnnotator } from "./ImageAnnotator";
import { ContextPicker } from "./NeridaContext";
import { createMindmap } from "../mindmap/MindmapGallery";
import { MAP_FLAG } from "../mindmap/NeridaMap";
import { OPEN_MINDMAP } from "../editor/mindmapBlock";
import { NeridaTaskCard } from "./NeridaTaskCard";
import { openReview } from "../lib/srs";
import { StudyPlanWizard } from "./StudyPlanWizard";
import { NeridaAskBox } from "./NeridaAskBox";
import { planAsk, choicesLine, type AskPlan } from "../lib/neridaAsk";
import { agentHost, AUTO_TOOLS, needsTool } from "../lib/neridaAgent";

/** "Don't ask again" for running note tools with Agent mode off. */
const AUTO_AGENT = "oc-auto-agent";
const autoAgent = () => { try { return localStorage.getItem(AUTO_AGENT) === "once"; } catch { return false; } };
const AGENT_CHOICES = ["Just this once", "Just this once, don't ask again", "Turn on Agent mode", "Answer without tools"];
import { GARBLED_NOTE, NERIDA_ASK, pageRange, pdfContext, readScanned, summarizePdf, type AskDetail } from "../lib/neridaPdf";
import { pdfNames } from "../pdf/PdfRef";
import { detectTask, type TaskDraft } from "../lib/neridaTask";
import { AlertCircle, AlignLeft, CalendarDays, CircleHelp, Layers, Lightbulb, Network, Wrench, ArrowDown, ArrowUp, Check, ChevronDown, History, MessageSquare, Pencil, Search, Copy, Download, FileInput, FileText, Globe, Loader2, Paperclip, Plus, RotateCcw, Square, X } from "lucide-react";
import { usePageDirectory } from "../editor/pageDirectory";
import { DeepSparkles, EffortButton, ThoughtLine } from "./NeridaEffort";
import { DELETE_NOTE, ASK_WHICH, editPrompt, proposalWarning, isEditRequest, targetBlocks, markAllDone, noteBlocks, parseEdits, proposeEdits, usePending } from "../lib/neridaChatEdit";
import { ModelMenu } from "./NeridaModelMenu";
import { openNeridaCards } from "./NeridaCards";
import { ATTACH_ACCEPT, attachmentsContext, extractFileText, isImageFile, MAX_IMAGES, type Attachment } from "../lib/neridaFiles";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../data/api";
import { NeridaIntro } from "./NeridaIntro";
import {
  buildContext, trimHistory, MAX_NOTES, noteBudget, builtin, chatGroups, downloadModel, downloadVision, engine, openNeridaSettings, isCloud, listModels, MODEL_NAMES, modelLabel, nerida, OLLAMA_URL, relatedNotes, setDefaultModel, SYSTEM, EDIT_SYSTEM, AGENT_SYSTEM, withNotes, uid, useNerida, isFeaturesQuestion, isLocked, UPGRADE_MSG,
  type AgentLog, type AiStatus, type Chat, type ContextNote, type ModelId, type ModelRef, type Msg,
} from "../lib/nerida";

export { NeridaMark } from "./NeridaOrb";
import katex from "katex";
import "katex/dist/katex.min.css";
import { NeridaMark } from "./NeridaOrb";
import { confirmCloud } from "./NeridaDiff";
import { AgentCards, AgentLogList } from "./NeridaAgentUI";
import { runAgent, stopAgent, TOOLS } from "../lib/neridaAgent";
import { neridaSafeMarkdown } from "../lib/neridaSafe";

/* ------------------------------------------------------------- markdown */
/** $…$ → KaTeX. Plain numbers or words ("$6.53$", "$P$" stays math-italic) need no braces; money like "$5 and $10" isn't matched (no space inside the $s). */
function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
  if (/^-?[\d.,]+$/.test(tex.trim())) return <>{tex.trim()}</>;
  const render = (t: string) => { try { return katex.renderToString(t, { displayMode: display, throwOnError: true, output: "html" }); } catch { return null; } };
  const html = render(tex) ?? render(repairTex(tex));
  // Still broken: show it as readable text, never raw TeX or KaTeX's red error.
  if (html === null) return <span title={tex}>{texToText(tex)}</span>;
  return display ? <div className="my-3 overflow-x-auto overflow-y-hidden text-[1.1em]" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}
/** Common model slips: unclosed braces or \left, a missing \end{…}, unknown commands. */
function repairTex(tex: string) {
  let t = tex.replace(/\\$/, ""); // dangling backslash
  const ends = [...t.matchAll(/\\begin\{(\w+\*?)\}/g)].map((m) => m[1]).filter((e) => !t.includes(`\\end{${e}}`));
  const lefts = (t.match(/\\left\b/g)?.length ?? 0) - (t.match(/\\right\b/g)?.length ?? 0);
  let open = 0;
  for (const c of t.replace(/\\[{}]/g, "")) open = Math.max(0, open + (c === "{" ? 1 : c === "}" ? -1 : 0));
  t += "}".repeat(open) + "\\right.".repeat(Math.max(0, lefts)) + ends.reverse().map((e) => `\\end{${e}}`).join("");
  // Unknown commands: KaTeX names them in its error; turn each into its plain name.
  for (let i = 0; i < 5; i++) {
    try { katex.renderToString(t, { throwOnError: true }); break; }
    catch (e) { const m = /Undefined control sequence: (\\\w+)/.exec(String(e)); if (!m) break; t = t.split(m[1]).join(`\\text{${m[1].slice(1)}}`); }
  }
  return t;
}
/** Readable fallback: \frac{a}{b} → a/b, \sqrt{x} → √(x), ^ and _ kept, other commands dropped. */
function texToText(tex: string) {
  let t = tex;
  for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}?/g, (_, a, b) => `${a}/${b || "…"}`).replace(/\\sqrt\{([^{}]*)\}?/g, "√($1)");
  return t.replace(/\\(cdot|times)\b/g, "×").replace(/\\(le|leq)\b/g, "≤").replace(/\\(ge|geq)\b/g, "≥").replace(/\\to\b/g, "→").replace(/\\pi\b/g, "π")
    .replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim() || "…";
}
/** Opens a cited note, scrolled to the cited section. */
export const openSource = (s: SourceRef) => window.dispatchEvent(new CustomEvent("oc-open-block", { detail: { pageId: s.pageId, blockId: s.blockId } }));
function inlineRaw(t: string, stream = false, sources?: SourceRef[]): ReactNode[] {
  return t.split(/(\[\d{1,3}\]|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*.+?\*\*|`.+?`|\*.+?\*)/g).map((s, i) => {
    const src = s.startsWith("[") ? sources?.find((x) => `[${x.n}]` === s) : undefined;
    return src ? (
      <button key={i} type="button" title={`Open “${src.title}”`} onClick={() => openSource(src)}
        className="mx-px cursor-pointer rounded bg-teal-300/[0.12] px-1 align-[1px] text-[0.78em] font-medium text-teal-200 hover:bg-teal-300/25">{src.n}</button>
    )
    : s.startsWith("$") && s.length > 2 ? <MathSpan key={i} tex={s.slice(1, -1)} />
    : s.startsWith("**") && s.length > 4 ? <b key={i}>{s.slice(2, -2)}</b>
    : s.startsWith("`") && s.length > 2 ? <code key={i} className="rounded bg-white/[0.08] px-1 text-[0.9em]">{s.slice(1, -1)}</code>
    : s.startsWith("*") && s.length > 2 ? <i key={i}>{s.slice(1, -1)}</i>
    // Streaming: one span per word, so only newly arrived words mount (and fade in).
    : stream ? <Fragment key={i}>{s.split(/(\s+)/).map((w, j) => <span key={j} className="oc-word">{w}</span>)}</Fragment>
    : <Fragment key={i}>{s}</Fragment>;
  });
}
/** `sources`: note sources the reply's [n] marks open (footer lines included). */
export function Markdown({ text, stream = false, sources }: { text: string; stream?: boolean; sources?: SourceRef[] }) {
  const inline = (t: string) => inlineRaw(t, stream, sources);
  const out: ReactNode[] = [];
  // \( \) and \[ \] mean the same as $ and $$.
  let t = text.replace(/\\\((.+?)\\\)/g, (_, m: string) => `$${m.trim()}$`).replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$${m.trim()}$$\n`);
  // Streaming: hide a formula until it closes (an open $$ block, \( or \[, or a $ not followed by a digit or space).
  if (stream) t = t.replace(/(^|\n)\s*\$\$(?![\s\S]*\$\$)[\s\S]*$|\\[([][^\])]*$|\$(?![\d\s$])[^$\n]*$/, "");
  const lines = t.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\$\$/.test(l)) {
      // $$ block, on one line or several.
      const tex = [l.trim().slice(2)];
      while (!/\$\$\s*$/.test(tex[tex.length - 1]) && ++i < lines.length) tex.push(lines[i]);
      out.push(<MathSpan key={i} tex={tex.join("\n").trim().replace(/\$\$$/, "")} display />);
    } else if (l.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(<pre key={i} className="my-2.5 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/35 p-3 font-mono text-[12px] leading-relaxed text-neutral-200">{code.join("\n")}</pre>);
    } else if (/^#{1,3} /.test(l)) out.push(<p key={i} className="mt-3 mb-1 font-semibold text-neutral-100">{inline(l.replace(/^#+ /, ""))}</p>);
    else if (/^\s*([-*]|\d+\.) /.test(l))
      out.push(<p key={i} className="flex gap-2 pl-1" style={{ marginLeft: (l.match(/^\s*/)![0].length / 2) * 12 }}><span className="text-neutral-500">{/^\s*\d/.test(l) ? l.trim().split(" ")[0] : "•"}</span><span>{inline(l.replace(/^\s*([-*]|\d+\.) /, ""))}</span></p>);
    else if (l.trim()) out.push(<p key={i} className="my-1.5">{inline(l)}</p>);
  }
  return <div className={`oc-md ${stream ? "oc-streaming" : ""} text-[13.5px] leading-relaxed text-neutral-200`}>{out}</div>;
}

/* ----------------------------------------------------------------- setup */
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

function Setup({ status, model, auto, onDone }: { status: AiStatus; model: ModelId; auto: boolean; onDone: () => void }) {
  const prog = useNerida().dl;
  const [err, setErr] = useState("");
  const size = status.models.find((m) => m.id === model)?.size ?? 0;
  const run = async () => {
    setErr("");
    const e = await downloadModel(model, !status.server, !!status.models.find((m) => m.id === model)?.installed);
    setErr(e);
    if (!e) onDone();
  };
  useEffect(() => {
    if (auto) void run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="m-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-center">
      <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-white/[0.05]"><NeridaMark size={22} /></div>
      {!status.server && status.models.some((m) => m.installed) ? (
        <>
          <p className="text-[14px] font-medium text-neutral-100">Nerida's engine is missing</p>
          <p className="mt-1 text-[12.5px] text-neutral-400">
            Your antivirus may have removed <code className="rounded bg-white/[0.08] px-1">llama-server.exe</code>. It's the official llama.cpp engine.
            Add Oceanic's <code className="rounded bg-white/[0.08] px-1">nerida</code> folder to your antivirus exclusions, then download it again (~25 MB).
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-neutral-100">Set up {MODEL_NAMES[model]}</p>
          <p className="mt-1 text-[12.5px] text-neutral-400">
            A one-time download (~{mb((status.models.find((m) => m.id === model)?.installed ? 0 : size) + (status.server ? 0 : 25e6))}). Nerida then runs fully on this PC — your notes never leave it.
          </p>
        </>
      )}
      {prog ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-blue-400 transition-[width]" style={{ width: `${(prog.got / prog.total) * 100}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-neutral-500">
            <span>{prog.label} · {mb(prog.got)} / {mb(prog.total)}</span>
            <button type="button" className="cursor-pointer hover:text-neutral-300" onClick={() => void engine.cancelDownload()}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void run()} className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-400/90 px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-teal-300">
          <Download className="size-3.5" /> Download
        </button>
      )}
      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}

/** The previous model version is still in use: offer the smarter one. Chat keeps working meanwhile. */
function UpdateBanner({ model, size, visionOnly, onDone }: { model: ModelId; size: number; visionOnly: boolean; onDone: () => void }) {
  const dl = useNerida().dl;
  const prog = dl?.model === model ? dl.got / dl.total : null;
  const [err, setErr] = useState("");
  const run = async () => {
    setErr("");
    const e = await downloadModel(model, false, visionOnly);
    setErr(e);
    if (!e) onDone();
  };
  return (
    <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-300/[0.05] p-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <NeridaMark size={18} busy={prog !== null} />
        <p className="min-w-0 flex-1 text-neutral-200">{visionOnly ? "Nerida can now read scanned PDFs. Add vision" : `Nerida got smarter. Update ${MODEL_NAMES[model]}`} ({mb(size)}).</p>
        {prog === null ? (
          <button type="button" onClick={() => void run()} className="cursor-pointer rounded-md bg-sky-400/90 px-2.5 py-1 font-medium text-neutral-950 hover:bg-sky-300">Update</button>
        ) : (
          <button type="button" onClick={() => void engine.cancelDownload()} className="cursor-pointer rounded-md px-2 py-1 text-neutral-400 hover:text-neutral-200">Cancel</button>
        )}
      </div>
      {prog !== null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-sky-300" style={{ width: `${prog * 100}%` }} /></div>}
      {err && <p className="mt-1.5 text-red-300">{err}</p>}
    </div>
  );
}

/** Bottom-right download pill while Settings and chat are closed. Click opens Settings → Nerida. */
export function NeridaDownloadPill({ hidden }: { hidden: boolean }) {
  const { dl, dlWaiting: waiting } = useNerida();
  if (!dl || hidden) return null;
  const pct = Math.round((dl.got / dl.total) * 100);
  return (
    <button type="button" onClick={() => openNeridaSettings()} title="Open Nerida settings"
      className="oc-pop-in fixed bottom-4 right-4 z-50 flex w-56 cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[var(--oc-surface)] px-3 py-2 text-left shadow-xl shadow-black/40">
      <NeridaMark size={18} busy />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-neutral-200">{waiting ? `${dl.label}: waiting for reply…` : `Downloading ${dl.label} · ${pct}%`}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-blue-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}

/** After an engine/model/add-on download: restart the app so Nerida loads it. Mounted once in App. */
export function NeridaRestartDialog() {
  if (useNerida().restart !== "ask") return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 backdrop-blur-sm">
      <div className="oc-pop-in w-80 rounded-2xl border border-white/[0.08] bg-[var(--oc-surface)] p-5 text-center shadow-2xl shadow-black/50">
        <div className="mb-3 grid place-items-center"><NeridaMark size={40} /></div>
        <p className="text-[15px] font-medium text-neutral-100">Nerida AI upgrade ready</p>
        <p className="mt-1 text-[12.5px] text-neutral-400">Restart Oceanic to finish the upgrade.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => nerida.set({ restart: "later" })} className="cursor-pointer rounded-lg px-3 py-1.5 text-[13px] text-neutral-300 hover:bg-white/[0.06]">Later</button>
          <button type="button" onClick={() => void relaunch()} className="cursor-pointer rounded-lg bg-teal-400/90 px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-teal-300">Restart now</button>
        </div>
      </div>
    </div>
  );
}

/** Shown above the chat box after "Later". */
function RestartReminder() {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-teal-300/20 bg-teal-400/[0.06] px-3 py-1.5 text-[12px] text-teal-100">
      <span className="min-w-0 flex-1">Restart Oceanic to finish Nerida's upgrade.</span>
      <button type="button" onClick={() => void relaunch()} className="cursor-pointer rounded px-1.5 font-medium text-teal-300 hover:bg-white/[0.08]">Restart</button>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */
type Step = { label: string; done: boolean };

/** The reply being generated lives outside the panel, so switching tabs or closing the side chat doesn't lose it. */
type Run = { chatId: string | null; busy: boolean; draft: string; steps: Step[]; actions: AgentLog[]; stepsOpen: boolean };
let run: Run = { chatId: null, busy: false, draft: "", steps: [], actions: [], stepsOpen: true };
const runSubs = new Set<() => void>();
const setRun = (p: Partial<Run>) => ((run = { ...run, ...p }), runSubs.forEach((f) => f()));
const upd = <T,>(k: "steps" | "actions" | "draft" | "busy" | "stepsOpen") => (v: T | ((x: T) => T)) =>
  setRun({ [k]: typeof v === "function" ? (v as (x: T) => T)(run[k] as T) : v });
const useRun = () => useSyncExternalStore((f) => (runSubs.add(f), () => void runSubs.delete(f)), () => run);
/** Chats shown in an open panel right now (a reply finishing elsewhere gets a toast). */
const watching = new Map<string, number>();
/** "my note Features to add" → the note whose title words the message uses most (most of its words, at least 2, or the whole title). */
const STOP = new Set(["the", "and", "for", "my", "note", "notes", "page", "with", "about", "from", "this", "that", "what", "tell", "search"]);
const words = (t: string) => t.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];
function namedNote<P extends { id: string; title: string; trashedAt?: number }>(text: string, pages: P[]): P | null {
  const said = new Set(words(text));
  const low = text.toLowerCase();
  let best: P | null = null, top = 0;
  for (const p of pages) {
    if (p.trashedAt || !p.title.trim()) continue;
    const w = [...new Set(words(p.title))];
    const hit = w.filter((x) => said.has(x)).length;
    const whole = low.includes(p.title.trim().toLowerCase()) && p.title.trim().length >= 4 && (w.length > 1 || NOTE_ASK.test(text));
    const score = whole ? 2 : w.length && hit >= Math.min(2, w.length) && hit / w.length >= 0.6 ? hit / w.length : 0;
    if (score > top) (top = score), (best = p);
  }
  return best;
}
/** Asks about the user's own notes. */
const NOTE_ASK = /\b(my|in (the|this|that)|from (the|this|that))\s+(notes?|pages?)\b|\bnotes?\s+(called|named|titled)\b/i;
const WEB_ASK = /\b(search (the )?(web|internet|online)|look (it |this |that )?up|google|news)\b/i;
/** Toast with an "Open" button, shown by App. */
export const NERIDA_DONE = "oc-nerida-done";

/** "/" menu. `note`: needs a note (@ or the open one) before it runs. */
type Cmd = { k: string; label: string; note: boolean; prompt: string; tool?: boolean };
const CMD_ICON: Record<string, typeof X> = { quiz: CircleHelp, flashcards: Layers, summarize: AlignLeft, explain: Lightbulb, review: RotateCcw, plan: CalendarDays, mindmap: Network };
const CMDS: Cmd[] = [
  { k: "quiz", label: "Quiz me on a note", note: true, prompt: "Quiz me: ask 5 questions about the main ideas in my notes. Number them. Don't give the answers." },
  { k: "flashcards", label: "Make flashcards", note: true, prompt: "" },
  { k: "summarize", label: "Summarize a note", note: true, prompt: "Summarize my notes: a one-line overview, then the key points as a short list." },
  { k: "explain", label: "Explain simply", note: true, prompt: "Explain the key ideas in my notes simply, like I'm new to the topic." },
  { k: "review", label: "Review due flashcards", note: false, prompt: "" },
  { k: "plan", label: "Make a study plan", note: false, prompt: "" },
  { k: "mindmap", label: "Make a mindmap", note: false, prompt: "" },
  // Tools group: forces that agent tool on the next send.
  ...TOOLS.map((t) => ({ k: t.name, label: t.name[0].toUpperCase() + t.name.slice(1).replace(/_/g, " "), note: false, prompt: "", tool: true })),
];
const openNewMindmap = () => void createMindmap("").then((id) => (sessionStorage.setItem(MAP_FLAG, id), window.dispatchEvent(new CustomEvent(OPEN_MINDMAP, { detail: id }))));

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

/** Nerida chat. `home` = the full-page Home "Nerida" view; otherwise the in-note side panel. */
/** `pdf`: the open PDF in the reader; its text is the chat's context instead of notes. */
export function NeridaPanel({ pageId, home = false, pdf = null }: { pageId: string | null; home?: boolean; pdf?: { id: string; name: string } | null }) {
  const neridaState = useNerida();
  const { chats, activeId, model, restart } = neridaState;
  const chat = chats.find((c) => c.id === activeId) ?? null;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [notes, setNotes] = useState<ContextNote[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const { busy, steps, stepsOpen, actions, draft, chatId: runChat } = useRun();
  const [setSteps, setStepsOpen, setActions, setDraft] = [upd<Step[]>("steps"), upd<boolean>("stepsOpen"), upd<AgentLog[]>("actions"), upd<string>("draft")];
  const live = busy && runChat === (chat?.id ?? null);
  useEffect(() => {
    if (!chat) return;
    watching.set(chat.id, (watching.get(chat.id) ?? 0) + 1);
    return () => void watching.set(chat.id, (watching.get(chat.id) ?? 1) - 1);
  }, [chat?.id]);
  /** Agent mode: this reply's activity log, live. */
  const [err, setErr] = useState("");
  const [waited, setWaited] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [stuck, setStuck] = useState(true); // follow new text while at the bottom
  const stick = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const [mentions, setMentions] = useState<ContextNote[]>([]);
  const { pages } = usePageDirectory();
  const mentionQuery = /(?:^|\s)@([^\s@]*)$/.exec(input)?.[1];
  const mentionHits = mentionQuery === undefined ? [] : [...pages.values()].filter((p) => (p.title || "Untitled").toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);
  const addMention = (id: string) => {
    const p = pages.get(id);
    setExcluded((s) => { const x = new Set(s); x.delete(id); return x; });
    if (p && !notes.some((n) => n.id === id) && !mentions.some((n) => n.id === id)) setMentions((m) => [...m, { id, title: p.title || "Untitled", icon: p.icon, why: "mention" }]);
    setInput((v) => v.replace(/@[^\s@]*$/, ""));
    if (cmd) pendingCmd.current = cmd.k; // the waiting /command runs once the note lands
  };
  /** Pinned notes are always sent; saved with the chat. */
  const [pinned, setPinned] = useState<string[]>([]);
  /** Notes the workspace search found for what's being typed. */
  const [found, setFound] = useState<ContextNote[]>([]);
  // Context order (= priority when over MAX_NOTES): open note, pinned, @-mentions, found, related. Deleted notes drop out.
  const allNotes: ContextNote[] = [];
  {
    const seen = new Set<string>();
    const meta = (id: string): ContextNote | undefined => { const p = pages.get(id); return p && { id, title: p.title || "Untitled", icon: p.icon, why: "mention" }; };
    const push = (n?: ContextNote) => {
      if (!n || seen.has(n.id) || !pages.has(n.id) || pages.get(n.id)!.trashedAt) return;
      seen.add(n.id);
      allNotes.push({ ...n, pinned: pinned.includes(n.id) });
    };
    notes.filter((n) => n.why === "current").forEach(push);
    pinned.forEach((id) => push(notes.find((n) => n.id === id) ?? mentions.find((n) => n.id === id) ?? found.find((n) => n.id === id) ?? meta(id)));
    mentions.forEach(push);
    found.forEach(push);
    notes.forEach(push);
  }
  const active = allNotes.filter((n) => n.pinned || !excluded.has(n.id));
  /** What the next message sends. */
  const sendList = active.slice(0, MAX_NOTES);
  const setPins = (ids: string[]) => {
    setPinned(ids);
    if (chat) nerida.setPinned(chat.id, ids);
  };
  const togglePin = (id: string) => setPins(pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id]);
  const removeNote = (n: ContextNote) => {
    if (n.pinned) setPins(pinned.filter((x) => x !== n.id));
    if (n.why === "mention") setMentions((m) => m.filter((x) => x.id !== n.id));
    setExcluded((s) => new Set(s).add(n.id));
  };
  const [cmd, setCmd] = useState<Cmd | null>(null);
  // Live workspace search while typing (debounced); kept after sending until the next question.
  useEffect(() => {
    const q = input.trim();
    if (!q) return;
    if (pdf || q.length < 4 || q.startsWith("/") || (cmd && !cmd.note)) return setFound([]);
    const t = setTimeout(() => {
      const skip = new Set(notes.filter((n) => n.why === "current").map((n) => n.id));
      void searchIndex(q, 3, skip, true).then((h) => setFound(h.map((x) => ({ id: x.id, title: x.title, icon: pages.get(x.id)?.icon ?? "", why: "found" as const })))).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [input, pdf, cmd]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note sizes for the picker's token estimate.
  const [, setSized] = useState(0);
  const sendKey = sendList.map((n) => n.id).join();
  useEffect(() => {
    if (sendKey) void refreshIndex(sendKey.split(",")).then(() => setSized((x) => x + 1)).catch(() => {});
  }, [sendKey]);
  const estTokens = Math.round(Math.min(sendList.reduce((s, n) => s + noteChars(n.id), 0), noteBudget(model)) / 4);
  const [pick, setPick] = useState(0);
  const slashQuery = cmd ? undefined : /^\/(\w*)$/.exec(input)?.[1];
  const slashHits = slashQuery === undefined ? [] : CMDS.filter((c) => c.k.startsWith(slashQuery.toLowerCase()));
  /** Runs `c` (now, or once a note is attached). `withNote` = a note just picked for it. */
  /** Study-plan wizard open; a string = exams typed after "/plan". */
  const [planning, setPlanning] = useState<string | boolean>(false);
  /** A note action was asked with Agent mode off: how to run it. */
  const [agentAsk, setAgentAsk] = useState<{ text: string; history: Msg[] } | null>(null);
  /** "Delete this note": which note (when unclear) and an OK, then it goes to Trash. */
  const [delAsk, setDelAsk] = useState<{ text: string; ids: string[] } | null>(null);
  const [asking, setAsking] = useState<{ plan: AskPlan; text: string; history: Msg[]; force?: string; once?: boolean } | null>(null);
  /** The wizard's result as a chat reply (a new chat if none is open). */
  const planDone = (msg: string) => {
    setPlanning(false);
    const base: Chat = chat ?? { id: uid(), title: "Study plan", messages: [], updatedAt: Date.now() };
    nerida.upsert({ ...base, messages: [...base.messages, { role: "user", content: "/plan" }, { role: "assistant", content: msg }], updatedAt: Date.now() });
    nerida.set({ activeId: base.id });
  };
  const runCmd = (c: Cmd, withNote?: string) => {
    const note = withNote ?? sendList[0]?.id;
    setInput("");
    if (c.tool) {
      if (cmd !== c) return setCmd(c); // chip waits for the request text
      setCmd(null);
      return void send(input, undefined, c.k);
    }
    if (c.k === "plan") {
      // Chip waits for what the plan is about ("Maths Dec 5, Bio next Friday"); Enter starts the wizard.
      if (cmd !== c) return setCmd(c);
      setCmd(null);
      return setPlanning(input.trim() || true);
    }
    if (c.note && !note) return setCmd(c); // chip waits for @note
    setCmd(null);
    if (c.k === "mindmap") return openNewMindmap();
    if (c.k === "review") return openReview(withNote);
    if (c.k === "plan") return setPlanning(true);
    if (c.k === "flashcards") return openNeridaCards({ pageId: note! });
    void send(c.prompt);
  };
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (home) void api.getSettings().then((s) => setRecent(JSON.parse(s.recentPages ?? "[]"))).catch(() => {});
  }, [home]);
  const recentNotes = recent.filter((id) => pages.has(id)).slice(0, 5);
  /** Recent-note button: attach the note, then run the command. */
  const quick = (id: string, k: string) => {
    const p = pages.get(id)!;
    setMentions([{ id, title: p.title || "Untitled", icon: p.icon, why: "mention" }]);
    pendingCmd.current = k;
  };
  const pendingCmd = useRef<string | null>(null);
  useEffect(() => {
    const k = pendingCmd.current;
    if (!k || !mentions.length) return;
    pendingCmd.current = null;
    runCmd(CMDS.find((c) => c.k === k)!, mentions[0].id);
  }, [mentions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(0);
  // "Essay due Friday" → confirm card; the chat (with the user's message) it answers into.
  const [task, setTask] = useState<{ draft: TaskDraft; base: Chat } | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  /** Pictures need the Vision add-on; this explains it, with a button to add it. */
  const [needVision, setNeedVision] = useState("");
  /** A chat picture opened in the viewer. */
  const [viewing, setViewing] = useState<string | null>(null);
  const addFiles = async (list: FileList | File[]) => {
    let pics = files.filter((f) => f.thumb).length;
    for (const f of [...list]) {
      const pic = isImageFile(f);
      if (pic && pics >= MAX_IMAGES) {
        setErr(`Up to ${MAX_IMAGES} pictures per message.`);
        continue;
      }
      if (pic && !(await canSeeImages())) {
        setNeedVision("To read pictures, Nerida needs the Vision add-on.");
        continue;
      }
      if (pic) pics++;
      setReading((n) => n + 1);
      try {
        const a: Attachment = pic
          ? { name: f.name || "Pasted picture", text: await readImage(f), truncated: false, thumb: await shrink(f, 240) }
          : await extractFileText(f);
        setFiles((x) => [...x.filter((y) => y.name !== a.name || pic), a]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      setReading((n) => n - 1);
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  // Each chat keeps its own attachments; a new chat starts empty.
  const lastChat = useRef(activeId);
  useEffect(() => {
    if (lastChat.current === null && activeId) return void (lastChat.current = activeId); // first message created this chat
    lastChat.current = activeId;
    setMentions([]);
    setFiles([]);
    setFound([]);
    setExcluded(new Set());
    setPinned(nerida.get().chats.find((c) => c.id === activeId)?.pinned ?? []);
  }, [activeId]);

  const refresh = () =>
    isTauri() ? engine.status().then(setStatus).catch((e) => setErr(String(e))) : setErr("Nerida runs in the Oceanic desktop app.");
  useEffect(() => {
    void refresh();
    // The engine stops itself when idle: re-check so the "asleep" notice stays true.
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Only the open note itself: linked/sub-pages pulled in unrelated notes. Removed notes stay removed.
    if (pageId) void relatedNotes(pageId).then((r) => setNotes(r.filter((n) => n.why === "current")));
    else setNotes([]);
  }, [pageId]);
  // PDF selection bar → "Explain / Summarize / Ask about it".
  /** Plus only: search the web before answering. */
  const [online, setOnline] = useState(false);
  const sendRef = useRef<(t: string) => void>(() => {});
  const pending = usePending();
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<AskDetail>).detail;
      if (d.send) sendRef.current(d.text);
      else setInput(d.text);
    };
    window.addEventListener(NERIDA_ASK, on);
    return () => window.removeEventListener(NERIDA_ASK, on);
  }, []);
  useEffect(() => { if (home) box.current?.focus(); }, [home, activeId]);
  // New message or chat: always follow again.
  useEffect(() => { stick.current = true; setStuck(true); }, [chat?.messages.length, chat?.id]);
  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: 1e9, behavior: draft ? "auto" : "smooth" });
  }, [chat?.messages.length, draft]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setScrolled(el.scrollTop > 4);
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = atEnd;
    setStuck(atEnd);
  };

  const b = builtin(model);
  const ready = b ? !!status?.server && !!status.models.find((m) => m.id === b)?.installed : !!status;
  // First use: the intro popup instead of a bare download card.
  const [auto, setAuto] = useState(false);
  const intro = !!b && !!status && !status.models.some((m) => m.installed) && !auto;

  sendRef.current = (t) => void send(t);
  /** Questions about the open note itself ("this note", "the image", "here"). */
  const ABOUT_OPEN_NOTE = /\b(this|the|that)\s+(note|page)\b|\b(this|the|that|these)\s+(image|picture|photo|pic|screenshot|diagram|chart)s?\b|\b(above|below)\b/i;
  const send = async (text: string, history: Msg[] = chat?.messages ?? [], force?: string, choices?: string, once?: boolean | "no") => {
    if (!text.trim() || busy) return;
    // "/plan Maths Dec 5, Bio Friday": the wizard, with those exams filled in.
    const planArgs = /^\/plan\b\s*([\s\S]*)$/i.exec(text.trim());
    if (planArgs) return (setInput(""), setPlanning(planArgs[1] || true));
    // "Delete this note": the open note, else the attached one; asks which when several, always asks to confirm.
    if (DELETE_NOTE.test(text) && !pdf) {
      const ids = pageId && !home ? [pageId] : sendList.map((n) => n.id);
      if (!ids.length) return setErr("Which note? Open it, or attach it with @, then ask again.");
      return (setInput(""), setDelAsk({ text, ids }));
    }
    // Agent mode off but the message asks to change notes: ask how to run it (edits to the open note have their own path).
    if (once === undefined && choices === undefined && !nerida.get().agent && !force && !pdf && needsTool(text) && !(pageId && !home && isEditRequest(text))) {
      if (autoAgent()) once = true;
      else return (setInput(""), setAgentAsk({ text, history }));
    }
    if (once === "no") once = undefined;
    if (choices === undefined && (nerida.get().agent || force || once) && !pdf) {
      const plan = planAsk(text, agentHost()?.pages() ?? [], pageId && !home ? pageId : null);
      if (plan) return (setInput(""), setAsking({ plan, text, history, force, once: !!once }));
    }
    if (!(await confirmCloud(model))) return;
    setErr("");
    setInput("");
    const base: Chat = chat ?? { id: uid(), title: text.slice(0, 60), messages: [], updatedAt: Date.now(), ...(pinned.length && { pinned }) };
    const pics = files.flatMap((f) => (f.thumb ? [f.thumb] : []));
    const messages: Msg[] = [...history, { role: "user", content: text, ...(pics.length && { images: pics }) }];
    nerida.upsert({ ...base, messages, updatedAt: Date.now() });
    const draft = detectTask(text);
    if (draft) return setTask({ draft, base: { ...base, messages } });
    setRun({ busy: true, chatId: base.id });
    setDraft("");
    setWaited(0);
    setStepsOpen(true);
    let used = sendList, first = false;
    // Built-in engine: cold start and the wait for the first token are normal on slow PCs.
    // Only silence after the first token counts (2 min); cloud/Ollama keep the 30 s watchdog.
    let last = Date.now(), stalled = false, loading = false; // loading: model start can take long, not a stall
    const began = Date.now();
    const bump = () => void (last = Date.now());
    const watch = setInterval(() => {
      if (loading || stalled) return;
      const quiet = Date.now() - last;
      if (!b) { if (quiet > 30000) (stalled = true, void engine.stop()); return; }
      if (first) { if (quiet > 120000) (stalled = true, void engine.stop()); }
      else setWaited(Math.floor((Date.now() - began) / 1000));
    }, 2000);
    const mark = (label: string) => (bump(), setSteps((s) => (s[s.length - 1]?.label === label ? s : [...s.map((x) => ({ ...x, done: true })), { label, done: false }])));
    setSteps([]);
    let reply = "";
    // Deep: thinking streams to onThink; kept on the message as a collapsed "Thought for Xs".
    let thought = "";
    const t0 = Date.now();
    let thoughtSecs = 0;
    const onThink = (t: string) => {
      if (stalled) return;
      bump(); first = true; setWaited(0);
      if (!thought) mark("Thinking");
      thought = t;
      thoughtSecs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    };
    let garbled = false;
    const book = new SourceBook();
    // "Edit my note": changes go into the note as highlighted suggestions, not into the chat.
    // Fast path: even in Agent mode, edits to the open note use this one-call path (the agent loop takes several model calls).
    const blocks = !pdf && pageId && !home && isEditRequest(text) ? targetBlocks(noteBlocks(), text) : [];
    const agentOn = (nerida.get().agent || !!force || !!once) && !pdf && !blocks.length;
    let log: AgentLog[] = [];
    setActions([]);
    try {
      if (!agentOn && !blocks.length && isEditRequest(text) && !pdf && (!pageId || home)) {
        reply = "Open the note in the editor and ask me there: I can only change the note that's open next to this chat.";
        throw null;
      }
      // "Mark the incomplete ones as done": tick every open item at once, no model call.
      const all = blocks.length ? markAllDone(text, blocks) : null;
      if (all) {
        const n = proposeEdits(all);
        reply = n ? `I've marked ${n} item${n > 1 ? "s" : ""} as done, highlighted in blue. They're **pending**: accept or reject them in the note, or with the buttons below.` : "Everything in this note is already marked done.";
        throw null;
      }
      if (blocks.length) {
        if (b) {
          if (status?.running !== b) mark("Starting Nerida…");
          loading = true;
          await engine.start(b).finally(() => ((loading = false), bump()));
        }
        mark("Editing your note");
        let raw = "";
        await engine.chat(model, [{ role: "system", content: EDIT_SYSTEM }, { role: "user", content: editPrompt(blocks, text) }], (t) => (bump(), (first = true), (raw += t)), onThink);
        const proposals = parseEdits(raw, blocks);
        const n = proposeEdits(proposals);
        const warn = n ? proposalWarning(proposals, blocks) : "";
        reply = n
          ? `I've made ${n} change${n > 1 ? "s" : ""} to your note, highlighted in blue. They're **pending**: accept or reject them in the note, or with the buttons below.` +
            (warn ? `\n\n⚠️ ${warn}` : "")
          : ASK_WHICH;
        setSteps((s) => s.map((x) => ({ ...x, done: true })));
        throw null; // skip the normal answer; reply is saved below
      }
      let context = "";
      const tools = await runTools(text);
      if (tools) mark("Working it out");
      // "this note / the picture / here": only the open note, no other notes from the search.
      const local = !!pageId && !home && ABOUT_OPEN_NOTE.test(text);
      if (local) used = used.filter((n) => n.why !== "found");
      // A note named in the message: read it first (whole, when it fits).
      const named = !pdf ? namedNote(text, [...pages.entries()].map(([id, p]) => ({ ...p, id }))) : null;
      const noteAsk = !pdf && (!!named || NOTE_ASK.test(text));
      if (named && !used.some((n) => n.id === named.id)) {
        mark(`Reading “${named.title}”`);
        used = [{ id: named.id, title: named.title || "Untitled", icon: named.icon, why: "mention" as const, pinned: true }, ...used].slice(0, MAX_NOTES);
      }
      // Search every note for the exact question (the live search may lag the last keystrokes); removed notes stay out.
      if (!pdf && !files.length && !local && !isFeaturesQuestion(text)) {
        const hits = await searchIndex(text, 3, new Set([...used.map((n) => n.id), ...excluded]), true).catch(() => []);
        const extra = hits.map((h) => ({ id: h.id, title: h.title, icon: pages.get(h.id)?.icon ?? "", why: "found" as const }));
        if (extra.length) {
          mark(`Searching all notes: found ${extra.length}`);
          used = [...used, ...extra].slice(0, MAX_NOTES);
          setFound((f) => [...f, ...extra.filter((x) => !f.some((y) => y.id === x.id))]);
        }
      }
      if (used.length) {
        // Pictures in these notes: read once with Vision (saved), then they're note text.
        const ids = used.map((n) => n.id);
        const unread = await unreadImages(ids);
        if (unread.length && (await canSeeImages())) {
          if (await readNoteImages(ids, (n, total) => mark(`Reading picture ${n} of ${total}`))) forgetIndex(ids);
        } else if (unread.length) setNeedVision(`${unread.length} picture${unread.length > 1 ? "s" : ""} in your notes can't be read without the Vision add-on.`);
        mark(`Reading ${used.slice(0, 2).map((n) => n.title || "Untitled").join(", ")}${used.length > 2 ? ` +${used.length - 2}` : ""}`);
        const c = await buildContext(used, text, book);
        context = c.text;
        mark(`Found ${c.parts} relevant part${c.parts === 1 ? "" : "s"}`);
      }
      if (pdf) {
        const name = pdfNames.get(pdf.id) ?? pdf.name; // the reader fills pdfNames once the PDF loads
        mark(`Reading ${name}`);
        // Scanned pages: the vision add-on reads each page once (saved), then they're normal text.
        const range = pageRange(text);
        if (b && status?.vision) await readScanned(pdf.id, (n, total) => mark(`Reading scanned page ${n} of ${total}`), range?.[0], range?.[1]);
        // "Summarize": every page (or the named range), in parts, then combined, so nothing is skipped.
        if (/\bsumm?ar/i.test(text)) {
          if (range) mark(`Pages ${range[0]}–${range[1]}`);
          reply = await summarizePdf(pdf.id, range?.[0] ?? 1, range?.[1] ?? Infinity, false, (label, t) => (mark(label), setDraft(t)));
          setSteps((s) => s.map((x) => ({ ...x, done: true })));
          throw null; // reply is saved below
        }
        const c = await pdfContext(pdf.id, name, text, range?.[0], range?.[1], book);
        if (range) mark(`Pages ${range[0]}–${range[1]}`);
        if (!c.parts) mark(b && !status?.vision ? "This PDF is scanned: add Nerida vision to read it" : "No text in this PDF");
        else if (c.parts) mark(`Found ${c.parts} relevant page${c.parts === 1 ? "" : "s"}`);
        garbled = c.garbled;
        context = [context, c.text].filter(Boolean).join("\n\n");
      }
      if (files.length) {
        mark(`Reading ${files.length} file${files.length > 1 ? "s" : ""}`);
        context = [context, attachmentsContext(files, book, text)].filter(Boolean).join("\n\n");
      }
      // Notes first: a question about notes searches the web only when asked, or (web on) when it needs outside facts.
      if (noteAsk ? WEB_ASK.test(text) || (online && b === "plus" && /\b(compare|versus|vs\.?|online|internet|current(ly)?|today)\b/i.test(text)) : (online && b === "plus") || WEB_ASK.test(text) || /\blatest\b/i.test(text)) {
        mark("Searching the web");
        try {
          const hits = await searchWeb(text);
          const web = hits.map((h) => book.add("web", h.label, h.text)).filter(Boolean);
          if (web.length) context = [context, ...web].filter(Boolean).join("\n\n");
          mark(web.length ? `Read ${web.length} web source${web.length === 1 ? "" : "s"}` : "No web results");
        } catch {
          mark("Couldn't reach the web");
        }
      }
      if (b) {
        if (status?.running !== b) mark("Starting Nerida…");
        loading = true;
          await engine.start(b).finally(() => ((loading = false), bump()));
        void refresh();
      }
      if (agentOn) {
        mark(b ? "Working on it" : `Asking ${modelLabel(model)}`);
        const open = pageId && !home ? ` The note open next to this chat has id ${pageId}.` : "";
        reply = await runAgent({
          model,
          messages: [{ role: "system", content: AGENT_SYSTEM + open }, ...trimHistory(history).msgs, { role: "user", content: [context && `Reference material:\n${context}\n\n(${book.rules()})`, tools, `My request: ${text}`, choices, force && `Call the ${force} tool first.`].filter(Boolean).join("\n\n") }],
          force,
          allow: once && !nerida.get().agent ? AUTO_TOOLS : undefined,
          onText: (t) => { if (stalled) return; bump(); first = true; setWaited(0); reply = t; setDraft(t); },
          onLog: (l) => ((log = [...log, l]), setActions(log)),
          onStep: mark,
          onThink,
        });
        if (!reply && log.length) reply = "Done.";
        setSteps((s) => s.map((x) => ({ ...x, done: true })));
        setStepsOpen(false);
        throw null; // reply is saved below
      }
      mark(b ? "Writing answer" : `Asking ${modelLabel(model)}`);
      await engine.chat(model, [{ role: "system", content: SYSTEM }, ...trimHistory(history).msgs, { role: "user", content: isFeaturesQuestion(text) ? text : withNotes(text, context, book, tools) }], (t) => {
        if (stalled) return;
        bump(); first = true; setWaited(0);
        reply += t;
        setDraft(reply);
      }, onThink);
      setSteps((s) => s.map((x) => ({ ...x, done: true })));
      setStepsOpen(false);
    } catch (e) {
      if (e !== null) setErr(String(e)); // null = note edit finished early
    }
    clearInterval(watch);
    if (stalled) (setErr(b ? "Nerida stopped: no output for 2 minutes. Try again." : "Nerida stopped: nothing happened for 30 seconds. Try again, or turn on Agent mode for note changes."), (reply = ""));
    engine.halted = false; // clear here, not on send: Nerida in docs, maps and PDFs shares the engine
    if (reply && garbled) reply += GARBLED_NOTE;
    if (reply) reply += book.footer(reply);
    const sources = book.refs();
    if (!reply && log.length) reply = "Stopped.";
    const sent = used.length ? messages.map((m, j) => j === messages.length - 1 ? { ...m, notes: used.map(({ id, title, icon }) => ({ id, title, icon })) } : m) : messages;
    if (reply) nerida.upsert({ ...base, pinned: nerida.get().chats.find((c) => c.id === base.id)?.pinned ?? base.pinned, messages: [...sent, { role: "assistant", content: reply, ...(thought && { thought, thoughtSecs }), ...(sources.length && { sources }), ...(log.length && { actions: log }) }], updatedAt: Date.now() }, true, nerida.get().activeId === base.id);
    else if (sent !== messages) nerida.upsert({ ...base, messages: sent, updatedAt: Date.now() }, true, nerida.get().activeId === base.id);
    setRun({ busy: false, chatId: null, actions: [], draft: "" });
    setWaited(0);
    if (reply && !watching.get(base.id)) window.dispatchEvent(new CustomEvent(NERIDA_DONE, { detail: { id: base.id, title: base.title } }));
  };

  const retry = () => {
    if (!chat || busy) return;
    const lastUser = chat.messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    void send(chat.messages[lastUser].content, chat.messages.slice(0, lastUser));
  };


  const msgs = chat?.messages ?? [];
  // Built-in engine not running (never started, or stopped when idle): the first reply waits for it to load.
  const asleep = ready && !!b && !!status && status.running !== b && !busy && !neridaState.warming;
  const composer = (
      <div className="relative">
        {asleep && !home && <p className="mb-1.5 flex items-center gap-1.5 px-1.5 text-[11px] text-neutral-500"><span className="size-1.5 rounded-full bg-teal-300/50" />Nerida is asleep to save memory. First reply takes a few seconds.</p>}
        <input ref={filePicker} type="file" multiple accept={ATTACH_ACCEPT} className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative oc-nl-composer flex flex-col gap-0.5 rounded-[14px] border border-white/[0.09] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-1.5 shadow-lg shadow-black/20 transition-[border-color,box-shadow] duration-300 focus-within:border-teal-300/35 focus-within:shadow-[0_0_0_3px_rgba(45,212,191,0.08),0_10px_30px_-10px_rgba(0,0,0,0.5)]">
        <DeepSparkles typing={input} />
        {(files.length > 0 || reading > 0) && (
          <div className="mb-1 flex flex-wrap gap-1">
            {files.map((f, i) => f.thumb ? (
              <span key={i} className="oc-chip-in group relative size-14 overflow-hidden rounded-lg border border-white/10 shadow-sm">
                <button type="button" title={`${f.name}: click to view`} onClick={() => setViewing(f.thumb!)} className="block size-full cursor-zoom-in"><img src={f.thumb} alt={f.name} className="size-full object-cover" /></button>
                <button type="button" title="Remove" onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="absolute right-0.5 top-0.5 grid size-4 cursor-pointer place-items-center rounded-full bg-black/70 text-neutral-200 opacity-0 transition-opacity hover:bg-black group-hover:opacity-100"><X className="size-3" /></button>
              </span>
            ) : (
              <span key={i} title={f.truncated ? "Long file: only the first part is used" : f.name} className="oc-chip-in flex max-w-[180px] items-center gap-1 rounded-full border border-sky-300/20 bg-sky-300/[0.05] px-1.5 py-0.5 text-[11.5px] text-neutral-300">
                <FileText className="size-3 shrink-0 text-sky-300" /><span className="truncate">{f.name}</span>
                <button type="button" title="Remove" className="cursor-pointer text-neutral-500 hover:text-neutral-200" onClick={() => setFiles((x) => x.filter((y) => y !== f))}><X className="size-3" /></button>
              </span>
            ))}
            {reading > 0 && <span className="oc-nerida-shimmer self-center px-1.5 py-0.5 text-[11.5px]">Reading…</span>}
          </div>
        )}
        {needVision && (
          <div className="oc-fade-in mb-1 flex items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.06] px-2.5 py-2 text-[12px] text-neutral-300">
            <span className="flex-1">{needVision}</span>
            <button type="button" disabled={!!neridaState.dl} onClick={() => void downloadVision().then((e) => (e ? setErr(e) : (setNeedVision(""), void refresh())))} className="shrink-0 cursor-pointer rounded-lg bg-sky-500/90 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-sky-400 disabled:opacity-50">{neridaState.dl ? "Downloading…" : "Add Vision (668 MB)"}</button>
            <button type="button" title="Dismiss" onClick={() => setNeedVision("")} className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-3.5" /></button>
          </div>
        )}
        <ContextPicker notes={active} sendCount={sendList.length} tokens={estTokens} cloud={isCloud(model) ? modelLabel(model) : null}
          onPin={togglePin} onRemove={removeNote} onAdd={addMention} />
        {agentAsk && (
          <NeridaAskBox key={"agent:" + agentAsk.text} title="Agent mode" onCancel={() => (setAgentAsk(null), setInput(agentAsk.text))}
            questions={[{
              id: "how", header: "Tools", other: false, skipTo: [AGENT_CHOICES[0]],
              question: "This needs Agent mode to change your notes. How should I do it?",
              options: [
                { label: AGENT_CHOICES[0], description: "Use note tools for this message only. You approve every change.", recommended: true },
                { label: AGENT_CHOICES[1], description: "Same, and don't show this again." },
                { label: AGENT_CHOICES[2], description: "Keep Agent mode on for later messages too." },
                { label: AGENT_CHOICES[3], description: "Just reply in chat; nothing in your notes changes." },
              ],
            }]}
            onDone={(a) => {
              const x = agentAsk, pick = a.how?.[0] ?? AGENT_CHOICES[0];
              setAgentAsk(null);
              if (pick === AGENT_CHOICES[1]) try { localStorage.setItem(AUTO_AGENT, "once"); } catch { /* ignore */ }
              if (pick === AGENT_CHOICES[2]) nerida.setAgent(true);
              void send(x.text, x.history, undefined, undefined, pick === AGENT_CHOICES[3] ? "no" : pick === AGENT_CHOICES[2] ? "no" : true);
            }} />
        )}
        {delAsk && (() => {
          const notes = delAsk.ids.map((id) => ({ id, title: pages.get(id)?.title || "Untitled" }));
          const one = notes.length === 1;
          return (
            <NeridaAskBox key={"del:" + delAsk.ids.join()} title="Delete note" onCancel={() => (setDelAsk(null), setInput(delAsk.text))}
              questions={[{
                id: "note", header: "Delete", other: false,
                question: one ? `Move “${notes[0].title}” to Trash? You can restore it from Trash.` : "Which note should go to Trash? You can restore it from Trash.",
                options: one ? [{ label: "Move to Trash", recommended: true }, { label: "Cancel" }] : [...notes.map((n) => ({ label: n.title })), { label: "Cancel" }],
              }]}
              onDone={(a) => {
                const pick = a.note?.[0], d = delAsk;
                setDelAsk(null);
                const n = one ? (pick === "Move to Trash" ? notes[0] : null) : notes.find((x) => x.title === pick);
                if (!n) return setInput(d.text);
                agentHost()?.trash(n.id);
                const base: Chat = chat ?? { id: uid(), title: d.text.slice(0, 60), messages: [], updatedAt: Date.now() };
                nerida.upsert({ ...base, messages: [...base.messages, { role: "user", content: d.text }, { role: "assistant", content: `Moved **${n.title}** to the Trash. You can restore it from there.` }], updatedAt: Date.now() });
              }} />
          );
        })()}
        {asking && <NeridaAskBox key={asking.text} title={asking.plan.title} questions={asking.plan.questions} onCancel={() => (setAsking(null), setInput(asking.text))}
          onDone={(a) => { const x = asking; setAsking(null); void send(x.text, x.history, x.force, choicesLine(x.plan, a), x.once || "no"); }} />}
        {planning && <StudyPlanWizard typed={typeof planning === "string" ? planning : ""} pages={agentHost()?.pages() ?? []} onClose={() => setPlanning(false)} onMade={planDone} />}
        {(mentionHits.length > 0 || slashHits.length > 0) && (
          <div className="oc-menu-pop absolute bottom-full left-0 z-20 mb-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-white/[0.08] bg-neutral-900/95 p-1 shadow-2xl shadow-black/50 backdrop-blur">
            {slashHits.map((c, i) => (<Fragment key={c.k}>
              {c.tool && !slashHits[i - 1]?.tool && <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-neutral-500">Tools</div>}
              <button key={c.k} type="button" onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); runCmd(c); }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] ${i === pick % slashHits.length ? "bg-white/[0.07] text-neutral-100" : "text-neutral-300"}`}>
                <span className="w-[86px] font-mono text-[12px] text-teal-300">/{c.k}</span>
                <span className="flex-1 truncate">{c.label}</span>
                {i === pick % slashHits.length && <span className="text-[11px] text-neutral-500">⏎</span>}
              </button>
            </Fragment>))}
            {mentionHits.map((p, i) => (
              <button key={p.id} type="button" onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); addMention(p.id); }}
                className={`flex w-full cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] ${i === pick % mentionHits.length ? "bg-white/[0.07] text-neutral-100" : "text-neutral-300"}`}>
                <span>{p.icon}</span><span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
          <div className="flex flex-col items-start gap-1">
          {cmd && (() => { const Icon = cmd.tool ? Wrench : CMD_ICON[cmd.k] ?? Wrench; return (
            <span className="oc-glass-inset oc-chip-in mx-1 mt-1 flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1.5 text-[12px] font-medium text-teal-200">
              <Icon className="size-3.5 text-teal-300" />{cmd.label}
              <button type="button" title="Cancel" onClick={() => setCmd(null)} className="cursor-pointer text-teal-300/70 hover:text-teal-100"><X className="size-3" /></button>
            </span>
          ); })()}
          <textarea
            ref={box}
            value={input}
            disabled={!ready}
            onChange={(e) => { setInput(e.target.value); setPick(0); }}
            onPaste={(e) => {
              const pics = [...e.clipboardData.files].filter(isImageFile);
              if (pics.length) (e.preventDefault(), void addFiles(pics));
            }}
            onKeyDown={(e) => {
              const hits = slashHits.length || mentionHits.length;
              if (hits && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : hits - 1)) % hits);
              } else if (e.key === "Escape" && (hits || cmd)) {
                e.preventDefault();
                if (cmd) setCmd(null); else setInput("");
              } else if (e.key === "Backspace" && cmd && !input) {
                setCmd(null);
              } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && slashHits.length) {
                e.preventDefault();
                runCmd(slashHits[pick % slashHits.length]);
              } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && mentionHits.length) {
                e.preventDefault();
                addMention(mentionHits[pick % mentionHits.length].id);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (cmd) runCmd(cmd); else void send(input);
              }
            }}
            rows={Math.min(6, input.split("\n").length)}
            placeholder={!isTauri() ? "Open the Oceanic desktop app to chat" : !ready ? "Download Nerida to start" : cmd?.tool ? "Say what it should do…" : cmd?.k === "plan" ? "What should the plan cover? e.g. Maths Dec 5, Biology next Friday" : cmd ? "Type @ to pick a note" : "Ask Nerida anything…"}
            className="scrollbar-thin max-h-40 min-h-[34px] w-full resize-none overflow-y-auto bg-transparent px-1.5 pt-1 text-[13.5px] text-neutral-100 outline-none placeholder:text-neutral-500 [&::placeholder]:overflow-hidden [&::placeholder]:text-ellipsis [&::placeholder]:whitespace-nowrap"
          />
          </div>
          <div className="flex items-center gap-1">
          <button type="button" disabled={!ready || busy} title="Attach pictures, PDF, Word or text files" onClick={() => filePicker.current?.click()} className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:text-neutral-600"><Paperclip className="size-4" /></button>
          {b === "plus" && <button type="button" disabled={busy} title={online ? "Web search on" : "Search the web"} aria-pressed={online} onClick={() => setOnline((v) => !v)} className={`grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-white/[0.06] ${online ? "text-sky-400" : "text-neutral-400 hover:text-neutral-200"}`}><Globe className="size-4" /></button>}
          <div className="flex-1" />
          <ModelMenu disabled={busy} agent={!pdf} />
          <EffortButton disabled={busy} compact={!home} />
          {/* One button: the arrow morphs into a stop square while Nerida answers. */}
          <button type="button" title={busy ? "Stop" : "Send"} data-busy={busy || undefined} disabled={!busy && (!(input.trim() || cmd) || !ready)}
            onClick={() => (busy ? (stopAgent(), (engine.halted = true), void engine.stop()) : cmd ? runCmd(cmd) : void send(input))}
            className="oc-send oc-send-morph relative grid size-7 cursor-pointer place-items-center rounded-lg bg-teal-400/90 text-neutral-950 transition-[transform,background-color] hover:bg-teal-300 active:scale-90 disabled:cursor-default disabled:bg-white/[0.08] disabled:text-neutral-500 data-[busy]:bg-white/[0.1] data-[busy]:text-neutral-200">
            <ArrowUp className="oc-send-arrow absolute size-4" />
            <Square className="oc-send-stop absolute size-3" fill="currentColor" />
          </button>
          </div>
        </div>
        {ready && !home && <p className="oc-nl-hint mt-1 flex justify-between px-1 text-[10.5px] text-neutral-600">
          <span><kbd className="text-neutral-400">/</kbd> for actions · <kbd className="text-neutral-400">@</kbd> to add a note</span>
          {neridaState.warming && !busy && <span className="oc-nerida-shimmer">Getting ready…</span>}
        </p>}
      </div>
  );
  const lastAssistant = msgs.map((m) => m.role).lastIndexOf("assistant");

  return (
    <>
    {viewing && <ImageAnnotator url={viewing} name="Picture in chat" readOnly onSave={() => {}} onClose={() => setViewing(null)} />}
    <aside
      onDragOver={(e) => { if (ready && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { if (!ready || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); void addFiles(e.dataTransfer.files); }}
      className={home ? "oc-nerida oc-nerida-home oc-page-in oc-main-aura relative flex h-full w-full flex-col" : "oc-nerida oc-nerida-in oc-glass-panel relative m-2 flex h-[calc(100%-16px)] w-[360px] shrink-0 flex-col overflow-hidden rounded-[20px]"}>
      {/* header */}
      {home ? (
        <div className="h-12 shrink-0" />
      ) : (
      <div data-scrolled={scrolled || undefined} className="oc-glass absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 px-3">
        <NeridaMark busy={busy} size={24} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-100">{chat?.title ?? "Nerida"}</span>
        <button type="button" title="Chat history" aria-expanded={historyOpen} onClick={() => { setHistoryOpen((o) => !o); setQ(""); }} className={`grid size-7 cursor-pointer place-items-center rounded-md hover:bg-white/[0.06] hover:text-neutral-200 ${historyOpen ? "bg-white/[0.08] text-neutral-100" : "text-neutral-400"}`}><History className="size-4" /></button>
        <button type="button" title="New chat" disabled={busy} onClick={() => nerida.set({ activeId: null })} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"><Plus className="size-4" /></button>
        <button type="button" title="Close (Ctrl+J)" onClick={() => nerida.set({ open: false })} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"><X className="size-4" /></button>
        {historyOpen && (
          <div className="oc-glass-menu oc-menu-pop absolute right-3 top-12 z-20 flex max-h-96 w-72 flex-col rounded-xl p-1">
            <label className="mb-1 flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1.5">
              <Search className="size-3.5 text-neutral-500" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-neutral-100 outline-none placeholder:text-neutral-500" />
            </label>
            <div className="scrollbar-thin min-h-0 overflow-y-auto">
            {(() => { const hits = chats.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase())); return hits.length === 0 ? <p className="px-2 py-1.5 text-[12.5px] text-neutral-500">{chats.length ? "No matches" : "No chats yet"}</p> : chatGroups(hits).map(([group, list]) => (
              <div key={group}>
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-neutral-500">{group}</p>
                {list.map((c) => (
                  <div key={c.id} className={`group relative flex items-center gap-2 rounded-lg px-2 hover:bg-white/[0.06] ${c.id === activeId ? "bg-teal-400/[0.08] text-teal-100 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-teal-300" : "text-neutral-300"}`}>
                    <MessageSquare className={`size-3.5 shrink-0 ${c.id === activeId ? "text-teal-300" : "text-neutral-500"}`} />
                    {renaming === c.id ? (
                      <input autoFocus defaultValue={c.title} onBlur={(e) => { const t = e.target.value.trim(); if (t) nerida.upsert({ ...c, title: t }); setRenaming(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
                        className="min-w-0 flex-1 rounded bg-white/[0.06] px-1 py-1 text-[12.5px] text-neutral-100 outline-none" />
                    ) : (
                      <button type="button" onClick={() => { nerida.set({ activeId: c.id }); setHistoryOpen(false); }} className="min-w-0 flex-1 cursor-pointer truncate py-1.5 text-left text-[12.5px]">{c.title}</button>
                    )}
                    <span className="shrink-0 text-[11px] text-neutral-500 group-hover:hidden">{ago(c.updatedAt)}</span>
                    <button type="button" title="Rename" onClick={() => setRenaming(c.id)} className="hidden cursor-pointer text-neutral-500 hover:text-neutral-200 group-hover:block"><Pencil className="size-3.5" /></button>
                    <button type="button" title="Delete chat" onClick={() => nerida.remove(c.id)} className="hidden cursor-pointer text-neutral-500 hover:text-red-400 group-hover:block"><X className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            )); })()}
            </div>
          </div>
        )}
      </div>
      )}

      {/* conversation */}
      <div ref={scroller} onScroll={onScroll} onWheel={(e) => e.deltaY < 0 && ((stick.current = false), setStuck(false))} className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3 ${home ? "" : "pt-12"}`}>
      <div className={home ? "mx-auto w-full max-w-3xl" : ""}>
        {intro && (
          <NeridaIntro
            onLater={() => nerida.set(home ? { homeMode: "home" } : { open: false })}
            onDownload={(m) => { setDefaultModel(`nerida:${m}`); setAuto(true); }}
          />
        )}
        {b && status && !ready && !intro && <Setup key={b} status={status} model={b} auto={auto} onDone={() => void refresh()} />}
        {b && ready && status && (() => {
          const m = status.models.find((x) => x.id === b)!;
          const vis = status.vision || nerida.get().noVision; // deleted on purpose: no nagging
          return (m.outdated || !vis) && <UpdateBanner model={b} visionOnly={!m.outdated} size={(m.outdated ? m.size : 0) + (vis ? 0 : 668_227_264)} onDone={() => void refresh()} />;
        })()}
        {ready && !msgs.length && !busy && home && (
          <div className="oc-stagger mx-auto mt-[12vh] max-w-xl">
            <div className="mb-4 grid place-items-center"><NeridaMark size={64} /></div>
            <p className="text-center text-[28px] font-semibold tracking-tight text-neutral-100">{greeting()}</p>
            <p className="mt-1 text-center text-[15px] text-neutral-400">How can Nerida help you today?</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {["Help me plan my study week", "Explain a concept simply"].map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="oc-glass-inset cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] text-neutral-300 hover:text-teal-100">✦ {s}</button>
              ))}
            </div>
            {recentNotes.length > 0 ? (
              <>
                <p className="mb-1.5 mt-10 px-2 text-[11.5px] font-semibold uppercase tracking-wider text-neutral-500">Start from a recent note</p>
                {recentNotes.map((id) => {
                  const p = pages.get(id)!;
                  return (
                    <div key={id} className="oc-tilt oc-glass-inset group mb-1.5 flex items-center gap-2.5 rounded-xl px-3 py-2">
                      <span className="w-5 text-center">{p.icon || "📄"}</span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-neutral-200">{p.title || "Untitled"}</span>
                      {(["quiz", "summarize"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => quick(id, k)} className="cursor-pointer rounded-full border border-white/[0.08] px-2.5 py-0.5 text-[12px] text-neutral-400 transition-colors hover:border-teal-300/40 hover:bg-teal-400/10 hover:text-teal-200">
                          {k === "quiz" ? "Quiz" : "Summary"}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="mt-10 text-center text-[13px] text-neutral-500">Type <kbd className="text-neutral-300">/</kbd> below to quiz, summarize or explain a note.</p>
            )}
          </div>
        )}
        {ready && !msgs.length && !busy && !home && (
          <div className="oc-stagger mt-12 text-center">
            <div className="relative mx-auto mb-4 grid w-fit place-items-center"><div className="absolute inset-0 -z-10 scale-150 rounded-full bg-teal-400/20 blur-2xl" /><NeridaMark size={64} /></div>
            <p className="bg-gradient-to-r from-teal-200 via-sky-200 to-teal-100 bg-clip-text text-[19px] font-semibold tracking-tight text-transparent">How can I help?</p>
            <p className="oc-nl-hint mt-1 text-[12.5px] text-neutral-500">Ask about this note, or pick a start.</p>
            <div className="mt-6 flex flex-col gap-2">
              {(pdf ? ["Summarize this PDF", "What are the key ideas?", "Explain the hardest part simply"] : pageId ? ["Summarize this note", "Explain the key ideas simply", "Make flashcards from this note"] : ["Help me plan my study week", "Explain a concept simply"]).map((s) => (
                <button key={s} type="button" onClick={() => (s.startsWith("Make flashcards") && pageId ? openNeridaCards({ pageId }) : void send(s))} className="oc-nl-card group flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-left text-[13px] text-neutral-300 shadow-sm shadow-black/20 transition-colors hover:border-teal-300/30 hover:bg-teal-400/[0.07] hover:text-teal-100"><span className="text-teal-300/70 group-hover:text-teal-300">✦</span><span className="flex-1">{s}</span><ArrowUp className="size-3.5 rotate-45 text-neutral-600 group-hover:text-teal-300" /></button>
              ))}
            </div>
          </div>
        )}
        {trimHistory(msgs, model).cut > 0 && <p className="text-center text-[11.5px] text-neutral-500">Earlier messages summarized to keep Nerida fast</p>}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="oc-msg-in oc-msg-user mt-5 flex flex-col items-end">{m.images?.length ? <div className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">{m.images.map((src, j) => <button key={j} type="button" title="View picture" onClick={() => setViewing(src)} className="size-20 cursor-zoom-in overflow-hidden rounded-xl border border-white/10 shadow-md shadow-black/20"><img src={src} alt="" className="size-full object-cover" /></button>)}</div> : null}{m.notes?.length ? <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">{m.notes.slice(0, 2).map((n, j) => <span key={j} title={n.title} className="oc-nl-chip flex max-w-[150px] items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-neutral-300"><span>{n.icon}</span><span className="truncate">{n.title}</span></span>)}{m.notes.length > 2 && <span className="oc-nl-chip rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-400">+{m.notes.length - 2} notes</span>}</div> : null}<div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-teal-300/20 bg-gradient-to-br from-teal-400/[0.18] to-sky-400/[0.08] px-4 py-2.5 text-[13.5px] leading-relaxed text-neutral-100 shadow-md shadow-black/20">{m.content}</div><div className="mt-1 mr-1 flex justify-end text-neutral-500"><Act title="Copy" onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1200); }}>{copied === i ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Act></div></div>
          ) : (
            <div key={i} className="group oc-msg-in mt-5 flex gap-2.5">
              <div className="mt-1 shrink-0"><NeridaMark size={20} /></div>
              <div className="min-w-0 flex-1 leading-relaxed">
              <div className="oc-reply w-fit max-w-full rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.035] px-3 py-2 shadow-md shadow-black/20">
                {m.thought && <ThoughtLine thought={m.thought} secs={m.thoughtSecs ?? 0} />}
                {m.actions?.length ? <AgentLogList actions={m.actions} onChange={(a) => chat && nerida.upsert({ ...chat, messages: chat.messages.map((x, j) => (j === i ? { ...x, actions: a } : x)) })} /> : null}
                <div className="oc-selectable"><Markdown text={m.content} sources={m.sources} /></div>
              </div>
              <div className={`mt-1 ml-1 flex gap-0.5 text-neutral-500 transition-opacity group-hover:opacity-100 ${i === lastAssistant ? "" : "opacity-0"}`}>
                <Act title="Copy" onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1200); }}>{copied === i ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Act>
                {pageId && <Act title="Insert into note" onClick={() => window.dispatchEvent(new CustomEvent("oc-nerida-insert", { detail: neridaSafeMarkdown(m.content) }))}><FileInput className="size-3.5" /></Act>}
                {i === lastAssistant && <Act title="Retry" onClick={retry}><RotateCcw className="size-3.5" /></Act>}
                {i === lastAssistant && pending.count > 0 && (
                  <span className="ml-2 flex gap-1 text-[12px]">
                    <button type="button" className="cursor-pointer rounded px-1.5 text-emerald-300 hover:bg-white/[0.08]" onClick={() => pending.accept()}>Accept all</button>
                    <button type="button" className="cursor-pointer rounded px-1.5 text-rose-300 hover:bg-white/[0.08]" onClick={() => pending.reject()}>Reject all</button>
                  </span>
                )}
              </div>
              </div>
            </div>
          ),
        )}
        {task && task.base.id === chat?.id && (
          <NeridaTaskCard key={task.base.messages.length} draft={task.draft} pageId={pageId} pageTitle={notes.find((n) => n.why === "current")?.title ?? null}
            onDone={(summary) => {
              const { base } = task;
              setTask(null);
              nerida.upsert({ ...base, messages: [...base.messages, { role: "assistant", content: summary ?? "Okay, I didn't add anything." }], updatedAt: Date.now() });
            }} />
        )}
        {live && (
          <div className="mt-4">
            {steps.length > 0 && (
              <div className="mb-2">
                <button type="button" onClick={() => setStepsOpen((o) => !o)} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                  <NeridaMark busy size={15} />
                  <span className="oc-nerida-shimmer">{steps[steps.length - 1].label.replace(/^(\w+ing\b[^:…]*)$/, "$1…")}</span>
                  <ChevronDown className={`size-3 text-neutral-500 transition-transform ${stepsOpen ? "" : "-rotate-90"}`} />
                </button>
                {stepsOpen && (
                  <ul className="mt-1.5 ml-[7px] border-l border-white/[0.08] pl-3">
                    {steps.map((s, i) => (
                      <li key={i} className={`flex items-center gap-1.5 py-0.5 text-[12px] ${s.done ? "text-neutral-500" : "text-neutral-300"}`}>
                        {s.done ? <Check className="size-3 text-teal-400" /> : <Loader2 className="size-3 animate-spin text-teal-300" aria-label="Working" />}
                        {s.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {waited > 0 && !draft && <p className="mt-2 text-center text-[11.5px] text-neutral-500">Still waiting for Nerida… {waited}s</p>}
            {actions.length > 0 && <AgentLogList actions={actions} />}
            <AgentCards />
            {draft && (
              <div className="flex gap-2.5">
                <div className="mt-1 shrink-0"><NeridaMark size={20} /></div>
                <div className="min-w-0 flex-1 leading-relaxed">
                  <div className="oc-reply w-fit max-w-full rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.035] px-3 py-2 shadow-md shadow-black/20"><Markdown text={draft} stream /></div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* One error state, in the conversation, with the action that fixes it. */}
        {err && (
          <div role="alert" className={`oc-msg-in mx-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-red-400/15 bg-red-500/[0.06] px-4 py-4 text-center ${msgs.length ? "mt-4" : "mt-[12vh]"}`}>
            <AlertCircle className="size-5 text-red-300" />
            <p className="text-[12.5px] leading-relaxed text-red-200">{err}</p>
            {isTauri() && (
              <button type="button" disabled={busy} onClick={() => (setErr(""), msgs.length ? retry() : void refresh())}
                className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-white/[0.06] disabled:opacity-40">
                <RotateCcw className="size-3.5" /> Try again
              </button>
            )}
          </div>
        )}
      </div>
      </div>

      {/* composer */}
      <div className={home ? "mx-auto w-full max-w-3xl px-4 pb-4" : "relative shrink-0 p-3 pt-0"}>
        {!stuck && msgs.length > 0 && (
          <button type="button" title="Jump to latest" onClick={() => { stick.current = true; setStuck(true); scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }}
            className="oc-glass-menu oc-chip-in absolute -top-11 left-1/2 z-10 grid size-8 -translate-x-1/2 cursor-pointer place-items-center rounded-full text-neutral-200 hover:text-white"><ArrowDown className="size-4" /></button>
        )}
        {restart === "later" && b && <RestartReminder />}
        {home && asleep && <p className="oc-glass-pop oc-chip-in mx-auto mb-2 flex w-fit items-center gap-2 rounded-full px-3 py-1 text-[11.5px] text-neutral-400"><span className="size-1.5 animate-pulse rounded-full bg-teal-300" />Nerida is asleep to save memory. First reply takes a few seconds.</p>}
        {home && neridaState.warming && !busy && <p className="oc-nerida-shimmer mb-2 text-center text-[11.5px]">Getting ready…</p>}
        {home ? <div className="oc-glass-pop oc-main-composer rounded-[20px] p-1">{composer}</div> : composer}
      </div>
      {/* built-in chat locked during engine/model/add-on downloads */}
      {b && ready && isLocked(neridaState) && (
        <div className="absolute inset-x-0 bottom-0 top-12 z-30 grid place-items-center bg-neutral-950/70 backdrop-blur-sm">
          <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-b from-teal-400/[0.07] via-sky-400/[0.05] to-transparent" />
          <div className="relative flex flex-col items-center gap-3 px-6 text-center">
            <div className="animate-pulse"><NeridaMark size={48} busy /></div>
            <p className="oc-nerida-shimmer text-[14px] font-medium">{UPGRADE_MSG}</p>
          </div>
        </div>
      )}
    </aside>
    </>
  );
}

function Act({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-white/[0.06] hover:text-neutral-200">{children}</button>;
}

/** Grouped model picker: Nerida · Ollama (auto-detected) · custom providers. */
export function ModelSelect({ value, onChange, disabled, compact }: { value: ModelRef; onChange: (m: ModelRef) => void; disabled?: boolean; compact?: boolean }) {
  const { providers } = useNerida();
  const [ollama, setOllama] = useState<string[]>([]);
  useEffect(() => {
    if (isTauri()) void listModels(OLLAMA_URL).then(setOllama).catch(() => setOllama([]));
  }, []);
  const known = value.startsWith("nerida:") || ollama.includes(value.slice(7)) || providers.some((p) => p.models.some((m) => `custom:${p.id}:${m}` === value));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} title="Model"
      className={compact ? "max-w-[130px] cursor-pointer truncate rounded-md bg-transparent px-1 py-1 text-[12px] text-neutral-400 outline-none hover:bg-white/[0.06]" : "h-8 cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none"}>
      <optgroup label="Nerida" className="bg-neutral-900">
        {(["plus"] as ModelId[]).map((m) => <option key={m} value={`nerida:${m}`}>{MODEL_NAMES[m]}</option>)}
      </optgroup>
      {ollama.length > 0 && (
        <optgroup label="Ollama" className="bg-neutral-900">
          {ollama.map((m) => <option key={m} value={`ollama:${m}`}>{m}</option>)}
        </optgroup>
      )}
      {providers.filter((p) => p.models.length).map((p) => (
        <optgroup key={p.id} label={p.name} className="bg-neutral-900">
          {p.models.map((m) => { const ref = `custom:${p.id}:${m}`; return <option key={m} value={ref}>{m}{isCloud(ref) ? " (Cloud)" : ""}</option>; })}
        </optgroup>
      ))}
      {!known && <option value={value} className="bg-neutral-900">{modelLabel(value) || value}</option>}
    </select>
  );
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 10080) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
