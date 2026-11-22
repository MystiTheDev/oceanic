import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Smile, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Modal } from "./Modal";
import { Stepper } from "./Stepper";
import { AvatarCropper } from "./AvatarCropper";
import { EmojiPicker } from "./EmojiPicker";
import { Avatar, AvatarChoice, Select, SidebarIconsPicker, type AppSettings } from "./SettingsModal";
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

const ANSWER = "Photosynthesis turns light, water and CO₂ into glucose and oxygen, inside the chloroplasts.".split(" ");

/** Looping demo: a chat answer streams in, then Nerida rewrites a sentence. */
function Showcase() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((n) => (n + 1) % 32), 250);
    return () => clearInterval(id);
  }, []);
  const chat = t < 18;
  const box = "rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed";
  return (
    <div className="mb-4 h-[112px] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <AnimatePresence mode="wait">
        <motion.div key={chat ? "chat" : "edit"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex flex-col gap-2">
          {chat ? (
            <>
              <p className={`${box} self-end bg-sky-500/20 text-neutral-100`}>Summarise my Biology note</p>
              <p className={`${box} self-start bg-white/[0.05] text-neutral-300`}>{ANSWER.slice(0, Math.max(1, t - 3)).join(" ")}</p>
            </>
          ) : (
            <>
              <p className={`${box} self-end bg-sky-500/20 text-neutral-100`}>Make this clearer</p>
              <p className={`${box} bg-white/[0.05] text-neutral-300`}>
                Plants <span className={t > 22 ? "text-red-400/80 line-through" : ""}>use sun stuff to make food</span>
                {t > 24 && <span className="text-emerald-400"> turn sunlight into glucose</span>}.
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
