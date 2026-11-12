import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { Check, ChevronDown, Cloud, Cpu, KeyRound, Plus, Server, Settings2 } from "lucide-react";
import {
  engine, isCloud, listModels, MODEL_NAMES, modelLabel, OLLAMA_URL, openNeridaSettings, setDefaultModel, useNerida,
  type AiStatus, type ModelId, type ModelRef,
} from "../lib/nerida";
import { BetaPill, NeridaMark } from "./NeridaOrb";

const ABOUT: Record<ModelId, string> = { plus: "Smart · runs on this PC" };

type Badge = { text: string; tone: "green" | "gray" | "amber" | "sky" };
const TONE: Record<Badge["tone"], string> = {
  green: "bg-teal-400/15 text-teal-200",
  gray: "bg-white/[0.06] text-neutral-400",
  amber: "bg-amber-400/15 text-amber-200",
  sky: "bg-sky-400/15 text-sky-200",
};

/** Model picker for the chat bar: grouped rows with status badges, keyboard nav.
 *  Rendered in a portal so no parent can clip or cover it.
 *  `inSettings`: bordered field that opens downward; gray rows do nothing. */
export function ModelMenu({ disabled, inSettings }: { disabled?: boolean; inSettings?: boolean }) {
  const { model, providers } = useNerida();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [ollama, setOllama] = useState<string[]>([]);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (isTauri()) {
      void engine.status().then(setStatus).catch(() => {});
      void listModels(OLLAMA_URL).then(setOllama).catch(() => setOllama([]));
    }
    const close = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    const shut = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", shut);
    return () => (window.removeEventListener("mousedown", close), window.removeEventListener("resize", shut));
  }, [open]);

  // Anchor to the button: right-aligned, above (chat bar) or below (Settings).
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const left = Math.max(8, r.right - 296);
    setPos(inSettings ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 });
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("[data-sel]")?.focus() ?? menu.current?.querySelector("button")?.focus());
  }, [open, inSettings]);

  const choose = (ref: ModelRef) => (setDefaultModel(ref), setOpen(false), btn.current?.focus());
  const goSettings = (focus: "openai" | "ollama" | null) => (setOpen(false), openNeridaSettings(focus));

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") return (e.preventDefault(), setOpen(false), btn.current?.focus());
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[n]?.focus();
  };

  const Row = ({ refId, icon, name, badge, gray }: { refId: ModelRef; icon: ReactNode; name: string; badge: Badge; gray?: boolean }) => {
    const sel = refId === model && !gray;
    return (
      <button type="button" data-sel={sel || undefined} onClick={() => (gray ? !inSettings && goSettings(null) : choose(refId))}
        className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08] ${sel ? "bg-teal-400/[0.07]" : ""}`}>
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] ${gray ? "opacity-50" : ""}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] ${gray ? "text-neutral-400" : "text-neutral-100"}`}>{name}</span>
          <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10.5px] font-medium ${TONE[badge.tone]}`}>{badge.text}</span>
        </span>
        {sel && <Check className="size-4 shrink-0 text-teal-300" />}
      </button>
    );
  };
  const Group = ({ label, extra }: { label: string; extra?: ReactNode }) => (
    <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">{label}{extra}</p>
  );
  const Action = ({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-300 outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.08]">
      <span className="grid size-5 place-items-center text-neutral-500">{icon}</span>{label}
    </button>
  );

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} title="Choose model" aria-haspopup="menu" aria-expanded={open}
        onKeyDown={(e) => e.key === "ArrowUp" || e.key === "ArrowDown" ? (e.preventDefault(), setOpen(true)) : undefined}
        className={inSettings ? "flex h-8 min-w-[150px] cursor-pointer items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 hover:bg-white/[0.07]" : `flex h-7 max-w-[170px] cursor-pointer items-center gap-1 rounded-lg px-2 text-[12.5px] transition-colors hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:opacity-50 ${open ? "bg-white/[0.06] text-neutral-200" : "text-neutral-400"}`}>
        <span className="truncate">{modelLabel(model) || "Choose model"}</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" onKeyDown={onKey} style={{ position: "fixed", ...pos }}
          className="oc-pop-in z-[1000] max-h-[60vh] w-[288px] overflow-y-auto rounded-xl border border-white/[0.1] bg-neutral-800/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl scrollbar-thin">
          <Group label="Nerida" extra={<BetaPill />} />
          {(["plus"] as ModelId[]).map((m) => {
            const installed = !!status?.server && !!status.models.find((x) => x.id === m)?.installed;
            const badge: Badge = !status ? { text: ABOUT[m], tone: "gray" }
              : !installed ? { text: inSettings ? "Not downloaded" : "Not downloaded · set up", tone: "amber" }
              : status.running === m ? { text: "Running · this PC", tone: "green" } : { text: "Ready · this PC", tone: "gray" };
            return <Row key={m} refId={`nerida:${m}`} icon={<NeridaMark size={18} />} name={MODEL_NAMES[m]} badge={badge} gray={!!status && !installed} />;
          })}

          {ollama.length > 0 && <Group label="Ollama" />}
          {ollama.map((m) => <Row key={m} refId={`ollama:${m}`} icon={<Cpu className="size-4 text-neutral-300" />} name={m} badge={{ text: "Local", tone: "sky" }} />)}

          {providers.filter((p) => p.models.length).map((p) => (
            <div key={p.id}>
              <Group label={p.name} />
              {p.models.map((m) => {
                const ref = `custom:${p.id}:${m}`;
                const cloud = isCloud(ref);
                return <Row key={m} refId={ref} icon={cloud ? <Cloud className="size-4 text-amber-300" /> : <Server className="size-4 text-neutral-300" />} name={m} badge={cloud ? { text: "Cloud", tone: "amber" } : { text: "Local", tone: "sky" }} />;
              })}
            </div>
          ))}

          <div className="my-1.5 border-t border-white/[0.06]" />
          {ollama.length === 0 && <Action icon={<Plus className="size-4" />} label="Add Ollama local model" onClick={() => goSettings("ollama")} />}
          <Action icon={<KeyRound className="size-4" />} label="Add OpenAI API key" onClick={() => goSettings("openai")} />
          {!inSettings && <Action icon={<Settings2 className="size-4" />} label="Manage models" onClick={() => goSettings(null)} />}
        </div>,
        document.body,
      )}
    </>
  );
}
