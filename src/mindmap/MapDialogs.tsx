/* ---------------------------------------------------------------------------
 * Oceanic Mindmap: "New mindmap" (name + logo) and "Change logo" dialogs,
 * opened imperatively so any caller can simply `await` them.
 * ------------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useMapLogo } from "./useMapLogo";
import { Modal, ModalButton } from "../components/Modal";
import { api, type MindmapRecord } from "../data/api";
import { ROOT } from "./model";

export const LOGOS = [
  "🧠", "💡", "⚛️", "🧪", "📐", "💻", "📚", "🌍", "🧬", "🔭", "🎨", "🎵",
  "📝", "📊", "🗂️", "🚀", "🎯", "⭐", "🔥", "🌱", "🌊", "🏛️", "⚙️", "🧩",
  "📌", "🗺️", "🧭", "💼", "🏆", "❤️", "🍎", "🐙", "🦋", "☀️", "🌙", "✏️",
];

/** Mounts a dialog in its own root and resolves with its answer. */
function mount<T>(render: (done: (v: T | null) => void) => React.ReactNode): Promise<T | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: T | null) => {
      resolve(v);
      queueMicrotask(() => (root.unmount(), host.remove()));
    };
    root.render(render(done));
  });
}

function LogoGrid({ value, onPick }: { value: string; onPick: (e: string) => void }) {
  const [custom, setCustom] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-12 gap-1">
        {LOGOS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className={`grid aspect-square cursor-pointer place-items-center rounded-md text-[18px] transition-colors ${
              value === e ? "bg-[color:var(--oc-mm-violet)]/30 ring-1 ring-[color:var(--oc-mm-violet-light)]" : "hover:bg-white/[0.08]"
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(ev) => {
          setCustom(ev.target.value);
          const first = ev.target.value.trim().match(/^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|^\S/u)?.[0];
          if (first) onPick(first);
        }}
        placeholder="…or type / paste any emoji"
        className="h-8 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[13px] text-neutral-100 outline-none focus:border-[color:var(--oc-mm-violet-light)]/60"
      />
    </div>
  );
}

function NewMapDialog({ name, logo, done }: { name: string; logo: string; done: (v: { name: string; logo: string } | null) => void }) {
  const [title, setTitle] = useState(name);
  const [icon, setIcon] = useState(logo);
  return (
    <Modal onClose={() => done(null)} className="w-[460px]">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) done({ name: title.trim(), logo: icon });
        }}
      >
        <h2 className="text-[15px] font-semibold text-neutral-100">New mindmap</h2>
        <div className="flex items-center gap-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[22px]">{icon}</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Mindmap name"
            className="h-10 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-[14px] text-neutral-100 outline-none focus:border-[color:var(--oc-mm-violet-light)]/60"
          />
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-neutral-500">Logo</p>
          <LogoGrid value={icon} onPick={setIcon} />
        </div>
        <div className="flex justify-end gap-2">
          <ModalButton onClick={() => done(null)}>Cancel</ModalButton>
          <button
            type="submit"
            disabled={!title.trim()}
            className="h-8 cursor-pointer rounded-md bg-[var(--oc-mm-violet)] px-3 text-[13px] font-medium text-[#fff] hover:brightness-110 disabled:cursor-default disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LogoDialog({ logo, done }: { logo: string; done: (v: string | null) => void }) {
  const [icon, setIcon] = useState(logo);
  useEffect(() => setIcon(logo), [logo]);
  return (
    <Modal onClose={() => done(null)} className="w-[460px]">
      <div className="flex flex-col gap-4 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-neutral-100">
          <span className="text-[22px]">{icon}</span> Change logo
        </h2>
        <LogoGrid value={icon} onPick={setIcon} />
        <div className="flex justify-end gap-2">
          <ModalButton onClick={() => done(null)}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={() => done(icon)}>
            Save
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}

/** Asks for a new map's name and logo; null if cancelled. */
export const askNewMap = (name: string, logo: string) => mount<{ name: string; logo: string }>((done) => <NewMapDialog name={name} logo={logo} done={done} />);

/** Asks for a logo; null if cancelled. */
export const askLogo = (logo: string) => mount<string>((done) => <LogoDialog logo={logo} done={done} />);

/** "Change logo" for a saved map (from Home or the sidebar). */
export async function changeMapLogo(m: MindmapRecord, current: string) {
  const logo = await askLogo(current);
  if (!logo) return;
  const full = await api.getMindmapById(m.id);
  if (!full) return;
  const nodes = full.nodes.map((n) => {
    if (n.id !== ROOT) return n;
    let style = {};
    try {
      style = JSON.parse(n.styleJson || "{}");
    } catch {
      /* keep default */
    }
    return { ...n, styleJson: JSON.stringify({ ...style, logo }) };
  });
  await api.saveMindmap(m.id, full.title, full.subjectTag, nodes);
  window.dispatchEvent(new CustomEvent("oceanic:mindmap-saved", { detail: m.id }));
}

/** A map's logo, for list rows that don't hold its nodes. */
export function MapLogo({ map }: { map: MindmapRecord }) {
  return <>{useMapLogo(map)}</>;
}
