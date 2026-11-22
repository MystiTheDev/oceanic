/** LAN sync 7d: the "Sync notes on …?" banner and the Sync networks list (desktop and phone). */
import { useEffect, useState } from "react";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { Trash2, Wifi } from "lucide-react";
import { sync, type SyncNetwork } from "../lib/sync";

const isAndroid = /Android/i.test(navigator.userAgent);
/** Tauri event listener; a no-op in a plain browser (web dev preview). */
const listen = (ev: string, cb: () => void) => (isTauri() ? tauriListen(ev, cb) : Promise.resolve(() => {}));
const BATTERY_ASKED = "oc-sync-battery-asked";

/** Asks once per unknown network, only when a device is paired. */
export function SyncTrustBanner() {
  const [net, setNet] = useState<SyncNetwork | null>(null);
  const check = async () => {
    const info = await sync.info().catch(() => null);
    if (!info?.peers.length) return setNet(null);
    // Phone: ask once, after pairing, to let Oceanic run in the background.
    if (isAndroid && !localStorage.getItem(BATTERY_ASKED)) {
      localStorage.setItem(BATTERY_ASKED, "1");
      if (!(await sync.android("batteryOk").catch(() => true))) void sync.android("askBattery");
    }
    const n = await sync.network().catch(() => null);
    setNet(n && !n.trust ? n : null);
  };
  useEffect(() => {
    void check();
    const un = listen("sync-network", () => void check());
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => (void un.then((f) => f()), window.removeEventListener("focus", onFocus));
  }, []);
  if (!net) return null;
  const answer = (t: "always" | "never" | "once") => (setNet(null), void sync.trust(net, t));
  const noName = isAndroid && !net.key.startsWith("ssid:");
  const btn = "h-8 cursor-pointer rounded-md px-3 text-[13px]";
  // Phone: a bottom card clear of the status bar and camera, with big equal buttons.
  if (isAndroid) {
    const tap = "h-11 flex-1 rounded-xl text-[14.5px] font-medium active:scale-[0.97] transition-transform";
    return (
      <div
        className="oc-pop-in fixed inset-x-3 z-[60] rounded-2xl border border-white/[0.08] bg-[var(--oc-raised)] p-4 shadow-2xl shadow-black/60"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-300">
            <Wifi className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15.5px] font-semibold text-neutral-100">Sync notes on this network?</p>
            <p className="truncate text-[13.5px] text-neutral-400">{net.name}</p>
            {noName && (
              <button type="button" onClick={() => void sync.android("askLocation").then(() => setTimeout(check, 4000))} className="mt-1 text-[13px] text-sky-300">
                Show Wi-Fi name
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => answer("never")} className={`${tap} bg-white/[0.05] text-neutral-400`}>Never</button>
          <button type="button" onClick={() => answer("once")} className={`${tap} bg-white/[0.08] text-neutral-200`}>Once</button>
          <button type="button" onClick={() => answer("always")} className={`${tap} bg-[color:var(--color-sky-600)] text-white`}>Always</button>
        </div>
      </div>
    );
  }
  return (
    <div className="oc-pop-in fixed left-1/2 top-3 z-[60] flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-white/[0.1] bg-[var(--oc-raised)] px-4 py-3 shadow-2xl shadow-black/50">
      <Wifi className="size-4 shrink-0 text-sky-300" />
      <p className="min-w-0 flex-1 text-[13.5px] text-neutral-100">
        Sync notes on “{net.name}”?
        {noName && (
          <button type="button" onClick={() => void sync.android("askLocation").then(() => setTimeout(check, 4000))} className="ml-2 cursor-pointer text-[12.5px] text-sky-300 underline">
            Show Wi-Fi name
          </button>
        )}
      </p>
      <button type="button" onClick={() => answer("always")} className={`${btn} bg-[color:var(--color-sky-600)] font-medium text-white`}>Always</button>
      <button type="button" onClick={() => answer("once")} className={`${btn} border border-white/[0.1] text-neutral-200`}>Just this time</button>
      <button type="button" onClick={() => answer("never")} className={`${btn} text-neutral-400`}>Never</button>
    </div>
  );
}

/** Settings → Sync networks: switch each between Always and Never, or remove it. */
export function SyncNetworks() {
  const [list, setList] = useState<SyncNetwork[]>([]);
  const refresh = () => void sync.networks().then(setList).catch(() => {});
  useEffect(() => {
    refresh();
    const un = listen("sync-network", refresh);
    return () => void un.then((f) => f());
  }, []);
  if (!list.length) return <p className="py-2 text-[13px] text-neutral-500">No networks yet. Oceanic asks the first time it sees one.</p>;
  return (
    <div className="flex flex-col gap-1">
      {list.map((n) => (
        <div key={n.key} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
          <Wifi className="size-4 shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-neutral-200">{n.name}</span>
          <button
            type="button"
            onClick={() => void sync.trust(n, n.trust === "always" ? "never" : "always").then(refresh)}
            className={`h-7 cursor-pointer rounded-md px-2.5 text-[12.5px] ${n.trust === "always" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-neutral-400"}`}
          >
            {n.trust === "always" ? "Always" : "Never"}
          </button>
          <button type="button" aria-label={`Remove ${n.name}`} onClick={() => void sync.forget(n.key).then(refresh)} className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-500 hover:bg-white/[0.06]">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A labelled on/off row used by both Sync settings screens. */
export function SyncOption({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] text-neutral-200">{label}</span>
        {hint && <span className="block text-[12px] text-neutral-500">{hint}</span>}
      </span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-sky-500" />
    </label>
  );
}
