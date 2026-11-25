import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Smile, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Modal } from "./Modal";
import { Stepper } from "./Stepper";
import { AvatarCropper } from "./AvatarCropper";
import { EmojiPicker } from "./EmojiPicker";
import { Avatar, AvatarChoice, SidebarIconsPicker, type AppSettings } from "./SettingsModal";
import { NeridaMark } from "./NeridaOrb";
import { DiffCard } from "./NeridaDiff";
import logoRaw from "../assets/logo-raw.png";
import { downloadModel, engine, useNerida, type AiStatus } from "../lib/nerida";

/** Fired by Settings → About to open the wizard again. */
export const SETUP_START = "oc-setup-start";
export const startSetup = () => window.dispatchEvent(new Event(SETUP_START));

const input =
  "h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-[14px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-sky-500/60 focus:bg-white/[0.06]";
const THEMES: [AppSettings["theme"], string, string][] = [
  ["system", "System", "linear-gradient(135deg, #f5f5f5 50%, #171717 50%)"],
  ["light", "Light", "#f5f5f5"],
  ["dark", "Dark", "#171717"],
];
const INFO = [
  { label: "You", hint: "Your name and picture" },
  { label: "Workspace", hint: "Where your notes live" },
  { label: "Look", hint: "Theme and icons" },
  { label: "Nerida AI", hint: "Your private assistant" },
];
const Title = ({ t, sub }: { t: string; sub: string }) => (
  <div className="mb-6">
    <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-neutral-50">{t}</h2>
    <p className="mt-1 text-[13.5px] leading-relaxed text-neutral-400">{sub}</p>
  </div>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <span className="text-[13.5px] text-neutral-200">{label}</span>
    {children}
  </div>
);
const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-2 text-[12.5px] font-medium text-neutral-400">{children}</p>;

const greeting = (h = new Date().getHours()) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

/** Mini sidebar that mirrors the name, picture and workspace as they are typed. */
function LivePreview({ name, avatar, ws }: { name: string; avatar: string; ws: { name: string; icon: string } }) {
  return (
    <div className="mt-6">
      <Label>Preview</Label>
      <div className="flex h-[92px] overflow-hidden rounded-xl border border-white/[0.07] bg-[var(--oc-surface)]">
        <div className="flex w-[170px] flex-col border-r border-white/[0.06] p-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1.5 text-[12px] text-neutral-200">
            <span className="text-[14px] leading-none">{ws.icon || "🌊"}</span>
            <span className="truncate">{ws.name.trim() || "Workspace"}</span>
          </div>
          <div className="mt-auto flex items-center gap-2 px-2 text-[12px] text-neutral-300">
            <Avatar name={name || "?"} avatar={avatar} size={18} />
            <span className="truncate">{name.trim() || "You"}</span>
          </div>
        </div>
        <div className="flex-1 p-3">
          <p className="text-[12px] font-semibold text-neutral-200">{greeting()}{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}</p>
          <span className="mt-2 block h-1.5 w-3/4 rounded-full bg-white/[0.07]" />
          <span className="mt-1.5 block h-1.5 w-1/2 rounded-full bg-white/[0.05]" />
        </div>
      </div>
    </div>
  );
}

/**
 * First launch: name + photo, workspace name + emoji, look, Nerida AI.
 * Choices save as they are made (so Look previews live); Finish starts the tour.
 * Skip asks first and shows where to run setup again.
 */
export function SetupWizard({
  settings,
  onChange,
  workspace,
  onWorkspace,
  onDone,
  onSkip,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  workspace?: { name: string; icon: string };
  onWorkspace: (name: string, icon: string) => void;
  onDone: () => void;
  /** Close without the tour, keeping defaults. */
  onSkip: () => void;
}) {
  const [name, setName] = useState(settings.userName);
  const [ws, setWs] = useState(workspace ?? { name: "", icon: "" });
  const [picker, setPicker] = useState<{ el: HTMLElement; for: "avatar" | "ws" } | null>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [skipAsk, setSkipAsk] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const kind = settings.avatar.startsWith("data:") ? "photo" : settings.avatar ? "emoji" : "initial";

  // The active workspace may load after the wizard opens.
  useEffect(() => {
    if (workspace) setWs((w) => (w.name ? w : workspace));
  }, [workspace]);

  const steps = [
    <>
      <div className="mb-6 flex items-center gap-4">
        <span className="relative grid size-14 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-2xl bg-sky-400/25 blur-xl" />
          <img src={logoRaw} alt="" className="oc-brand-logo relative size-14 rounded-2xl object-contain" />
        </span>
        <div>
          <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-neutral-50">Welcome to Oceanic</h2>
          <p className="mt-0.5 text-[13.5px] text-neutral-400">A calm home for your notes, plans and ideas.</p>
        </div>
      </div>
      <Label>What should we call you?</Label>
      <div className="flex items-center gap-3">
        <Avatar name={name} avatar={settings.avatar} size={40} />
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={input} />
      </div>
      <div className="mt-3 flex gap-1.5 pl-[52px]">
        <AvatarChoice on={kind === "initial"} onClick={() => onChange({ avatar: "" })}><span className="text-[12px] font-semibold">Aa</span> Initial</AvatarChoice>
        <AvatarChoice on={kind === "emoji"} onClick={(e) => setPicker({ el: e.currentTarget, for: "avatar" })}><Smile className="size-3.5" /> Emoji</AvatarChoice>
        <AvatarChoice on={kind === "photo"} onClick={() => file.current?.click()}><Upload className="size-3.5" /> Photo</AvatarChoice>
      </div>
      <LivePreview name={name} avatar={settings.avatar} ws={ws} />
    </>,
    <>
      <Title t="Your workspace" sub="Give it a name and an icon. You can add more workspaces later." />
      <Label>Name and icon</Label>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Pick an icon" onClick={(e) => setPicker({ el: e.currentTarget, for: "ws" })} className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[20px] hover:bg-white/[0.08] active:scale-[0.96]">
          {ws.icon || <Smile className="size-5 text-neutral-500" />}
        </button>
        <input value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} placeholder="Workspace name" className={input} />
      </div>
      <LivePreview name={name} avatar={settings.avatar} ws={ws} />
    </>,
    <>
      <Title t="Make it yours" sub="Pick how Oceanic looks. Change it any time in Settings." />
      <Label>Theme</Label>
      <div role="radiogroup" aria-label="Theme" className="mb-4 grid grid-cols-3 gap-3">
        {THEMES.map(([id, label, bg]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={settings.theme === id}
            onClick={() => onChange({ theme: id })}
            className={`cursor-pointer rounded-xl p-1.5 text-[12.5px] font-medium transition active:scale-[0.97] ${settings.theme === id ? "bg-sky-500/15 text-neutral-50 ring-2 ring-sky-500" : "bg-white/[0.04] text-neutral-300 ring-1 ring-white/[0.08] hover:bg-white/[0.07]"}`}
          >
            <span className="mb-1.5 block h-16 overflow-hidden rounded-lg ring-1 ring-black/20" style={{ background: bg }}>
              <span className="ml-2 mt-2.5 block h-1.5 w-8 rounded-full bg-neutral-500/70" />
              <span className="ml-2 mt-1.5 block h-1.5 w-12 rounded-full bg-neutral-500/40" />
            </span>
            {label}
          </button>
        ))}
      </div>
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
    <Modal className="w-[780px] rounded-[24px]" label="Set up Oceanic" glass>
      <Stepper
        steps={steps}
        info={INFO}
        height={460}
        canNext={(i) => (i === 0 ? !!name.trim() : i === 1 ? !!ws.name.trim() : true)}
        onStep={commit}
        onFinish={onDone}
        onSkip={() => setSkipAsk(true)}
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
      {skipAsk && (
        <Modal className="w-[420px] rounded-[22px] p-6" label="Skip setup?" glass onClose={() => setSkipAsk(false)}>
          <h2 className="text-[17px] font-semibold text-neutral-50">Skip setup?</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-neutral-400">
            Oceanic keeps its default settings. You can run setup again any time from <span className="text-neutral-200">Help &amp; About → Run setup again</span>.
          </p>
          <SkipGuide />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" autoFocus onClick={() => setSkipAsk(false)} className="h-9 cursor-pointer rounded-full bg-white/[0.06] px-5 text-[13px] font-medium text-neutral-200 hover:bg-white/[0.1] active:scale-[0.97]">
              Keep setting up
            </button>
            <button type="button" onClick={() => (name.trim() && name.trim() !== settings.userName && onChange({ userName: name.trim() }), onSkip())} className="h-9 cursor-pointer rounded-full bg-[color:var(--color-sky-500)] px-5 text-[13px] font-semibold text-white hover:brightness-110 active:scale-[0.97]">
              Skip setup
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/**
 * Looping mini-app animation: the cursor goes to the profile button at the
 * bottom of the sidebar, opens the menu, picks Help & About, then clicks
 * Run setup again. 100 ms ticks, 60 per loop.
 */
function SkipGuide() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((n) => (n + 1) % 60), 100);
    return () => clearInterval(id);
  }, []);
  // Phases: 0-11 move to profile, 12-21 menu open + move to Help, 22-31 About opens, 32-45 move to button + click, 46-59 hold.
  const menu = t >= 12 && t < 24;
  const about = t >= 24;
  const pressed = t >= 40 && t < 44;
  const cursor = t < 12 ? { x: 20 + t * 1.6, y: 40 + t * 7.5 } : t < 22 ? { x: 40, y: 128 - (t - 12) * 2.4 } : t < 32 ? { x: 40, y: 104 } : t < 40 ? { x: 40 + (t - 32) * 21, y: 104 - (t - 32) * 8 } : { x: 208, y: 40 };
  return (
    <div aria-hidden className="relative mt-4 h-[150px] overflow-hidden rounded-xl border border-white/[0.07] bg-[var(--oc-surface)] text-[10.5px]">
      {/* Sidebar */}
      <div className="absolute inset-y-0 left-0 flex w-[92px] flex-col border-r border-white/[0.06] bg-white/[0.02] p-2">
        <span className="mb-1.5 block h-1.5 w-12 rounded-full bg-white/[0.1]" />
        <span className="mb-1 block h-1.5 w-14 rounded-full bg-white/[0.06]" />
        <span className="block h-1.5 w-10 rounded-full bg-white/[0.06]" />
        <div className={`mt-auto flex items-center gap-1.5 rounded-md px-1 py-1 transition-colors ${t >= 10 && t < 24 ? "bg-white/[0.08]" : ""}`}>
          <span className="size-3.5 rounded-full bg-sky-500/70" />
          <span className="text-neutral-300">You</span>
        </div>
      </div>
      {/* Profile menu */}
      <div className={`absolute bottom-8 left-2 w-[112px] rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl transition-all duration-200 ${menu ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"}`}>
        {["Settings", "Shortcuts", "Help & About"].map((l) => (
          <p key={l} className={`rounded px-1.5 py-0.5 ${l === "Help & About" && t >= 18 ? "bg-sky-500/20 text-sky-200" : "text-neutral-400"}`}>{l}</p>
        ))}
      </div>
      {/* About page */}
      <div className={`absolute inset-y-0 left-[92px] right-0 p-3 transition-opacity duration-200 ${about ? "opacity-100" : "opacity-0"}`}>
        <p className="mb-2 text-[11.5px] font-semibold text-neutral-200">About</p>
        <div className="flex gap-1.5">
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-neutral-400">Replay tour</span>
          <span className={`rounded-md px-2 py-1 transition-all ${t >= 34 ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/60" : "bg-white/[0.06] text-neutral-400"} ${pressed ? "scale-95" : ""}`}>Run setup again</span>
        </div>
      </div>
      {/* Cursor */}
      <svg className="absolute size-4 drop-shadow transition-[left,top] duration-100 ease-linear" style={{ left: cursor.x, top: cursor.y }} viewBox="0 0 16 16">
        <path d="M2 1l11 7-5 1-2 5z" fill="white" stroke="black" strokeWidth="1" />
      </svg>
    </div>
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
