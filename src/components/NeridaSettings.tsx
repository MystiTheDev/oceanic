import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  downloadCuda, downloadModel, engine, isLocalUrl, nerida, listModels, MODEL_NAMES, OLLAMA_URL, PRESETS, saveProviders, setKey, uid, useNerida,
  type AiStatus, type ModelId, type Provider,
} from "../lib/nerida";
import { ModelMenu } from "./NeridaModelMenu";

const ABOUT: Record<ModelId, string> = {
  plus: "Smarter answers, better explanations, flashcards and quizzes. Best with 8 GB+ RAM.",
};
const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/** Settings → Nerida AI: download / delete models and pick the default. */
export function NeridaSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const { dl: prog, gpu } = useNerida();
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
    if (!confirm(`Delete ${MODEL_NAMES[id]}? You can download it again any time.`)) return;
    await invoke<void>("ai_delete_model", { model: id }).catch((e) => setErr(String(e)));
    void refresh();
  };
  const used = status.models.filter((m) => m.installed).reduce((s, m) => s + m.size, 0);

  return (
    <div>
      {/* Optional NVIDIA (CUDA) engine: never downloaded unless the user asks. */}
      <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
        <div className="flex items-center gap-4">
          <p className="min-w-0 flex-1 text-[12.5px] font-medium text-neutral-200">
            NVIDIA engine <span className="font-normal text-neutral-500">· optional · 1.2 GB</span>
          </p>
          {status.cuda ? (
            <button type="button" onClick={() => confirm("Delete the NVIDIA engine? Nerida keeps working with the standard engine.") && void invoke<void>("ai_delete_model", { model: "cuda" }).catch((e) => setErr(String(e))).then(refresh)} className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-red-400">Delete</button>
          ) : (
            <button type="button" disabled={!!prog || !status.nvidia} title={status.nvidia ? "" : "Needs an NVIDIA graphics card"} onClick={() => void downloadCuda().then((e) => (setErr(e), refresh()))} className="cursor-pointer rounded-md bg-teal-400/90 px-2.5 py-1 text-[12.5px] font-medium text-neutral-950 hover:bg-teal-300 disabled:cursor-default disabled:opacity-40">Download</button>
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">
          Uses NVIDIA's own CUDA tools. Nerida reads long notes, PDFs and attached files about 10× faster, so the first word of a reply comes in seconds instead of ~20 s.
          Writing speed stays about the same. Worth it if you often ask about long notes or PDFs, or make quizzes and flashcards from them; not needed for short questions.
        </p>
        <p className="mt-1 text-[11.5px] text-neutral-500">
          {status.cuda ? "Installed: chosen automatically, or pick it under Graphics card." : status.nvidia ? "Not installed. Nerida already uses your NVIDIA card with the standard engine." : "Needs an NVIDIA graphics card (none found on this PC)."}
        </p>
      </div>
      {/* Which graphics card runs Nerida. Lists every card the engine can see. */}
      <div className="mb-3 flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-[12.5px] text-neutral-300">
        <span className="flex-1">Graphics card<span className="block text-[11.5px] text-neutral-500">A dedicated card (NVIDIA, AMD Radeon RX, Intel Arc) is usually fastest.</span></span>
        <GpuMenu value={gpu} options={[
          ["auto", "Automatic", "recommended"],
          ...(status.cuda ? [["cuda", "NVIDIA", "fast engine"] as const] : []),
          ...(gpus ?? []).map((g) => [g.id, g.name, `${(g.mem_mib / 1024).toFixed(1)} GB`] as const),
          ["cpu", "Processor only", "no graphics card"],
        ]} />
      </div>
      {gpus === null && <p className="-mt-2 mb-3 text-[11.5px] text-neutral-500">Looking for graphics cards…</p>}
      <p className="mb-3 text-[12px] text-neutral-500">
        Nerida is Oceanic's free AI. It runs entirely on this PC, so your notes never leave it. Models use {size(used)} of disk space.
      </p>
      {!status.server && used > 0 && (
        <div className="mb-2 flex items-center gap-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-amber-200/90">
            Nerida's engine (<code>llama-server.exe</code>) is missing. Your antivirus may have removed it. Add Oceanic's <code>nerida</code> folder to its exclusions, then download it again (~38 MB).
          </p>
          <button type="button" disabled={!!prog} onClick={() => void download(status.models.find((m) => m.installed)!.id, true)} className="cursor-pointer rounded-md bg-teal-400/90 px-2.5 py-1 text-[12.5px] font-medium text-neutral-950 hover:bg-teal-300 disabled:opacity-40">Download engine</button>
        </div>
      )}
      {status.models.map((m) => {
        const busy = prog?.model === m.id;
        return (
          <div key={m.id} className="border-b border-white/[0.05] py-3">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-neutral-100">
                  {MODEL_NAMES[m.id]} <span className="text-[12px] text-neutral-500">· {size(m.size)}</span>
                  {m.installed && !m.outdated && <span className="ml-2 rounded-full bg-teal-400/15 px-1.5 py-0.5 text-[11px] text-teal-300">Installed</span>}
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
                <button type="button" disabled={!!prog} onClick={() => void download(m.id)} className="cursor-pointer rounded-md bg-teal-400/90 px-2.5 py-1 text-[12.5px] font-medium text-neutral-950 hover:bg-teal-300 disabled:cursor-default disabled:opacity-40">Download</button>
              )}
            </div>
            {busy && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-blue-400" style={{ width: `${(prog.got / prog.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11.5px] text-neutral-500">{size(prog.got)} / {size(prog.total)}</p>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-4 border-b border-white/[0.05] py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-neutral-100">Default model</p>
          <p className="text-[12px] text-neutral-500">Used for new chats and all Nerida features. You can still switch inside a chat.</p>
        </div>
        <ModelMenu inSettings />
      </div>
      {err && <p className="mt-3 text-[12.5px] text-red-400">{err}</p>}
      <OllamaSection />
      <Providers />
    </div>
  );
}

const field = "h-8 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 outline-none focus:border-teal-300/50";
const heading = "mt-6 mb-1 text-[12px] font-medium uppercase tracking-wide text-neutral-500";

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
      <p ref={ref} className={heading}>Ollama</p>
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
      await setKey(DRAFT_KEY, form.key || null);
      const available = await listModels(form.baseUrl, DRAFT_KEY);
      setForm({ ...form, available });
      setMsg(available.length ? "" : "No models returned. Type a model name below.");
    } catch (e) {
      setMsg(`Couldn't connect: ${e}`);
    }
  };
  const cancel = () => {
    setForm(null);
    setMsg("");
    void setKey(DRAFT_KEY, null).catch(() => {});
  };
  const save = async () => {
    if (!form) return;
    const models = [...new Set([...form.models, ...form.typed.split(",").map((m) => m.trim()).filter(Boolean)])];
    if (!form.name.trim() || !form.baseUrl.trim() || !models.length) return setMsg("Add a name, URL and at least one model.");
    const p: Provider = { id: uid(), name: form.name.trim(), baseUrl: form.baseUrl.trim().replace(/\/+$/, ""), models };
    try {
      await setKey(p.id, form.key || null);
      saveProviders([...providers, p]);
      cancel();
    } catch (e) {
      setMsg(String(e));
    }
  };
  const remove = async (p: Provider) => {
    if (!confirm(`Remove ${p.name}? Its saved API key is deleted too.`)) return;
    await setKey(p.id, null).catch(() => {});
    saveProviders(providers.filter((x) => x.id !== p.id));
  };

  return (
    <>
      <p className={heading}>Your AI providers</p>
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
        <div ref={formRef} className="mt-3 space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={field} placeholder="Base URL, e.g. https://api.example.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          {PRESETS[form.preset].needsKey && (
            <input className={field} type="password" autoComplete="off" placeholder="API key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          )}
          <button type="button" onClick={() => void load()} className="cursor-pointer rounded-md border border-white/[0.1] px-2.5 py-1 text-[12.5px] text-neutral-300 hover:bg-white/[0.06]">Load models</button>
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
