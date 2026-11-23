import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  downloadCuda, downloadModel, downloadVision, engine, isLocalUrl, nerida, listModels, MODEL_NAMES, OLLAMA_URL, PRESETS, saveProviders, setKey, uid, useNerida,
  type AiStatus, type ModelId, type Provider,
} from "../lib/nerida";
import { ModelMenu } from "./NeridaModelMenu";
import { Bell, Cpu, Eye, Gauge, MessageSquareText, Sparkles, Star, type LucideIcon } from "lucide-react";
import { ask } from "./ConfirmDialog";
import { useEscape } from "../lib/overlay";
import { Switch } from "./SettingsModal";
import { getAskMode, setAskMode, type AskMode } from "../lib/neridaAsk";

function AskModePick() {
  const [v, setV] = useState(getAskMode);
  return (
    <select value={v} onChange={(e) => { const m = e.target.value as AskMode; setV(m); setAskMode(m); }}
      className="cursor-pointer rounded-lg border border-white/[0.1] bg-neutral-900 px-2 py-1 text-[12.5px] text-neutral-200 outline-none">
      <option value="smart">When unclear</option>
      <option value="always">Always</option>
      <option value="off">Never</option>
    </select>
  );
}

/* Nerida settings look: grouped cards, muted row icons, cyan→violet accent. */
const card = "overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] divide-y divide-white/[0.05]";
const rowCls = "flex items-center gap-3 px-4 py-3";
const accentBtn = "cursor-pointer rounded-md bg-gradient-to-r from-[#38d6ff] to-[#7c3aed] px-3 py-1 text-[12.5px] font-medium text-white shadow-sm shadow-violet-900/30 hover:brightness-110 disabled:cursor-default disabled:opacity-40";
const RowIcon = ({ icon: I }: { icon: LucideIcon }) => (
  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-neutral-400"><I className="size-4" /></span>
);
const sectionTitle = "mt-6 mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500";

const ABOUT: Record<ModelId, string> = {
  plus: "Smarter answers, better explanations, flashcards and quizzes. Best with 8 GB+ RAM.",
};
const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/** Settings → Nerida AI: download / delete models and pick the default. */
export function NeridaSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const { dl: prog, dlWaiting, gpu, style, notify } = useNerida();
  const [gpus, setGpus] = useState<{ id: string; name: string; mem_mib: number }[] | null>(null);
  const [err, setErr] = useState("");
  const refresh = () => engine.status().then(setStatus).catch((e) => setErr(String(e)));
  useEffect(() => {
    if (isTauri()) (void refresh(), void engine.gpus().then(setGpus).catch(() => setGpus([])));
  }, []);

  if (!isTauri()) return <p className="text-[13px] text-neutral-500">Nerida runs in the Oceanic desktop app.</p>;
  if (!status) return null;

  const download = async (id: ModelId, engineOnly = false) => {
    setErr("");
    setErr(await downloadModel(id, !status.server, engineOnly));
    void refresh();
  };
  const remove = async (id: ModelId) => {
    if (!(await ask({ title: `Delete ${MODEL_NAMES[id]}?`, body: "You can download it again any time.", confirm: "Delete" }))) return;
    await invoke<void>("ai_delete_model", { model: id }).catch((e) => setErr(String(e)));
    void refresh();
  };
  const used = status.models.filter((m) => m.installed).reduce((s, m) => s + m.size, 0);

  return (
    <div>
      <p className="mb-1 px-1 text-[12px] text-neutral-500">Runs on this PC: your notes never leave it · {size(used)} used</p>
      {!status.server && used > 0 && (
        <div className="mb-2 flex items-center gap-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-amber-200/90">
            Nerida's engine (<code>llama-server.exe</code>) is missing. Your antivirus may have removed it. Add Oceanic's <code>nerida</code> folder to its exclusions, then download it again (~38 MB).
          </p>
          <button type="button" disabled={!!prog} onClick={() => void download(status.models.find((m) => m.installed)!.id, true)} className={accentBtn}>Download engine</button>
        </div>
      )}
      <p className={sectionTitle}>Model</p>
      <div className={card}>
      {status.models.map((m) => {
        const busy = prog?.model === m.id;
        return (
          <div key={m.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <RowIcon icon={Sparkles} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-neutral-100">
                  {MODEL_NAMES[m.id]} <span className="text-[12px] text-neutral-500">· {size(m.size)}</span>
                  {m.installed && !m.outdated && <span className="ml-2 rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[11px] text-cyan-300">Installed</span>}
                  {m.outdated && <span className="ml-2 rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[11px] text-sky-300">Update available</span>}
                </p>
                <p className="text-[12px] text-neutral-500">{ABOUT[m.id]}</p>
              </div>
              {busy ? (
                <button type="button" onClick={() => void engine.cancelDownload()} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Cancel</button>
              ) : m.outdated ? (
                <button type="button" disabled={!!prog} onClick={() => void download(m.id)} className="cursor-pointer rounded-md bg-sky-400/90 px-2.5 py-1 text-[12.5px] font-medium text-neutral-950 hover:bg-sky-300 disabled:cursor-default disabled:opacity-40">Update</button>
              ) : m.installed ? (
                <button type="button" onClick={() => void remove(m.id)} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-red-400">Delete</button>
              ) : (
                <button type="button" disabled={!!prog} onClick={() => void download(m.id)} className={accentBtn}>Download</button>
              )}
            </div>
            {busy && (
              <div className="mt-2 pl-11">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#38d6ff] to-[#7c3aed]" style={{ width: `${(prog.got / prog.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11.5px] text-neutral-500">{dlWaiting ? "Waiting for Nerida's reply to finish…" : `${size(prog.got)} / ${size(prog.total)}`}</p>
              </div>
            )}
          </div>
        );
      })}
      <div className={rowCls}>
        <RowIcon icon={Star} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Default model</p>
          <p className="text-[12px] text-neutral-500">Used for new chats and all Nerida features. You can still switch inside a chat.</p>
        </div>
        <ModelMenu inSettings />
      </div>
      </div>
      <p className={sectionTitle}>Answers</p>
      <div className={card}><div className={rowCls}>
        <RowIcon icon={MessageSquareText} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Reply style</p>
          <p className="text-[12px] text-neutral-500">How the chat answers.</p>
        </div>
        <StyleSwitch value={style} />
      </div><div className={rowCls}>
        <RowIcon icon={Bell} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Notify when done</p>
          <p className="text-[12px] text-neutral-500">Desktop notification when Nerida finishes while Oceanic is in the background.</p>
        </div>
        <Switch on={notify} onChange={nerida.setNotify} />
      </div><div className={rowCls}>
        <RowIcon icon={MessageSquareText} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Ask before note actions</p>
          <p className="text-[12px] text-neutral-500">Agent asks questions before creating, deleting, renaming or reading notes.</p>
        </div>
        <AskModePick />
      </div></div>
      <p className={sectionTitle}>Performance</p>
      <div className={card}><div className={rowCls}>
        <RowIcon icon={Gauge} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Graphics card</p>
          <p className="text-[12px] text-neutral-500">{gpus === null ? "Looking for graphics cards…" : "A dedicated card is usually fastest."}</p>
        </div>
        <GpuMenu value={gpu} options={[
          ["auto", "Automatic", "recommended"],
          ...(status.cuda ? [["cuda", "NVIDIA", "fast engine"] as const] : []),
          ...(gpus ?? []).map((g) => [g.id, g.name, `${(g.mem_mib / 1024).toFixed(1)} GB`] as const),
          ["cpu", "Processor only", "no graphics card"],
        ]} />
      </div></div>
      <p className={sectionTitle}>Extra modules</p>
      <div className={card}>
        <ModuleRow icon={Eye} name="Vision" size="668 MB" installed={status.vision} busy={!!prog}
          about="Reads scanned PDF pages."
          lose={`Delete Vision (668 MB)?

You will lose: reading scanned PDFs and pictures of pages. Nerida will only read PDFs that contain real text.

You can download it again here any time.`}
          onDelete={() => void invoke<void>("ai_delete_model", { model: "vision" }).then(() => nerida.setNoVision(true)).catch((e) => setErr(String(e))).then(refresh)}
          onDownload={async () => {
            nerida.setNoVision(false);
            setErr(await downloadVision());
            void refresh();
          }} />
        <ModuleRow icon={Cpu} name="NVIDIA engine" size="1.2 GB" installed={status.cuda} busy={!!prog} disabled={!status.nvidia && !status.cuda}
          about={status.nvidia || status.cuda ? "Faster on long notes and PDFs." : "Needs an NVIDIA card (none found)."}
          lose={`Delete the NVIDIA engine (1.2 GB)?

You will lose: the faster start on long notes, PDFs and attached files (back to ~20 s). Nerida keeps working with the standard engine.

You can download it again here any time.`}
          onDelete={() => void invoke<void>("ai_delete_model", { model: "cuda" }).catch((e) => setErr(String(e))).then(refresh)}
          onDownload={() => void downloadCuda().then((e) => (setErr(e), refresh()))} />
      </div>
      {err && <p className="mt-3 text-[12.5px] text-red-400">{err}</p>}
      <p className={sectionTitle}>Other models</p>
      <OllamaSection />
      <Providers />
    </div>
  );
}

const field = "h-8 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 outline-none focus:border-teal-300/50";

/** Ollama: nothing to configure; models found on this PC appear in the picker. */
function OllamaSection() {
  const [models, setModels] = useState<string[] | null>(null);
  const check = () => listModels(OLLAMA_URL).then(setModels).catch(() => setModels([]));
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    void check();
    if (nerida.get().settingsFocus === "ollama") {
      nerida.set({ settingsFocus: null });
      setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, []);
  return (
    <>
      <p ref={ref} className="mt-3 text-[13px] font-medium text-neutral-300">Ollama</p>
      <div className="flex items-center gap-4 border-b border-white/[0.05] py-3">
        <p className="min-w-0 flex-1 text-[12.5px] text-neutral-400">
          {models === null
            ? "Looking for Ollama…"
            : models.length
              ? `Found ${models.length} model${models.length > 1 ? "s" : ""}: ${models.join(", ")}. They appear in the model picker.`
              : <>Ollama isn't running on this PC. To use local models with it: install Ollama from <button type="button" className="cursor-pointer text-teal-300 hover:underline" onClick={() => void openUrl("https://ollama.com/download")}>ollama.com</button>, download a model (for example <code className="rounded bg-white/[0.08] px-1">ollama pull llama3.2</code>), keep Ollama running, then press Refresh.</>}
        </p>
        <button type="button" onClick={() => void check()} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Refresh</button>
      </div>
    </>
  );
}

type Draft = { preset: number; name: string; baseUrl: string; key: string; available: string[]; models: string[]; typed: string };
const DRAFT_KEY = "draft";

/** OpenAI-compatible providers (OpenAI, OpenRouter, Groq, Gemini, LM Studio, custom). Keys go to the OS keychain. */
function Providers() {
  const { providers } = useNerida();
  const [form, setForm] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nerida.get().settingsFocus !== "openai") return;
    nerida.set({ settingsFocus: null });
    pick(0);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) =>
    setForm({ preset: i, name: PRESETS[i].name === "Custom" ? "" : PRESETS[i].name, baseUrl: PRESETS[i].baseUrl, key: "", available: [], models: [], typed: "" });
  const load = async () => {
    if (!form) return;
    setMsg("Loading models…");
    try {
      await setKey(DRAFT_KEY, form.key || null, form.baseUrl);
      const available = await listModels(form.baseUrl, DRAFT_KEY);
      setForm({ ...form, available });
      setMsg(available.length ? "" : "No models returned. Type a model name below.");
    } catch (e) {
      setMsg(connectError(e));
    }
  };
  const cancel = () => {
    setForm(null);
    setMsg("");
    void setKey(DRAFT_KEY, null).catch(() => {});
  };
  useEscape(cancel, !!form);
  const urlBad = !!form?.baseUrl.trim() && !/^https?:\/\/[^\s/]+/i.test(form.baseUrl.trim());
  const keyMissing = !!form && PRESETS[form.preset].needsKey && !form.key.trim();
  const save = async () => {
    if (!form) return;
    const models = [...new Set([...form.models, ...form.typed.split(",").map((m) => m.trim()).filter(Boolean)])];
    if (!form.name.trim() || !form.baseUrl.trim() || !models.length) return setMsg("Add a name, URL and at least one model.");
    const p: Provider = { id: uid(), name: form.name.trim(), baseUrl: form.baseUrl.trim().replace(/\/+$/, ""), models };
    try {
      await setKey(p.id, form.key || null, p.baseUrl);
      saveProviders([...providers, p]);
      cancel();
    } catch (e) {
      setMsg(String(e));
    }
  };
  const remove = async (p: Provider) => {
    if (!(await ask({ title: `Remove ${p.name}?`, body: "Its saved API key is deleted too.", confirm: "Remove" }))) return;
    await setKey(p.id, null).catch(() => {});
    saveProviders(providers.filter((x) => x.id !== p.id));
  };

  return (
    <>
      <p className="mt-4 text-[13px] font-medium text-neutral-300">AI providers</p>
      <p className="mb-1 text-[12px] text-neutral-500">Connect your own API key or local server. Keys are stored in your system's secure keychain, never in Oceanic's files.</p>
      {providers.map((p) => (
        <div key={p.id} className="flex items-center gap-4 border-b border-white/[0.05] py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-neutral-100">
              {p.name}
              {!isLocalUrl(p.baseUrl) && <span className="ml-2 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-300">Cloud</span>}
            </p>
            <p className="truncate text-[12px] text-neutral-500">{p.models.join(", ")}</p>
          </div>
          <button type="button" onClick={() => void remove(p)} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-red-400">Remove</button>
        </div>
      ))}
      {!form ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p, i) => (
            <button key={p.name} type="button" onClick={() => pick(i)} className="cursor-pointer rounded-full border border-white/[0.1] px-3 py-1 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">+ {p.name}</button>
          ))}
        </div>
      ) : (
        <div ref={formRef} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "checkbox") { e.preventDefault(); void save(); } }}
          className="mt-3 space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={field} placeholder="Base URL, e.g. https://api.example.com/v1" value={form.baseUrl} aria-invalid={urlBad} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          {urlBad && <p className="px-0.5 text-[12px] text-red-300">Start the URL with http:// or https://</p>}
          {PRESETS[form.preset].needsKey && (
            <input className={field} type="password" autoComplete="off" placeholder="API key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          )}
          <button type="button" disabled={urlBad || !form.baseUrl.trim() || keyMissing} title={keyMissing ? "Add the API key first" : undefined} onClick={() => void load()} className="cursor-pointer rounded-md border border-white/[0.1] px-2.5 py-1 text-[12.5px] text-neutral-300 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40">Load models</button>
          {form.available.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-white/[0.06] p-1.5">
              {form.available.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-[12.5px] text-neutral-300">
                  <input type="checkbox" className="accent-teal-400" checked={form.models.includes(m)}
                    onChange={(e) => setForm({ ...form, models: e.target.checked ? [...form.models, m] : form.models.filter((x) => x !== m) })} />
                  {m}
                </label>
              ))}
            </div>
          )}
          <input className={field} placeholder="Or type model names, comma-separated" value={form.typed} onChange={(e) => setForm({ ...form, typed: e.target.value })} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={cancel} className="cursor-pointer rounded-md px-3 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06]">Cancel</button>
            <button type="button" onClick={() => void save()} className="cursor-pointer rounded-md bg-teal-400/90 px-3 py-1 text-[12.5px] font-medium text-neutral-950 hover:bg-teal-300">Save</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-[12px] text-neutral-400">{msg}</p>}
    </>
  );
}


/** Graphics card picker: [value, name, detail] rows. */
function GpuMenu({ value, options }: { value: string; options: (readonly [string, string, string])[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("mousedown", close), window.removeEventListener("keydown", esc));
  }, [open]);
  const cur = options.find((o) => o[0] === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex max-w-[260px] items-center gap-2 rounded-md border border-white/[0.1] bg-neutral-900 px-2.5 py-1.5 text-[12.5px] text-neutral-100 hover:border-white/[0.2]">
        <span className="truncate">{cur[1]}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[280px] rounded-lg border border-white/[0.1] bg-neutral-900 p-1 shadow-2xl shadow-black/60">
          {options.map(([v, name, detail]) => (
            <button key={v} onClick={() => (nerida.setGpu(v), setOpen(false))} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-white/[0.06] ${v === value ? "bg-white/[0.04]" : ""}`}>
              <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] text-neutral-100">{name}</span><span className="block text-[11px] text-neutral-500">{detail}</span></span>
              {v === value && <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-sky-400"><path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One optional add-on: size, what it does, and Delete (confirm says what's lost) or Download. */
function ModuleRow({ icon, name, size, about, lose, installed, busy, disabled, onDelete, onDownload }: { icon: LucideIcon; name: string; size: string; about: string; lose: string; installed: boolean; busy: boolean; disabled?: boolean; onDelete: () => void; onDownload: () => void }) {
  const { dl, dlWaiting } = useNerida();
  return (
    <div className={rowCls}>
      <RowIcon icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-neutral-100">{name} <span className="text-[12px] text-neutral-500">· {size}</span>{installed && <span className="ml-2 rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[11px] text-cyan-300">Installed</span>}</p>
        <p className="text-[12px] text-neutral-500">{about}</p>
      </div>
      {installed ? (
        <button type="button" disabled={busy} onClick={() => void ask({ title: "Delete?", body: lose, confirm: "Delete" }).then((ok) => ok && onDelete())} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-red-400 disabled:opacity-40">Delete</button>
      ) : (
        <button type="button" disabled={busy || disabled} onClick={onDownload} className={accentBtn}>{dlWaiting && dl?.label.endsWith(name.replace("Vision", "vision")) ?"Waiting for reply…" : "Download"}</button>
      )}
    </div>
  );
}

/** Reply style switch: the gradient pill slides to the chosen option. */
function StyleSwitch({ value }: { value: "short" | "tutor" }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const b = refs.current[value];
    if (b) setPill({ left: b.offsetLeft, width: b.offsetWidth });
  }, [value]);
  return (
    <div className="relative flex rounded-lg border border-white/[0.06] bg-black/20 p-0.5 text-[12.5px]">
      {pill && <span aria-hidden className="absolute top-0.5 bottom-0.5 rounded bg-gradient-to-r from-[#38d6ff]/25 to-[#7c3aed]/35 shadow-sm transition-[left,width] duration-[250ms] ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none" style={pill} />}
      {(["short", "tutor"] as const).map((s) => (
        <button key={s} ref={(el) => void (refs.current[s] = el)} type="button" aria-pressed={value === s} onClick={() => nerida.setStyle(s)}
          className={`relative cursor-pointer rounded px-2.5 py-1 transition-colors duration-200 ${value === s ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}>{s === "short" ? "Short" : "Detailed tutor"}</button>
      ))}
    </div>
  );
}

/** Plain-language reason for a failed model list request (raw text kept at the end for support). */
function connectError(e: unknown): string {
  const raw = String(e instanceof Error ? e.message : e);
  const why = /401|403|unauthor|invalid.*key/i.test(raw) ? "The API key was rejected. Check it and try again."
    : /404/.test(raw) ? "No model list at this URL. Most providers need the address to end in /v1."
    : /refused|error sending|connect|dns|timed? ?out|unreachable/i.test(raw) ? "Couldn't reach the server. Check the URL and that it's running."
    : "Couldn't load models.";
  return `${why} (${raw.slice(0, 160)})`;
}
