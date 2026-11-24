import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Smile, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Modal } from "./Modal";
import { Stepper } from "./Stepper";
import { AvatarCropper } from "./AvatarCropper";
import { EmojiPicker } from "./EmojiPicker";
import { Avatar, AvatarChoice, Select, SidebarIconsPicker, type AppSettings } from "./SettingsModal";
import { NeridaMark } from "./NeridaOrb";
import { DiffCard } from "./NeridaDiff";
import { downloadModel, engine, useNerida, type AiStatus } from "../lib/nerida";

/** Fired by Settings → About to open the wizard again. */
export const SETUP_START = "oc-setup-start";
export const startSetup = () => window.dispatchEvent(new Event(SETUP_START));

const input =
  "h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-[14px] text-neutral-100 outline-none focus:border-sky-500/60";
const Title = ({ t, sub }: { t: string; sub: string }) => (
  <div className="mb-4">
    <h2 className="text-[17px] font-semibold text-neutral-100">{t}</h2>
    <p className="mt-0.5 text-[13px] text-neutral-400">{sub}</p>
  </div>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-3 last:border-0">
    <span className="text-[13.5px] text-neutral-200">{label}</span>
    {children}
  </div>
);

/**
 * First launch: name + photo, workspace name + emoji, look, Nerida AI.
 * Choices save as they are made (so Look previews live); Finish starts the tour.
 */
export function SetupWizard({
  settings,
  onChange,
  workspace,
  onWorkspace,
  onDone,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  workspace?: { name: string; icon: string };
  onWorkspace: (name: string, icon: string) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(settings.userName);
  const [ws, setWs] = useState(workspace ?? { name: "", icon: "" });
  const [picker, setPicker] = useState<{ el: HTMLElement; for: "avatar" | "ws" } | null>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const kind = settings.avatar.startsWith("data:") ? "photo" : settings.avatar ? "emoji" : "initial";

  // The active workspace may load after the wizard opens.
  useEffect(() => {
    if (workspace) setWs((w) => (w.name ? w : workspace));
  }, [workspace]);

  const steps = [
    <>
      <Title t="Welcome to Oceanic 🌊" sub="What should we call you?" />
      <div className="flex items-center gap-4">
        <Avatar name={name} avatar={settings.avatar} size={56} />
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={input} />
      </div>
      <p className="mb-2 mt-5 text-[12px] text-neutral-500">Profile picture (optional)</p>
      <div className="flex gap-1.5">
        <AvatarChoice on={kind === "initial"} onClick={() => onChange({ avatar: "" })}><span className="text-[12px] font-semibold">Aa</span> Initial</AvatarChoice>
        <AvatarChoice on={kind === "emoji"} onClick={(e) => setPicker({ el: e.currentTarget, for: "avatar" })}><Smile className="size-3.5" /> Emoji</AvatarChoice>
        <AvatarChoice on={kind === "photo"} onClick={() => file.current?.click()}><Upload className="size-3.5" /> Photo</AvatarChoice>
      </div>
    </>,
    <>
      <Title t="Your workspace" sub="Give it a name and an icon. You can add more workspaces later." />
      <div className="flex items-center gap-3">
        <button type="button" onClick={(e) => setPicker({ el: e.currentTarget, for: "ws" })} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-[22px] hover:bg-white/[0.08]">
          {ws.icon || <Smile className="size-5 text-neutral-500" />}
        </button>
        <input value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} placeholder="Workspace name" className={input} />
      </div>
    </>,
    <>
      <Title t="Look" sub="Pick how Oceanic looks. Change it any time in Settings." />
      <Row label="Theme">
        <Select value={settings.theme} onChange={(theme) => onChange({ theme })} options={[["system", "Use system setting"], ["light", "Light"], ["dark", "Dark"]]} />
      </Row>
      <Row label="Sidebar icons">
        <SidebarIconsPicker settings={settings} onChange={onChange} />
      </Row>
    </>,
    <AiStep key="ai" />,
  ];

  const commit = (i: number) => {
    if (i === 0 && name.trim() !== settings.userName) onChange({ userName: name.trim() });
    if (i === 1 && ws.name.trim() && workspace && (ws.name.trim() !== workspace.name || ws.icon !== workspace.icon)) onWorkspace(ws.name.trim(), ws.icon);
  };

  return (
    <Modal className="w-[480px]" label="Set up Oceanic">
      <Stepper
        steps={steps}
        canNext={(i) => (i === 0 ? !!name.trim() : i === 1 ? !!ws.name.trim() : true)}
        onStep={commit}
        onFinish={onDone}
        finishLabel="Start tour"
      />
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setCrop(f);
        }}
      />
      {crop && <AvatarCropper file={crop} onDone={(avatar) => (onChange({ avatar }), setCrop(null))} onCancel={() => setCrop(null)} />}
      {picker && (
        <EmojiPicker
          anchor={picker.el}
          onSelect={(em) => (picker.for === "avatar" ? onChange({ avatar: em }) : setWs((w) => ({ ...w, icon: em })), setPicker(null))}
          onClose={() => setPicker(null)}
        />
      )}
    </Modal>
  );
}

/** Nerida step: download the built-in model now (keeps going in the background), or skip. */
function AiStep() {
  const { dl } = useNerida();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [err, setErr] = useState("");
  const refresh = () => engine.status().then(setStatus).catch((e) => setErr(String(e)));
  useEffect(() => {
    if (isTauri()) void refresh();
  }, []);
  const installed = !!status?.models.find((m) => m.id === "plus")?.installed;
  const start = async () => {
    if (!status) return;
    setErr(await downloadModel("plus", !status.server));
    void refresh();
  };
  const pct = dl ? Math.round((dl.got / Math.max(dl.total, 1)) * 100) : 0;

  return (
    <>
      <Title t="Nerida AI" sub="A private AI that runs on this PC. It chats about your notes and makes flashcards and quizzes." />
      <Showcase />
      {!isTauri() ? (
        <p className="text-[13px] text-neutral-500">Nerida runs in the Oceanic desktop app.</p>
      ) : installed ? (
        <p className="text-[13px] text-emerald-400">Nerida is ready.</p>
      ) : dl ? (
        <div>
          <p className="mb-1.5 text-[12.5px] text-neutral-400">Downloading {dl.label}… {pct}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full bg-[color:var(--color-sky-500)] transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">You can continue. The download keeps going in the background.</p>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <button type="button" disabled={!status} onClick={() => void start()} className="h-8 cursor-pointer rounded-md bg-gradient-to-r from-[#38d6ff] to-[#7c3aed] px-4 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40">
            Download Nerida
          </button>
          <p className="text-[12px] text-neutral-500">Large download. Best with 8 GB+ RAM. Or skip and get it later in Settings → Nerida AI.</p>
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </>
  );
}

const SCENES = [
  { ask: "Summarise my Biology note", answer: "Photosynthesis turns light, water and CO₂ into glucose and oxygen. It happens in the chloroplasts, powered by chlorophyll." },
  { ask: "Make this sentence clearer", before: "Plants use sun stuff to make their food.", after: "Plants turn sunlight into glucose for energy." },
];

/** Looping mini Nerida panel: a question is typed and sent, Nerida thinks, then answers (scene 1) or proposes an edit (scene 2). 150 ms ticks, 40 per scene. */
function Showcase() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((n) => (n + 1) % 80), 150);
    return () => clearInterval(id);
  }, []);
  const s = t < 40 ? 0 : 1;
  const k = t % 40; // tick within scene: 0-10 typing, 11-15 thinking, 16+ reply
  const sc = SCENES[s];
  const typed = sc.ask.slice(0, Math.round((sc.ask.length * k) / 10));
  const words = sc.answer?.split(" ") ?? [];
  return (
    <div className="mb-4 flex h-[196px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-neutral-300">
        <NeridaMark size={14} busy={k > 10 && k < 16} /> Nerida
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-3 py-2 text-[12px]">
          {k > 10 && <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="self-end rounded-lg bg-sky-500/15 px-2.5 py-1 text-neutral-100">{sc.ask}</motion.p>}
          {k > 10 && k < 16 && <p className="flex gap-1 px-1 py-1.5">{[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-neutral-500" style={{ animationDelay: `${d * 120}ms` }} />)}</p>}
          {k >= 16 && (sc.answer
            ? <p className="leading-relaxed text-neutral-300">{words.slice(0, (k - 15) * 2).join(" ")}</p>
            : <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none" style={{ zoom: 0.85 }}><DiffCard before={sc.before!} after={sc.after!} onAccept={() => {}} onReject={() => {}} /></motion.div>)}
        </motion.div>
      </AnimatePresence>
      <div className="flex items-center gap-2 border-t border-white/[0.05] px-3 py-1.5">
        <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] text-neutral-400">📄 Biology</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-200">
          {k <= 10 ? typed : <span className="text-neutral-500">Ask Nerida…</span>}
          {k <= 10 && <span className="ml-px inline-block h-3 w-px animate-pulse bg-neutral-300 align-middle" />}
        </span>
      </div>
    </div>
  );
}
