import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { runTools, searchWeb } from "../lib/neridaTools";
import { SourceBook, type SourceRef } from "../lib/neridaGuard";
import { noteChars, refresh as refreshIndex, searchNotes as searchIndex } from "../lib/noteIndex";
import { ContextPicker } from "./NeridaContext";
import { createMindmap } from "../mindmap/MindmapGallery";
import { MAP_FLAG } from "../mindmap/NeridaMap";
import { OPEN_MINDMAP } from "../editor/mindmapBlock";
import { NeridaTaskCard } from "./NeridaTaskCard";
import { GARBLED_NOTE, NERIDA_ASK, pageRange, pdfContext, readScanned, summarizePdf, type AskDetail } from "../lib/neridaPdf";
import { pdfNames } from "../pdf/PdfRef";
import { detectTask, type TaskDraft } from "../lib/neridaTask";
import { AlertCircle, ArrowUp, Check, ChevronDown, Copy, Download, FileInput, FileText, Globe, Loader2, Paperclip, Plus, RotateCcw, Square, X } from "lucide-react";
import { usePageDirectory } from "../editor/pageDirectory";
import { DeepSparkles, EffortButton, ThoughtLine } from "./NeridaEffort";
import { ASK_WHICH, editPrompt, proposalWarning, isEditRequest, targetBlocks, markAllDone, noteBlocks, parseEdits, proposeEdits, usePending } from "../lib/neridaChatEdit";
import { ModelMenu } from "./NeridaModelMenu";
import { openNeridaCards } from "./NeridaCards";
import { ATTACH_ACCEPT, attachmentsContext, extractFileText, type Attachment } from "../lib/neridaFiles";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../data/api";
import { NeridaIntro } from "./NeridaIntro";
import {
  buildContext, MAX_NOTES, noteBudget, builtin, chatGroups, downloadModel, engine, openNeridaSettings, isCloud, listModels, MODEL_NAMES, modelLabel, nerida, OLLAMA_URL, relatedNotes, setDefaultModel, SYSTEM, EDIT_SYSTEM, AGENT_SYSTEM, withNotes, uid, useNerida, isFeaturesQuestion, isLocked, UPGRADE_MSG,
  type AgentLog, type AiStatus, type Chat, type ContextNote, type ModelId, type ModelRef, type Msg,
} from "../lib/nerida";

export { NeridaMark } from "./NeridaOrb";
import katex from "katex";
import "katex/dist/katex.min.css";
import { BetaPill, NeridaBetaCard, NeridaMark } from "./NeridaOrb";
import { confirmCloud } from "./NeridaDiff";
import { AgentCards, AgentLogList, AgentToggle } from "./NeridaAgentUI";
import { runAgent, stopAgent } from "../lib/neridaAgent";
import { neridaSafeMarkdown } from "../lib/neridaSafe";

/* ------------------------------------------------------------- markdown */
/** $…$ → KaTeX. Plain numbers or words ("$6.53$", "$P$" stays math-italic) need no braces; money like "$5 and $10" isn't matched (no space inside the $s). */
function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
  if (/^-?[\d.,]+$/.test(tex.trim())) return <>{tex.trim()}</>;
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return display ? <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
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
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(<pre key={i} className="my-2.5 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/35 p-3 font-mono text-[12px] leading-relaxed text-neutral-200">{code.join("\n")}</pre>);
    } else if (/^\s*\$\$.*\$\$\s*$/.test(l)) out.push(<MathSpan key={i} tex={l.trim().slice(2, -2)} display />);
    else if (/^#{1,3} /.test(l)) out.push(<p key={i} className="mt-3 mb-1 font-semibold text-neutral-100">{inline(l.replace(/^#+ /, ""))}</p>);
    else if (/^\s*([-*]|\d+\.) /.test(l))
      out.push(<p key={i} className="flex gap-2 pl-1" style={{ marginLeft: (l.match(/^\s*/)![0].length / 2) * 12 }}><span className="text-neutral-500">{/^\s*\d/.test(l) ? l.trim().split(" ")[0] : "•"}</span><span>{inline(l.replace(/^\s*([-*]|\d+\.) /, ""))}</span></p>);
    else if (l.trim()) out.push(<p key={i} className="my-1.5">{inline(l)}</p>);
  }
  if (stream) out.push(<span key="caret" className="oc-caret" aria-hidden />);
  return <div className="text-[13.5px] leading-relaxed text-neutral-200">{out}</div>;
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

/** "/" menu. `note`: needs a note (@ or the open one) before it runs. */
type Cmd = { k: string; label: string; note: boolean; prompt: string };
const CMDS: Cmd[] = [
  { k: "quiz", label: "Quiz me on a note", note: true, prompt: "Quiz me: ask 5 questions about the main ideas in my notes. Number them. Don't give the answers." },
  { k: "flashcards", label: "Make flashcards", note: true, prompt: "" },
  { k: "summarize", label: "Summarize a note", note: true, prompt: "Summarize my notes: a one-line overview, then the key points as a short list." },
  { k: "explain", label: "Explain simply", note: true, prompt: "Explain the key ideas in my notes simply, like I'm new to the topic." },
  { k: "plan", label: "Plan my study week", note: false, prompt: "Help me plan my study week." },
  { k: "mindmap", label: "Make a mindmap", note: false, prompt: "" },
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
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepsOpen, setStepsOpen] = useState(true);
  /** Agent mode: this reply's activity log, live. */
  const [actions, setActions] = useState<AgentLog[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  // Live workspace search while typing (debounced); kept after sending until the next question.
  useEffect(() => {
    const q = input.trim();
    if (!q) return;
    if (pdf || q.length < 4 || q.startsWith("/")) return setFound([]);
    const t = setTimeout(() => {
      const skip = new Set(notes.filter((n) => n.why === "current").map((n) => n.id));
      void searchIndex(q, 3, skip).then((h) => setFound(h.map((x) => ({ id: x.id, title: x.title, icon: pages.get(x.id)?.icon ?? "", why: "found" as const })))).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [input, pdf]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note sizes for the picker's token estimate.
  const [, setSized] = useState(0);
  const sendKey = sendList.map((n) => n.id).join();
  useEffect(() => {
    if (sendKey) void refreshIndex(sendKey.split(",")).then(() => setSized((x) => x + 1)).catch(() => {});
  }, [sendKey]);
  const estTokens = Math.round(Math.min(sendList.reduce((s, n) => s + noteChars(n.id), 0), noteBudget(model)) / 4);
  const [cmd, setCmd] = useState<Cmd | null>(null);
  const [pick, setPick] = useState(0);
  const slashQuery = cmd ? undefined : /^\/(\w*)$/.exec(input)?.[1];
  const slashHits = slashQuery === undefined ? [] : CMDS.filter((c) => c.k.startsWith(slashQuery.toLowerCase()));
  /** Runs `c` (now, or once a note is attached). `withNote` = a note just picked for it. */
  const runCmd = (c: Cmd, withNote?: string) => {
    const note = withNote ?? sendList[0]?.id;
    setInput("");
    if (c.note && !note) return setCmd(c); // chip waits for @note
    setCmd(null);
    if (c.k === "mindmap") return openNewMindmap();
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
  const addFiles = async (list: FileList | File[]) => {
    for (const f of [...list]) {
      setReading((n) => n + 1);
      try {
        const a = await extractFileText(f);
        setFiles((x) => [...x.filter((y) => y.name !== a.name), a]);
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
  }, []);
  useEffect(() => {
    setExcluded(new Set());
    if (pageId) void relatedNotes(pageId).then(setNotes);
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
  useEffect(() => {
    scroller.current?.scrollTo({ top: 1e9 });
  }, [chat?.messages.length, draft]);

  const b = builtin(model);
  const ready = b ? !!status?.server && !!status.models.find((m) => m.id === b)?.installed : !!status;
  // First use: the intro popup instead of a bare download card.
  const [auto, setAuto] = useState(false);
  const intro = !!b && !!status && !status.models.some((m) => m.installed) && !auto;

  sendRef.current = (t) => void send(t);
  const send = async (text: string, history: Msg[] = chat?.messages ?? []) => {
    if (!text.trim() || busy) return;
    if (!(await confirmCloud(model))) return;
    setErr("");
    setInput("");
    const base: Chat = chat ?? { id: uid(), title: text.slice(0, 60), messages: [], updatedAt: Date.now(), ...(pinned.length && { pinned }) };
    const messages: Msg[] = [...history, { role: "user", content: text }];
    nerida.upsert({ ...base, messages, updatedAt: Date.now() });
    const draft = detectTask(text);
    if (draft) return setTask({ draft, base: { ...base, messages } });
    setBusy(true);
    setDraft("");
    setStepsOpen(true);
    let used = sendList;
    const mark = (label: string) => setSteps((s) => (s[s.length - 1]?.label === label ? s : [...s.map((x) => ({ ...x, done: true })), { label, done: false }]));
    setSteps([]);
    let reply = "";
    // Deep: thinking streams to onThink; kept on the message as a collapsed "Thought for Xs".
    let thought = "";
    const t0 = Date.now();
    let thoughtSecs = 0;
    const onThink = (t: string) => {
      if (!thought) mark("Thinking");
      thought = t;
      thoughtSecs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    };
    let garbled = false;
    const book = new SourceBook();
    // Agent mode: Nerida edits through its tools, so the one-shot note-edit path is skipped.
    const agentOn = nerida.get().agent && !pdf;
    let log: AgentLog[] = [];
    setActions([]);
    try {
      // "Edit my note": changes go into the note as highlighted suggestions, not into the chat.
      const blocks = !agentOn && pageId && !home && isEditRequest(text) ? targetBlocks(noteBlocks(), text) : [];
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
        if (b) await engine.start(b);
        mark("Editing your note");
        let raw = "";
        await engine.chat(model, [{ role: "system", content: EDIT_SYSTEM }, { role: "user", content: editPrompt(blocks, text) }], (t) => (raw += t), onThink);
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
      // Search every note for the exact question (the live search may lag the last keystrokes); removed notes stay out.
      if (!pdf && !files.length && !isFeaturesQuestion(text)) {
        const hits = await searchIndex(text, 3, new Set([...used.map((n) => n.id), ...excluded])).catch(() => []);
        const extra = hits.map((h) => ({ id: h.id, title: h.title, icon: pages.get(h.id)?.icon ?? "", why: "found" as const }));
        if (extra.length) {
          mark(`Searching all notes: found ${extra.length}`);
          used = [...used, ...extra].slice(0, MAX_NOTES);
          setFound((f) => [...f, ...extra.filter((x) => !f.some((y) => y.id === x.id))]);
        }
      }
      if (used.length) {
        mark(`Reading ${used.length} note${used.length > 1 ? "s" : ""}`);
        const c = await buildContext(used, text, book);
        context = c.text;
        mark(`Found ${c.parts} relevant part${c.parts === 1 ? "" : "s"}`);
      }
      if (pdf) {
        const name = pdfNames.get(pdf.id) ?? pdf.name; // the reader fills pdfNames once the PDF loads
        mark(`Reading ${name}`);
        // Scanned pages: the vision add-on reads each page once (saved), then they're normal text.
        if (b && status?.vision) await readScanned(pdf.id, (n, total) => mark(`Reading scanned page ${n} of ${total}`));
        const range = pageRange(text);
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
      if (online && b === "plus") {
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
        if (status?.running !== b) mark(`Waking up ${MODEL_NAMES[b]}`);
        await engine.start(b);
        void refresh();
      }
      if (agentOn) {
        mark(b ? "Working on it" : `Asking ${modelLabel(model)}`);
        const open = pageId && !home ? ` The note open next to this chat has id ${pageId}.` : "";
        reply = await runAgent({
          model,
          messages: [{ role: "system", content: AGENT_SYSTEM + open }, ...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: [context && `Reference material:\n${context}\n\n(${book.rules()})`, tools, `My request: ${text}`].filter(Boolean).join("\n\n") }],
          onText: (t) => ((reply = t), setDraft(t)),
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
      await engine.chat(model, [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: isFeaturesQuestion(text) ? text : withNotes(text, context, book, tools) }], (t) => {
        reply += t;
        setDraft(reply);
      }, onThink);
      setSteps((s) => s.map((x) => ({ ...x, done: true })));
      setStepsOpen(false);
    } catch (e) {
      if (e !== null) setErr(String(e)); // null = note edit finished early
    }
    if (reply && garbled) reply += GARBLED_NOTE;
    if (reply) reply += book.footer(reply);
    const sources = book.refs();
    if (!reply && log.length) reply = "Stopped.";
    if (reply) nerida.upsert({ ...base, pinned: nerida.get().chats.find((c) => c.id === base.id)?.pinned ?? base.pinned, messages: [...messages, { role: "assistant", content: reply, ...(thought && { thought, thoughtSecs }), ...(sources.length && { sources }), ...(log.length && { actions: log }) }], updatedAt: Date.now() });
    setActions([]);
    setDraft("");
    setBusy(false);
  };

  const retry = () => {
    if (!chat || busy) return;
    const lastUser = chat.messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    void send(chat.messages[lastUser].content, chat.messages.slice(0, lastUser));
  };


  const msgs = chat?.messages ?? [];
  const composer = (
      <div className="relative">
        <input ref={filePicker} type="file" multiple accept={ATTACH_ACCEPT} className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative flex flex-col gap-1 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-2 shadow-lg shadow-black/20 transition-[border-color,box-shadow] duration-300 focus-within:border-teal-300/35 focus-within:shadow-[0_0_0_3px_rgba(45,212,191,0.08),0_10px_30px_-10px_rgba(0,0,0,0.5)]">
        <DeepSparkles typing={input} />
        {(files.length > 0 || reading > 0) && (
          <div className="mb-1 flex flex-wrap gap-1">
            {files.map((f) => (
              <span key={f.name} title={f.truncated ? "Long file: only the first part is used" : f.name} className="oc-chip-in flex max-w-[180px] items-center gap-1 rounded-full border border-sky-300/20 bg-sky-300/[0.05] px-1.5 py-0.5 text-[11.5px] text-neutral-300">
                <FileText className="size-3 shrink-0 text-sky-300" /><span className="truncate">{f.name}</span>
                <button type="button" title="Remove" className="cursor-pointer text-neutral-500 hover:text-neutral-200" onClick={() => setFiles((x) => x.filter((y) => y !== f))}><X className="size-3" /></button>
              </span>
            ))}
            {reading > 0 && <span className="oc-nerida-shimmer px-1.5 py-0.5 text-[11.5px]">Reading file…</span>}
          </div>
        )}
        <ContextPicker notes={active} sendCount={sendList.length} tokens={estTokens} cloud={isCloud(model) ? modelLabel(model) : null}
          onPin={togglePin} onRemove={removeNote} onAdd={addMention} />
        {(mentionHits.length > 0 || slashHits.length > 0) && (
          <div className="oc-menu-pop absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-white/[0.08] bg-neutral-900/95 p-1 shadow-2xl shadow-black/50 backdrop-blur">
            {slashHits.map((c, i) => (
              <button key={c.k} type="button" onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); runCmd(c); }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] ${i === pick % slashHits.length ? "bg-white/[0.07] text-neutral-100" : "text-neutral-300"}`}>
                <span className="w-[86px] font-mono text-[12px] text-teal-300">/{c.k}</span>
                <span className="flex-1 truncate">{c.label}</span>
                {i === pick % slashHits.length && <span className="text-[11px] text-neutral-500">⏎</span>}
              </button>
            ))}
            {mentionHits.map((p, i) => (
              <button key={p.id} type="button" onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); addMention(p.id); }}
                className={`flex w-full cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] ${i === pick % mentionHits.length ? "bg-white/[0.07] text-neutral-100" : "text-neutral-300"}`}>
                <span>{p.icon}</span><span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
          <div className="flex items-start gap-1">
          {cmd && (
            <span className="oc-chip-in mt-1 flex shrink-0 items-center gap-1 rounded-md bg-teal-400/15 px-1.5 py-0.5 text-[12px] font-medium text-teal-200">
              {cmd.label} ▸
              <button type="button" title="Cancel" onClick={() => setCmd(null)} className="cursor-pointer text-teal-300/70 hover:text-teal-100"><X className="size-3" /></button>
            </span>
          )}
          <textarea
            value={input}
            disabled={!ready}
            onChange={(e) => { setInput(e.target.value); setPick(0); }}
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
            placeholder={!isTauri() ? "Open the Oceanic desktop app to chat" : !ready ? "Download Nerida to start" : cmd ? "Type @ to pick a note" : "Ask Nerida anything…"}
            className="max-h-40 min-h-[40px] w-full resize-none bg-transparent px-1.5 pt-1 text-[13.5px] text-neutral-100 outline-none placeholder:text-neutral-500"
          />
          </div>
          <div className="flex items-center gap-1">
          <button type="button" disabled={!ready || busy} title="Attach PDF, Word or text files" onClick={() => filePicker.current?.click()} className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:text-neutral-600"><Paperclip className="size-4" /></button>
          {b === "plus" && <button type="button" disabled={busy} title={online ? "Web search on" : "Search the web"} aria-pressed={online} onClick={() => setOnline((v) => !v)} className={`grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-white/[0.06] ${online ? "text-sky-400" : "text-neutral-400 hover:text-neutral-200"}`}><Globe className="size-4" /></button>}
          {!pdf && <AgentToggle disabled={busy} />}
          <div className="flex-1" />
          <ModelMenu disabled={busy} />
          <EffortButton disabled={busy} compact={!home} />
          {/* One button: the arrow morphs into a stop square while Nerida answers. */}
          <button type="button" title={busy ? "Stop" : "Send"} data-busy={busy || undefined} disabled={!busy && (!(input.trim() || cmd) || !ready)}
            onClick={() => (busy ? (stopAgent(), void engine.stop()) : cmd ? runCmd(cmd) : void send(input))}
            className="oc-send oc-send-morph relative grid size-7 cursor-pointer place-items-center rounded-lg bg-teal-400/90 text-neutral-950 transition-[transform,background-color] hover:bg-teal-300 active:scale-90 disabled:cursor-default disabled:bg-white/[0.08] disabled:text-neutral-500 data-[busy]:bg-white/[0.1] data-[busy]:text-neutral-200">
            <ArrowUp className="oc-send-arrow absolute size-4" />
            <Square className="oc-send-stop absolute size-3" fill="currentColor" />
          </button>
          </div>
        </div>
        {ready && <p className="mt-1.5 flex justify-between px-1 text-[11px] text-neutral-600">
          <span><kbd className="text-neutral-400">/</kbd> for actions · <kbd className="text-neutral-400">@</kbd> to add a note</span>
          {home && <span>🔒 Runs on this PC. Your notes stay here.</span>}
        </p>}
      </div>
  );
  const lastAssistant = msgs.map((m) => m.role).lastIndexOf("assistant");

  return (
    <>
    <NeridaBetaCard />
    <aside
      onDragOver={(e) => { if (ready && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { if (!ready || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); void addFiles(e.dataTransfer.files); }}
      className={home ? "oc-page-in relative flex h-full w-full flex-col" : "oc-nerida-in relative flex h-full w-[360px] shrink-0 flex-col border-l border-white/[0.06] bg-neutral-900/60"}>
      {/* header */}
      {home ? (
        <div className="h-12 shrink-0" />
      ) : (
      <div className="relative flex h-12 shrink-0 items-center gap-1.5 border-b border-white/[0.05] px-3">
        <NeridaMark busy={busy} />
        <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[13.5px] font-medium text-neutral-100 hover:bg-white/[0.06]">
          <span className="truncate">{chat?.title ?? "Nerida"}</span>
          {!chat && <BetaPill />}
          <ChevronDown className="size-3.5 shrink-0 text-neutral-500" />
        </button>
        <div className="flex-1" />
        <button type="button" title="New chat" disabled={busy} onClick={() => nerida.set({ activeId: null })} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"><Plus className="size-4" /></button>
        <button type="button" title="Close (Ctrl+J)" onClick={() => nerida.set({ open: false })} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"><X className="size-4" /></button>
        {historyOpen && (
          <div className="oc-menu-pop absolute left-3 top-11 z-20 max-h-80 w-72 overflow-y-auto rounded-xl border border-white/[0.08] bg-neutral-900/95 p-1 shadow-2xl shadow-black/50 backdrop-blur">
            {chats.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-neutral-500">No chats yet</p>}
            {chatGroups(chats).map(([group, list]) => (
              <div key={group}>
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-neutral-500">{group}</p>
                {list.map((c) => (
                  <div key={c.id} className={`group flex items-center rounded-md hover:bg-white/[0.06] ${c.id === activeId ? "bg-white/[0.06]" : ""}`}>
                    <button type="button" onClick={() => { nerida.set({ activeId: c.id }); setHistoryOpen(false); }} className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left text-[12.5px] text-neutral-300">{c.title}</button>
                    <button type="button" title="Delete chat" onClick={() => nerida.remove(c.id)} className="mr-1 hidden cursor-pointer text-neutral-500 hover:text-red-400 group-hover:block"><X className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* conversation */}
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3">
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
            {recentNotes.length > 0 ? (
              <>
                <p className="mb-1.5 mt-10 px-2 text-[11.5px] font-semibold uppercase tracking-wider text-neutral-500">Start from a recent note</p>
                {recentNotes.map((id) => {
                  const p = pages.get(id)!;
                  return (
                    <div key={id} className="oc-tilt group flex items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-white/[0.04]">
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
          <div className="mt-10 text-center">
            <div className="mx-auto mb-3 grid place-items-center"><NeridaMark size={48} /></div>
            <p className="text-[15px] font-medium text-neutral-100">How can I help?</p>
            <div className="mt-4 flex flex-col items-center gap-1.5">
              {(pdf ? ["Summarize this PDF", "What are the key ideas?", "Explain the hardest part simply"] : pageId ? ["Summarize this note", "Explain the key ideas simply", "Make flashcards from this note"] : ["Help me plan my study week", "Explain a concept simply"]).map((s) => (
                <button key={s} type="button" onClick={() => (s.startsWith("Make flashcards") && pageId ? openNeridaCards({ pageId }) : void send(s))} className="cursor-pointer rounded-full border border-white/[0.08] px-3 py-1 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="oc-msg-in oc-msg-user mt-5 flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-teal-300/20 bg-gradient-to-br from-teal-400/[0.18] to-sky-400/[0.08] px-4 py-2.5 text-[13.5px] leading-relaxed text-neutral-100 shadow-md shadow-black/20">{m.content}</div></div>
          ) : (
            <div key={i} className="group oc-msg-in mt-5 flex gap-2.5">
              <div className="mt-1 shrink-0"><NeridaMark size={20} /></div>
              <div className="min-w-0 flex-1 leading-relaxed">
              <div className="w-fit max-w-full rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.035] px-3 py-2 shadow-md shadow-black/20">
                {m.thought && <ThoughtLine thought={m.thought} secs={m.thoughtSecs ?? 0} />}
                {m.actions?.length ? <AgentLogList actions={m.actions} onChange={(a) => chat && nerida.upsert({ ...chat, messages: chat.messages.map((x, j) => (j === i ? { ...x, actions: a } : x)) })} /> : null}
                <Markdown text={m.content} sources={m.sources} />
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
        {busy && (
          <div className="mt-4">
            {steps.length > 0 && (
              <div className="mb-2">
                <button type="button" onClick={() => setStepsOpen((o) => !o)} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                  <NeridaMark busy size={15} />
                  <span className="oc-nerida-shimmer">{steps[steps.length - 1].label}…</span>
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
            {actions.length > 0 && <AgentLogList actions={actions} />}
            <AgentCards />
            {draft && <Markdown text={draft} stream />}
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
      <div className={home ? "mx-auto w-full max-w-3xl px-4 pb-4" : "shrink-0 p-3 pt-0"}>
        {restart === "later" && b && <RestartReminder />}
        {composer}
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
