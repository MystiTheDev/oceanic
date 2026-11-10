import { useEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Check, ChevronDown, Cloud, Cpu, KeyRound, Plus, Server } from "lucide-react";
import {
  engine, isCloud, listModels, MODEL_NAMES, modelLabel, OLLAMA_URL, openNeridaSettings, setDefaultModel, useNerida,
  type AiStatus, type ModelId, type ModelRef,
} from "../lib/nerida";
import { BetaPill, NeridaMark } from "./NeridaOrb";

const ABOUT: Record<ModelId, string> = { lite: "Fast · runs on this PC", plus: "Smarter · runs on this PC" };

/** Claude-style model picker for the chat bar: rich rows, grouped, opens upward.
 *  Models that aren't downloaded are grayed and lead to Settings → Nerida AI. */
/** `inSettings`: bordered field that opens downward; gray rows do nothing. */
export function ModelMenu({ disabled, inSettings }: { disabled?: boolean; inSettings?: boolean }) {
  const { model, providers } = useNerida();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [ollama, setOllama] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !isTauri()) return;
    void engine.status().then(setStatus).catch(() => {});
    void listModels(OLLAMA_URL).then(setOllama).catch(() => setOllama([]));
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("mousedown", close), window.removeEventListener("keydown", esc));
  }, [open]);

  const choose = (ref: ModelRef) => (setDefaultModel(ref), setOpen(false));
  const goSettings = (focus: "openai" | "ollama" | null) => (setOpen(false), openNeridaSettings(focus));

  const Row = ({ refId, icon, name, desc, gray }: { refId?: ModelRef; icon: ReactNode; name: string; desc: string; gray?: boolean }) => (
    <button type="button" onClick={() => (gray || !refId ? !inSettings && goSettings(null) : choose(refId))}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06] ${gray ? "opacity-45" : ""}`}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.05]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-neutral-100">{name}</span>
        <span className="block truncate text-[11.5px] text-neutral-500">{desc}</span>
      </span>
      {refId === model && !gray && <Check className="size-4 shrink-0 text-teal-300" />}
    </button>
  );
  const Group = ({ label }: { label: string }) => <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>;

  return (
    <div ref={root} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} title="Choose model"
        className={inSettings ? "flex h-8 min-w-[150px] cursor-pointer items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 hover:bg-white/[0.07]" : "flex h-7 max-w-[160px] cursor-pointer items-center gap-1 rounded-lg px-2 text-[12.5px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:opacity-50"}>
        <span className="truncate">{modelLabel(model) || "Choose model"}</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`oc-pop-in absolute right-0 z-30 ${inSettings ? "top-full mt-2" : "bottom-full mb-2"} max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/[0.08] bg-neutral-900 p-1.5 shadow-2xl shadow-black/60`}>
          <div className="flex items-center"><Group label="Nerida" /><BetaPill /></div>
          {(["lite", "plus"] as ModelId[]).map((m) => {
            const installed = !!status?.server && !!status.models.find((x) => x.id === m)?.installed;
            return <Row key={m} refId={`nerida:${m}`} icon={<NeridaMark size={18} />} name={MODEL_NAMES[m]} desc={installed || !status ? ABOUT[m] : inSettings ? "Not downloaded" : "Not downloaded · open Settings"} gray={!!status && !installed} />;
          })}

          {ollama.length > 0 && <Group label="Ollama" />}
          {ollama.map((m) => <Row key={m} refId={`ollama:${m}`} icon={<Cpu className="size-4 text-neutral-300" />} name={m} desc="Local · Ollama" />)}

          {providers.filter((p) => p.models.length).map((p) => (
            <div key={p.id}>
              <Group label={p.name} />
              {p.models.map((m) => {
                const ref = `custom:${p.id}:${m}`;
                return <Row key={m} refId={ref} icon={isCloud(ref) ? <Cloud className="size-4 text-amber-300" /> : <Server className="size-4 text-neutral-300" />} name={m} desc={isCloud(ref) ? `Cloud · ${p.name}` : `Local · ${p.name}`} />;
              })}
            </div>
          ))}

          <div className="my-1.5 border-t border-white/[0.06]" />
          {ollama.length === 0 && (
            <button type="button" onClick={() => goSettings("ollama")} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-300 hover:bg-white/[0.06]">
              <Plus className="size-4 text-neutral-500" /> Add Ollama local model
            </button>
          )}
          <button type="button" onClick={() => goSettings("openai")} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-300 hover:bg-white/[0.06]">
            <KeyRound className="size-4 text-neutral-500" /> Add OpenAI API key
          </button>
        </div>
      )}
    </div>
  );
}
