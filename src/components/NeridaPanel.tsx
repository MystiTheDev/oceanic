import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { runTools, searchNotes, searchWeb } from "../lib/neridaTools";
import { createMindmap } from "../mindmap/MindmapGallery";
import { MAP_FLAG } from "../mindmap/NeridaMap";
import { OPEN_MINDMAP } from "../editor/mindmapBlock";
import { NeridaTaskCard } from "./NeridaTaskCard";
import { GARBLED_NOTE, NERIDA_ASK, pdfContext, type AskDetail } from "../lib/neridaPdf";
import { pdfNames } from "../pdf/PdfRef";
import { detectTask, type TaskDraft } from "../lib/neridaTask";
import { ArrowUp, Check, ChevronDown, Copy, Download, FileInput, FileText, Globe, Paperclip, Plus, RotateCcw, Square, X } from "lucide-react";
import { usePageDirectory } from "../editor/pageDirectory";
import { ModelMenu } from "./NeridaModelMenu";
import { openNeridaCards } from "./NeridaCards";
import { ATTACH_ACCEPT, attachmentsContext, extractFileText, type Attachment } from "../lib/neridaFiles";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../data/api";
import { NeridaIntro } from "./NeridaIntro";
import {
  buildContext, builtin, engine, isCloud, listModels, MODEL_NAMES, modelLabel, nerida, OLLAMA_URL, relatedNotes, setDefaultModel, SYSTEM, withNotes, EXAMPLE, uid, useNerida, FEATURES_REPLY, isFeaturesQuestion,
  type AiStatus, type Chat, type ContextNote, type ModelId, type ModelRef, type Msg,
} from "../lib/nerida";

export { NeridaMark } from "./NeridaOrb";
import katex from "katex";
import "katex/dist/katex.min.css";
import { BetaPill, NeridaBetaCard, NeridaMark } from "./NeridaOrb";

/* ------------------------------------------------------------- markdown */
/** $…$ → KaTeX. Plain numbers or words ("$6.53$", "$P$" stays math-italic) need no braces; money like "$5 and $10" isn't matched (no space inside the $s). */
function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
  if (/^-?[\d.,]+$/.test(tex.trim())) return <>{tex.trim()}</>;
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return display ? <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}
function inline(t: string): ReactNode[] {
  return t.split(/(\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*.+?\*\*|`.+?`|\*.+?\*)/g).map((s, i) =>
    s.startsWith("$") && s.length > 2 ? <MathSpan key={i} tex={s.slice(1, -1)} />
    : s.startsWith("**") && s.length > 4 ? <b key={i}>{s.slice(2, -2)}</b>
    : s.startsWith("`") && s.length > 2 ? <code key={i} className="rounded bg-white/[0.08] px-1 text-[0.9em]">{s.slice(1, -1)}</code>
    : s.startsWith("*") && s.length > 2 ? <i key={i}>{s.slice(1, -1)}</i>
    : <Fragment key={i}>{s}</Fragment>,
  );
}
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(<pre key={i} className="my-2 overflow-x-auto rounded-lg bg-black/30 p-2.5 text-[12px]">{code.join("\n")}</pre>);
    } else if (/^\s*\$\$.*\$\$\s*$/.test(l)) out.push(<MathSpan key={i} tex={l.trim().slice(2, -2)} display />);
    else if (/^#{1,3} /.test(l)) out.push(<p key={i} className="mt-3 mb-1 font-semibold text-neutral-100">{inline(l.replace(/^#+ /, ""))}</p>);
    else if (/^\s*([-*]|\d+\.) /.test(l))
      out.push(<p key={i} className="flex gap-2 pl-1" style={{ marginLeft: (l.match(/^\s*/)![0].length / 2) * 12 }}><span className="text-neutral-500">{/^\s*\d/.test(l) ? l.trim().split(" ")[0] : "•"}</span><span>{inline(l.replace(/^\s*([-*]|\d+\.) /, ""))}</span></p>);
    else if (l.trim()) out.push(<p key={i} className="my-1.5">{inline(l)}</p>);
  }
  return <div className="text-[13.5px] leading-relaxed text-neutral-200">{out}</div>;
}

/* ----------------------------------------------------------------- setup */
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

function Setup({ status, model, auto, onDone }: { status: AiStatus; model: ModelId; auto: boolean; onDone: () => void }) {
  const [prog, setProg] = useState<{ label: string; got: number; total: number } | null>(null);
  const [err, setErr] = useState("");
  const size = status.models.find((m) => m.id === model)?.size ?? 0;
  const run = async () => {
    setErr("");
    try {
      if (!status.server) await engine.download("server", (got, total) => setProg({ label: "Nerida engine", got, total }));
      if (!status.models.find((m) => m.id === model)?.installed) await engine.download(model, (got, total) => setProg({ label: MODEL_NAMES[model], got, total }));
      onDone();
    } catch (e) {
      setErr(String(e) === "cancelled" ? "" : String(e));
    }
    setProg(null);
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
function UpdateBanner({ model, size, onDone }: { model: ModelId; size: number; onDone: () => void }) {
  const [prog, setProg] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const run = async () => {
    setErr("");
    try {
      await engine.download(model, (got, total) => setProg(got / total));
      onDone();
    } catch (e) {
      if (String(e) !== "cancelled") setErr(String(e));
    }
    setProg(null);
  };
  return (
    <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-300/[0.05] p-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <NeridaMark size={18} busy={prog !== null} />
        <p className="min-w-0 flex-1 text-neutral-200">Nerida got smarter. Update {MODEL_NAMES[model]} ({mb(size)}).</p>
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

/* ------------------------------------------------------------------ panel */
type Step = { label: string; done: boolean };

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

/** Nerida chat. `home` = the full-page Home "Nerida" view; otherwise the in-note side panel. */
/** `pdf`: the open PDF in the reader; its text is the chat's context instead of notes. */
export function NeridaPanel({ pageId, home = false, pdf = null }: { pageId: string | null; home?: boolean; pdf?: { id: string; name: string } | null }) {
  const { chats, activeId, model } = useNerida();
  const chat = chats.find((c) => c.id === activeId) ?? null;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [notes, setNotes] = useState<ContextNote[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepsOpen, setStepsOpen] = useState(true);
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
    if (p && !notes.some((n) => n.id === id) && !mentions.some((n) => n.id === id)) setMentions((m) => [...m, { id, title: p.title || "Untitled", icon: p.icon, why: "mention" }]);
    setInput((v) => v.replace(/@[^\s@]*$/, ""));
  };
  const allNotes = [...notes, ...mentions];
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
    if (isCloud(model) && !nerida.get().cloudOk) {
      if (!confirm(`${modelLabel(model)} is a cloud model: your message and the included notes are sent to that provider. Continue?`)) return;
      nerida.set({ cloudOk: true });
      void api.setSetting("neridaCloudOk", "1").catch(() => {});
    }
    setErr("");
    setInput("");
    const base: Chat = chat ?? { id: uid(), title: text.slice(0, 60), messages: [], updatedAt: Date.now() };
    const messages: Msg[] = [...history, { role: "user", content: text }];
    nerida.upsert({ ...base, messages, updatedAt: Date.now() });
    if (isFeaturesQuestion(text)) return nerida.upsert({ ...base, messages: [...messages, { role: "assistant", content: FEATURES_REPLY }], updatedAt: Date.now() });
    const draft = detectTask(text);
    if (draft) return setTask({ draft, base: { ...base, messages } });
    setBusy(true);
    setDraft("");
    setStepsOpen(true);
    const used = allNotes.filter((n) => !excluded.has(n.id));
    const mark = (label: string) => setSteps((s) => [...s.map((x) => ({ ...x, done: true })), { label, done: false }]);
    setSteps([]);
    let reply = "";
    let garbled = false;
    let sources: string[] = [];
    try {
      let context = "";
      const tools = await runTools(text);
      if (tools) mark("Working it out");
      if (!used.length && !pdf && !files.length && !tools) {
        const ids = await searchNotes(text);
        if (ids.length) {
          mark(`Searching your notes: found ${ids.length}`);
          context = (await buildContext(ids.map((id) => ({ id, title: pages.get(id)?.title || "Untitled", icon: "", why: "mention" as const })), text)).text;
        }
      }
      if (used.length) {
        mark(`Reading ${used.length} note${used.length > 1 ? "s" : ""}`);
        const c = await buildContext(used, text);
        context = c.text;
        mark(`Found ${c.parts} relevant part${c.parts === 1 ? "" : "s"}`);
      }
      if (pdf) {
        const name = pdfNames.get(pdf.id) ?? pdf.name; // the reader fills pdfNames once the PDF loads
        mark(`Reading ${name}`);
        const c = await pdfContext(pdf.id, name, text);
        if (!c.parts) mark("No text in this PDF (scanned pages can't be read yet)");
        else mark(`Found ${c.parts} relevant page${c.parts === 1 ? "" : "s"}`);
        garbled = c.garbled;
        context = [context, c.text].filter(Boolean).join("\n\n");
      }
      if (files.length) {
        mark(`Reading ${files.length} file${files.length > 1 ? "s" : ""}`);
        context = [context, attachmentsContext(files)].filter(Boolean).join("\n\n");
      }
      if (online && b === "plus") {
        mark("Searching the web");
        try {
          const w = await searchWeb(text);
          sources = w.sources;
          if (w.text) context = [context, `Web results:\n${w.text}`].filter(Boolean).join("\n\n");
          mark(w.text ? `Read ${w.sources.length} web source${w.sources.length === 1 ? "" : "s"}` : "No web results");
        } catch {
          mark("Couldn't reach the web");
        }
      }
      context = [tools, context].filter(Boolean).join("\n\n");
      if (b) {
        if (status?.running !== b) mark(`Waking up ${MODEL_NAMES[b]}`);
        await engine.start(b);
        void refresh();
      }
      mark(b ? "Writing answer" : `Asking ${modelLabel(model)}`);
      await engine.chat(model, [{ role: "system", content: SYSTEM }, ...(b ? EXAMPLE : []), ...history, { role: "user", content: withNotes(text, context) }], (t) => {
        reply += t;
        setDraft(reply);
      });
      setSteps((s) => s.map((x) => ({ ...x, done: true })));
      setStepsOpen(false);
    } catch (e) {
      setErr(String(e));
    }
    if (reply && garbled) reply += GARBLED_NOTE;
    if (reply && sources.length) reply += "\n\nSources: " + sources.join(" · ");
    if (reply) nerida.upsert({ ...base, messages: [...messages, { role: "assistant", content: reply }], updatedAt: Date.now() });
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
        {(files.length > 0 || reading > 0) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {files.map((f) => (
              <span key={f.name} title={f.truncated ? "Long file: only the first part is used" : f.name} className="flex max-w-[180px] items-center gap-1 rounded-md border border-sky-300/20 bg-sky-300/[0.05] px-1.5 py-0.5 text-[11.5px] text-neutral-300">
                <FileText className="size-3 shrink-0 text-sky-300" /><span className="truncate">{f.name}</span>
                <button type="button" title="Remove" className="cursor-pointer text-neutral-500 hover:text-neutral-200" onClick={() => setFiles((x) => x.filter((y) => y !== f))}><X className="size-3" /></button>
              </span>
            ))}
            {reading > 0 && <span className="oc-nerida-shimmer px-1.5 py-0.5 text-[11.5px]">Reading file…</span>}
          </div>
        )}
        {allNotes.some((n) => !excluded.has(n.id)) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {allNotes.filter((n) => !excluded.has(n.id)).map((n) => {
              const off = false;
              return (
                <span key={n.id} title={n.why} className={`flex max-w-[160px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] ${off ? "border-white/[0.05] text-neutral-600 line-through" : "border-white/[0.1] text-neutral-300"}`}>
                  <span>{n.icon}</span><span className="truncate">{n.title}</span>
                  <button type="button" title={off ? "Include" : "Exclude"} className="cursor-pointer text-neutral-500 hover:text-neutral-200"
                    onClick={() => setExcluded((s) => { const x = new Set(s); if (off) x.delete(n.id); else x.add(n.id); return x; })}>
                    {off ? <Plus className="size-3" /> : <X className="size-3" />}
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {mentionHits.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border border-white/[0.08] bg-neutral-900 p-1 shadow-xl">
            {mentionHits.map((p) => (
              <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); addMention(p.id); }} className="flex w-full cursor-pointer items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">
                <span>{p.icon}</span><span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-2 focus-within:border-teal-300/40">
          <textarea
            value={input}
            disabled={!ready}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && mentionHits.length) {
                e.preventDefault();
                addMention(mentionHits[0].id);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={Math.min(6, input.split("\n").length)}
            placeholder={ready ? "Ask Nerida… (type @ to add a note)" : "Download Nerida to start"}
            className="max-h-40 min-h-[40px] w-full resize-none bg-transparent px-1.5 pt-1 text-[13.5px] text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <div className="flex items-center gap-1">
          <button type="button" disabled={!ready || busy} title="Attach PDF, Word or text files" onClick={() => filePicker.current?.click()} className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:text-neutral-600"><Paperclip className="size-4" /></button>
          {b === "plus" && <button type="button" disabled={busy} title={online ? "Web search on" : "Search the web"} aria-pressed={online} onClick={() => setOnline((v) => !v)} className={`grid size-7 cursor-pointer place-items-center rounded-lg hover:bg-white/[0.06] ${online ? "text-sky-400" : "text-neutral-400 hover:text-neutral-200"}`}><Globe className="size-4" /></button>}
          <div className="flex-1" />
          <ModelMenu disabled={busy} />
          {busy ? (
            <button type="button" title="Stop" onClick={() => void engine.stop()} className="grid size-7 cursor-pointer place-items-center rounded-lg bg-white/[0.1] text-neutral-200 hover:bg-white/[0.15]"><Square className="size-3" fill="currentColor" /></button>
          ) : (
            <button type="button" title="Send" disabled={!input.trim() || !ready} onClick={() => void send(input)} className="grid size-7 cursor-pointer place-items-center rounded-lg bg-teal-400/90 text-neutral-950 hover:bg-teal-300 disabled:cursor-default disabled:bg-white/[0.08] disabled:text-neutral-500"><ArrowUp className="size-4" /></button>
          )}
          </div>
        </div>
      </div>
  );
  const lastAssistant = msgs.map((m) => m.role).lastIndexOf("assistant");

  return (
    <>
    <NeridaBetaCard />
    {intro && (
      <NeridaIntro
        onLater={() => nerida.set(home ? { homeMode: "home" } : { open: false })}
        onDownload={(m) => { setDefaultModel(`nerida:${m}`); setAuto(true); }}
      />
    )}
    <aside
      onDragOver={(e) => { if (ready && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { if (!ready || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); void addFiles(e.dataTransfer.files); }}
      className={home ? "oc-page-in flex h-full w-full flex-col" : "oc-nerida-in flex h-full w-[360px] shrink-0 flex-col border-l border-white/[0.06] bg-neutral-900/60"}>
      {/* header */}
      {home ? (
        <div className="h-12 shrink-0" />
      ) : (
      <div className="relative flex h-11 shrink-0 items-center gap-1.5 px-3">
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
          <div className="absolute left-3 top-10 z-20 max-h-72 w-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-neutral-900 p-1 shadow-xl">
            {chats.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-neutral-500">No chats yet</p>}
            {chats.map((c) => (
              <div key={c.id} className="group flex items-center rounded-md hover:bg-white/[0.06]">
                <button type="button" onClick={() => { nerida.set({ activeId: c.id }); setHistoryOpen(false); }} className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left text-[12.5px] text-neutral-300">{c.title}</button>
                <button type="button" title="Delete chat" onClick={() => nerida.remove(c.id)} className="mr-1 hidden cursor-pointer text-neutral-500 hover:text-red-400 group-hover:block"><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* conversation */}
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3">
      <div className={home ? "mx-auto w-full max-w-3xl" : ""}>
        {b && status && !ready && !intro && <Setup key={b} status={status} model={b} auto={auto} onDone={() => void refresh()} />}
        {b && ready && status?.models.find((m) => m.id === b)?.outdated && <UpdateBanner model={b} size={status.models.find((m) => m.id === b)!.size} onDone={() => void refresh()} />}
        {ready && !msgs.length && !busy && home && (
          <div className="mt-[16vh] text-center">
            <div className="mx-auto mb-4 grid place-items-center"><NeridaMark size={64} /></div>
            <p className="text-[28px] font-semibold tracking-tight text-neutral-100">{greeting()}</p>
            <p className="mt-1 text-[15px] text-neutral-400">How can Nerida help you today?</p>
            <div className="mx-auto mt-6 max-w-2xl text-left">{composer}</div>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {["Summarize a note", "Make flashcards from my notes", "Quiz me on a topic", "Help me plan my study week", "Make a mindmap"].map((s) => (
                <button key={s} type="button" onClick={() => (s === "Make a mindmap" ? void createMindmap("").then((id) => (sessionStorage.setItem(MAP_FLAG, id), window.dispatchEvent(new CustomEvent(OPEN_MINDMAP, { detail: id })))) : setInput(s.includes("note") ? s + " @" : s))} className="cursor-pointer rounded-full border border-white/[0.08] px-3 py-1 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">{s}</button>
              ))}
            </div>
          </div>
        )}
        {ready && !msgs.length && !busy && !home && (
          <div className="mt-10 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-white/[0.05]"><NeridaMark size={24} /></div>
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
            <div key={i} className="mt-4 flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/[0.07] px-3 py-2 text-[13.5px] text-neutral-100">{m.content}</div></div>
          ) : (
            <div key={i} className="group mt-4">
              <Markdown text={m.content} />
              <div className="mt-1 flex gap-0.5 text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100">
                <Act title="Copy" onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1200); }}>{copied === i ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Act>
                {pageId && <Act title="Insert into note" onClick={() => window.dispatchEvent(new CustomEvent("oc-nerida-insert", { detail: m.content }))}><FileInput className="size-3.5" /></Act>}
                {i === lastAssistant && <Act title="Retry" onClick={retry}><RotateCcw className="size-3.5" /></Act>}
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
                        {s.done ? <Check className="size-3 text-teal-400" /> : <span className="size-1.5 animate-pulse rounded-full bg-teal-300" />}
                        {s.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {draft && <Markdown text={draft} />}
          </div>
        )}
        {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">{err}</p>}
      </div>
      </div>

      {/* composer */}
      {!(home && ready && !msgs.length && !busy) && <div className={home ? "mx-auto w-full max-w-3xl px-4 pb-4" : "shrink-0 p-3 pt-0"}>{composer}</div>}
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
        {(["lite", "plus"] as ModelId[]).map((m) => <option key={m} value={`nerida:${m}`}>{MODEL_NAMES[m]}</option>)}
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
