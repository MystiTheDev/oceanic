/** Settings → Sync on desktop pairing code card, paired devices with Sync now, and the sync log. */
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, MoreHorizontal, Smartphone, Trash2, Wifi } from "lucide-react";
import { sync, syncAgo, syncSummary, type SyncInfo } from "../lib/sync";
import { SyncNetworks, SyncOption } from "./SyncBackground";

const PAIR_SECONDS = 120;
type DevState = { tone: "idle" | "busy" | "ok" | "err"; text: string };
const DOT = { idle: "bg-neutral-500", busy: "bg-amber-400 animate-pulse", ok: "bg-emerald-400", err: "bg-red-400" };

const Btn = ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="h-8 cursor-pointer rounded-md border border-white/[0.1] px-3 text-[13px] text-neutral-200 transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40">
    {children}
  </button>
);
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mb-3 mt-8 border-b border-white/[0.06] pb-2 text-[14px] font-semibold text-neutral-200">{children}</h3>;

export function SyncSettings() {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [state, setState] = useState<Record<string, DevState>>({});
  const [paired, setPaired] = useState("");
  const [closed, setClosed] = useState("");
  const [menu, setMenu] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [tray, setTray] = useState(false);
  const refresh = () => void sync.info().then(setInfo).catch(() => {});
  useEffect(() => {
    refresh();
    void sync.autostart().then(setTray).catch(() => {});
    const t = setInterval(refresh, 1000);
    const un = [
      listen<string>("sync-paired", (e) => (setPaired(e.payload), setTimeout(() => setPaired(""), 4000))),
      listen<string>("sync-pair-closed", (e) => setClosed(e.payload)),
    ];
    return () => (clearInterval(t), un.forEach((u) => void u.then((f) => f())));
  }, []);
  if (!info) return null;
  const p = info.pairing;

  const run = async (id: string, busy: string, job: () => Promise<string>) => {
    setState((s) => ({ ...s, [id]: { tone: "busy", text: busy } }));
    try {
      const text = await job();
      setState((s) => ({ ...s, [id]: { tone: "ok", text } }));
    } catch (e) {
      setState((s) => ({ ...s, [id]: { tone: "err", text: (e as Error).message } }));
    }
    refresh();
  };
  const test = (id: string) => run(id, "Testing…", () => sync.test(id));
  const syncNow = (id: string) => run(id, "Syncing…", async () => `Synced: ${syncSummary(await sync.now(id))}`);
  const last = info.log[0];
  /** Status dot when nothing is running: error, pending or synced. */
  const rest: DevState = last?.error
    ? { tone: "err", text: last.error }
    : info.pending
      ? { tone: "busy", text: `${info.pending} change${info.pending === 1 ? "" : "s"} waiting` }
      : last
        ? { tone: "ok", text: `Synced ${syncAgo(last.at)}` }
        : { tone: "idle", text: "Not synced yet" };

  return (
    <>
      <p className="mt-4 text-[13px] leading-relaxed text-neutral-400">
        Sync notes with your phone over Wi-Fi, a hotspot or USB tethering. No account or internet needed. Tap Sync now to swap changes. Page text merging arrives in a later update: for now, if both devices edit the same page, the newest edit wins.
      </p>
      {info.listenError && <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{info.listenError}</p>}

      <H3>Pair a phone</H3>
      {paired ? (
        <div className="oc-pop-in flex items-center gap-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] p-5">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
            <Check className="size-5" />
          </span>
          <div>
            <p className="text-[14.5px] font-medium text-neutral-100">Paired with {paired}</p>
            <p className="text-[12.5px] text-neutral-400">It now appears under Paired devices.</p>
          </div>
        </div>
      ) : p ? (
        <div className="oc-pop-in flex items-center gap-7 rounded-xl border border-white/[0.08] bg-white/[0.03] p-6">
          <div className="relative grid size-[76px] shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
              <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" className="stroke-white/[0.08]" />
              <circle
                cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" strokeLinecap="round"
                stroke="var(--color-sky-500)"
                strokeDasharray={`${(p.secondsLeft / PAIR_SECONDS) * 100.5} 100.5`}
                style={{ transition: "stroke-dasharray 1s linear" }}
              />
            </svg>
            <span className="text-[13px] tabular-nums text-neutral-300">
              {Math.floor(p.secondsLeft / 60)}:{String(p.secondsLeft % 60).padStart(2, "0")}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              {p.code.split("").map((d, i) => (
                <span key={i} className={`grid h-14 w-11 place-items-center rounded-lg border border-white/[0.1] bg-[var(--oc-surface)] font-mono text-[28px] font-semibold text-neutral-100 ${i === 2 ? "mr-3" : ""}`}>
                  {d}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-neutral-400">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
              <span>Waiting for your phone… On it, open Settings → Sync → Pair with a laptop and pick <b className="text-neutral-200">{info.name}</b>.</span>
            </p>
            <p className="mt-1 text-[12px] text-neutral-500">
              Not listed on the phone? Tap “Enter address” and type <span className="font-mono text-neutral-300">{info.ip ?? "?"}</span>
            </p>
          </div>
          <Btn onClick={() => void sync.pairCancel().then(refresh)}>Cancel</Btn>
        </div>
      ) : (
        <div className="flex items-center gap-5 rounded-xl border border-dashed border-white/[0.1] p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
            <Smartphone className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-neutral-100">Connect your phone</p>
            <p className="text-[12.5px] text-neutral-500">Shows a 6-digit code for 2 minutes. Both devices must be on the same network.</p>
            {closed && <p className="mt-1 text-[12.5px] text-amber-300">{closed}</p>}
          </div>
          <button
            type="button"
            onClick={() => (setClosed(""), void sync.pairStart().then(refresh))}
            className="h-9 cursor-pointer rounded-md bg-[color:var(--color-sky-600)] px-4 text-[13px] font-medium text-white hover:brightness-110"
          >
            Pair a phone
          </button>
        </div>
      )}

      <H3>Paired devices</H3>
      {!info.peers.length && <p className="py-2 text-[13px] text-neutral-500">No devices yet.</p>}
      <div className="flex flex-col gap-2">
        {info.peers.map((d) => {
          const st = state[d.id] ?? rest;
          const sub = st.text;
          return (
            <div key={d.id} className="relative flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-neutral-300">
                <Smartphone className="size-5" />
                <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--oc-surface)] ${DOT[st.tone]}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-neutral-100">{d.name}</p>
                <p className={`text-[12.5px] ${st.tone === "err" ? "text-red-300" : st.tone === "ok" ? "text-emerald-300" : "text-neutral-500"}`}>{sub}</p>
              </div>
              {confirmId === d.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] text-neutral-400">Unpair {d.name}?</span>
                  <Btn onClick={() => setConfirmId("")}>Keep</Btn>
                  <button
                    type="button"
                    onClick={() => (setConfirmId(""), void sync.unpair(d.id).then(refresh))}
                    className="h-8 cursor-pointer rounded-md bg-red-500/15 px-3 text-[13px] text-red-300 hover:bg-red-500/25"
                  >
                    Unpair
                  </button>
                </span>
              ) : (
                <>
                  <Btn disabled={st.text.endsWith("…")} onClick={() => void syncNow(d.id)}>Sync now</Btn>
                  <button type="button" aria-label="More" onClick={() => setMenu(menu === d.id ? "" : d.id)} className="grid size-8 cursor-pointer place-items-center rounded-md text-neutral-400 hover:bg-white/[0.06]">
                    <MoreHorizontal className="size-4" />
                  </button>
                </>
              )}
              {menu === d.id && (
                <>
                  <div className="fixed inset-0 z-10" onMouseDown={() => setMenu("")} />
                  <div className="oc-pop-in absolute right-3 top-12 z-20 min-w-[160px] rounded-lg border border-white/[0.08] bg-[var(--oc-raised)] p-1 shadow-2xl shadow-black/50">
                    <button type="button" onClick={() => (setMenu(""), void test(d.id))} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-neutral-200 hover:bg-white/[0.06]">
                      <Wifi className="size-4" /> Test connection
                    </button>
                    <button type="button" onClick={() => (setMenu(""), setConfirmId(d.id))} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-red-300 hover:bg-white/[0.06]">
                      <Trash2 className="size-4" /> Unpair…
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <H3>Background</H3>
      <SyncOption label="Start in tray with Windows" hint="Oceanic keeps listening for your phone after sign-in." on={tray} onChange={(on) => (setTray(on), void sync.setAutostart(on).catch(() => setTray(!on)))} />
      <SyncOption label="Sync automatically" hint="On wake from sleep and when joining a trusted network." on={info.auto} onChange={(on) => void sync.setOption("syncAuto", on).then(refresh)} />

      <H3>Sync networks</H3>
      <SyncNetworks />

      {info.log.length > 0 && (
        <>
          <H3>Sync log</H3>
          <div className="flex flex-col text-[12.5px]">
            {info.log.map((l, i) => (
              <div key={i} className="flex gap-3 border-b border-white/[0.04] py-1.5">
                <span className="w-36 shrink-0 text-neutral-500">{syncAgo(l.at)}</span>
                <span className="w-32 shrink-0 truncate text-neutral-400">{l.peer}</span>
                <span className={l.error ? "text-red-300" : "text-neutral-300"}>{l.error ?? syncSummary(l)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
