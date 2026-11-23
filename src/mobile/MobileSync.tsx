/** Settings → Sync on the phone: paired laptops with Sync now, the sync log, and the two-step pairing flow. */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Laptop, Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { parsePairQr, sync, syncAgo, syncSummary, TETHER_HELP, type FoundLaptop, type SyncInfo } from "../lib/sync";
import { buzz } from "./mobilePrefs";
import { Row, Switch } from "./MobileSettings";
import { SyncNetworks } from "../components/SyncBackground";

type Tone = "idle" | "busy" | "ok" | "err";

export function SyncScreen({ onPair }: { onPair: () => void }) {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [state, setState] = useState<Record<string, { tone: Tone; text: string }>>({});
  const [arming, setArming] = useState("");
  const refresh = () => void sync.info().then(setInfo).catch(() => {});
  const [battery, setBattery] = useState(true);
  useEffect(() => {
    refresh();
    const check = () => void sync.android("batteryOk").then(setBattery).catch(() => {});
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  if (!info) return null;

  const run = async (id: string, busy: string, job: () => Promise<string>) => {
    buzz();
    setState((s) => ({ ...s, [id]: { tone: "busy", text: busy } }));
    try {
      const text = await job();
      setState((s) => ({ ...s, [id]: { tone: "ok", text } }));
    } catch (e) {
      setState((s) => ({ ...s, [id]: { tone: "err", text: (e as Error).message } }));
    }
    refresh();
  };
  const last = info.log[0];
  const rest: { tone: Tone; text: string } = last?.error
    ? { tone: "err", text: last.error }
    : info.pending
      ? { tone: "busy", text: `${info.pending} change${info.pending === 1 ? "" : "s"} waiting` }
      : last
        ? { tone: "ok", text: `Synced ${syncAgo(last.at)}` }
        : { tone: "idle", text: "Not synced yet" };
  const unpair = (id: string) => {
    buzz();
    if (arming !== id) {
      setArming(id);
      setTimeout(() => setArming((a) => (a === id ? "" : a)), 3000);
      return;
    }
    setArming("");
    void sync.unpair(id).then(refresh);
  };

  if (!info.peers.length) {
    return (
      <div className="osy-empty">
        <div className="osy-art">
          <Laptop size={34} />
          <span className="osy-wave" />
          <Smartphone size={26} />
        </div>
        <h2>Sync with your laptop</h2>
        <p>Keep notes the same on this phone and your laptop. Works over Wi-Fi, a hotspot or USB, with no account.</p>
        <button className="osy-primary" onClick={() => (buzz(), onPair())}>Pair with a laptop</button>
        {info.listenError && <p className="ocs-note">{info.listenError}</p>}
      </div>
    );
  }

  return (
    <>
      <h3 className="ocs-head">Paired devices</h3>
      {info.peers.map((d) => {
        const st = state[d.id] ?? rest;
        const busy = st.text.endsWith("…");
        return (
          <section key={d.id} className="ocs-group osy-device">
            <div className="osy-head">
              <span className="osy-icon">
                <Laptop size={20} />
                <span className={`osy-dot ${st.tone}`} />
              </span>
              <span className="ocs-title">
                {d.name}
                <em className={`osy-${st.tone}`}>{st.text}</em>
              </span>
            </div>
            <div className="osy-actions">
              <button onClick={() => void run(d.id, "Syncing…", async () => `Synced: ${syncSummary(await sync.now(d.id))}`)} disabled={busy}>
                {busy ? <Loader2 size={16} className="osy-spin" /> : <RefreshCw size={16} />} Sync now
              </button>
              <button onClick={() => void run(d.id, "Testing…", () => sync.test(d.id))} disabled={busy}>Test</button>
              <button className={`osy-danger ${arming === d.id ? "armed" : ""}`} onClick={() => unpair(d.id)}>
                {arming === d.id ? "Tap again to unpair" : "Unpair"}
              </button>
            </div>
          </section>
        );
      })}
      <section className="ocs-group">
        <button className="ocs-row" onClick={() => (buzz(), onPair())}>
          <span className="ocs-title">Pair another laptop</span>
          <ChevronRight size={18} className="ocs-chev" />
        </button>
      </section>
      {info.log.length > 0 && (
        <>
          <h3 className="ocs-head">Sync log</h3>
          <section className="ocs-group">
            {info.log.slice(0, 10).map((l, i) => (
              <div key={i} className="ocs-row">
                <span className="ocs-title">
                  {l.error ? <span className="osy-err">{l.error}</span> : syncSummary(l)}
                  <em>{l.peer} · {syncAgo(l.at)}</em>
                </span>
              </div>
            ))}
          </section>
        </>
      )}
      <h3 className="ocs-head">Background</h3>
      <section className="ocs-group">
        <Row title="Sync when joining Wi-Fi">
          <Switch on={info.auto} onChange={(on) => void sync.setOption("syncAuto", on).then(refresh)} />
        </Row>
        <Row title="Show “Syncing notes…” notification">
          <Switch on={info.notify} onChange={(on) => void sync.setOption("syncNotify", on).then(refresh)} />
        </Row>
        <Row title="Battery use: Unrestricted" value={battery ? "Done" : undefined} onClick={battery ? undefined : () => void sync.android("askBattery")} />
        <Row title="Hold large files on a hotspot">
          <Switch on={info.hold} onChange={(on) => void sync.setOption("syncHold", on).then(refresh)} />
        </Row>
        {info.hold && (
          <label className="ocs-row">
            <span className="ocs-title">Hold files over (MB)</span>
            <input
              className="ocs-input"
              inputMode="numeric"
              defaultValue={info.holdMb}
              onBlur={(e) => void sync.setHoldMb(Math.max(1, Number(e.target.value) || 10)).then(refresh)}
            />
          </label>
        )}
      </section>
      <h3 className="ocs-head">Sync networks</h3>
      <section className="ocs-group" style={{ padding: "4px 12px" }}>
        <SyncNetworks />
      </section>
      <p className="ocs-note">Page text merging arrives in a later update. For now, if both devices edit the same page, the newest edit wins.</p>
      <TetherHelp />
    </>
  );
}

/** "Can't find the laptop?" USB / Bluetooth tethering how-to. */
function TetherHelp() {
  return (
    <details className="ocs-group" style={{ padding: "10px 14px" }}>
      <summary className="ocs-title">Can't find the laptop? Use USB or Bluetooth</summary>
      {TETHER_HELP.map((g) => (
        <div key={g.title} className="ocs-note" style={{ margin: "8px 0 0", padding: 0 }}>
          <b>{g.title}</b>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {g.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      ))}
    </details>
  );
}

/** Step 1: pick a laptop found on the network (or type its address). Step 2: type its 6-digit code. */
export function PairScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [found, setFound] = useState<FoundLaptop[] | null>(null);
  const [target, setTarget] = useState<FoundLaptop | null>(null);
  const [manual, setManual] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [peer, setPeer] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const look = () => (setFound(null), void sync.discover().then(setFound).catch(() => setFound([])));
  useEffect(look, []);
  useEffect(() => {
    if (step === 2) setTimeout(() => input.current?.focus(), 250);
  }, [step]);

  const pick = (l: FoundLaptop) => (buzz(), setTarget(l), setCode(""), setErr(""), setStep(2));
  const join = async (c: string, to = target) => {
    if (!to) return;
    setBusy(true);
    setErr("");
    try {
      setPeer(await sync.pairJoin(to.addr, c));
      buzz();
      setStep(3);
      setTimeout(onDone, 1600);
    } catch (e) {
      setErr((e as Error).message);
      setCode("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (step === 3) {
    return (
      <div className="osy-empty">
        <span className="osy-done"><Check size={34} /></span>
        <h2>Paired with {peer}</h2>
        <p>You can test the connection from Settings → Sync.</p>
      </div>
    );
  }

  if (step === 2 && target) {
    return (
      <div className="osy-code">
        <span className="osy-icon big"><Laptop size={26} /></span>
        <h2>Enter the code shown on {target.name}</h2>
        <p>On the laptop: Settings → Sync → Pair a phone.</p>
        <label className="osy-boxes" onClick={() => input.current?.focus()}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={`${i === code.length ? "cur" : ""} ${i === 2 ? "gap" : ""} ${err ? "bad" : ""}`}>{code[i] ?? ""}</span>
          ))}
          <input
            ref={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            disabled={busy}
            onChange={(e) => {
              const c = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(c);
              setErr("");
              if (c.length === 6) void join(c);
            }}
          />
        </label>
        {busy && <p className="osy-status"><Loader2 size={16} className="osy-spin" /> Pairing…</p>}
        {err && <p className="osy-status osy-err">{err}</p>}
        <button className="ocs-link ocs-quiet" onClick={() => (buzz(), setStep(1))}>Choose a different laptop</button>
      </div>
    );
  }

  /** Camera scan of the laptop's QR: same address and code as typing them. */
  const scanQr = async () => {
    buzz();
    setErr("");
    try {
      const { scan, Format, requestPermissions } = await import("@tauri-apps/plugin-barcode-scanner");
      if ((await requestPermissions()) !== "granted") return setErr("Camera permission is needed to scan the code.");
      const qr = parsePairQr((await scan({ windowed: false, formats: [Format.QRCode] })).content);
      if (!qr) return setErr("That isn't an Oceanic pairing code.");
      const to = { name: qr.addr.split(":")[0], addr: qr.addr };
      setTarget(to);
      setCode(qr.code);
      setStep(2);
      void join(qr.code, to);
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    }
  };

  const addr = manual.trim();
  return (
    <>
      <p className="ocs-note">On the laptop, open Settings → Sync → Pair a phone. Both devices must be on the same Wi-Fi or hotspot.</p>
      <section className="ocs-group">
        <button className="ocs-row" onClick={() => void scanQr()}>
          <span className="ocs-icon"><QrCode size={19} /></span>
          <span className="ocs-title osy-accent">Scan the QR code<em>Shown next to the code on the laptop</em></span>
          <ChevronRight size={18} className="ocs-chev" />
        </button>
      </section>
      {err && <p className="osy-status osy-err">{err}</p>}
      <h3 className="ocs-head osy-looking">
        Laptops nearby {found === null && <Loader2 size={14} className="osy-spin" />}
      </h3>
      <section className="ocs-group">
        {found === null && <div className="ocs-row osy-scan"><span className="osy-radar" /> <span className="ocs-title">Looking for laptops…</span></div>}
        {found?.length === 0 && (
          <button className="ocs-row" onClick={() => (buzz(), look())}>
            <span className="ocs-title">None found<em>Make sure Pair a phone is open on the laptop</em></span>
            <span className="ocs-value">Search again</span>
          </button>
        )}
        {found?.map((l) => (
          <button key={l.addr} className="ocs-row" onClick={() => pick(l)}>
            <span className="ocs-icon"><Laptop size={19} /></span>
            <span className="ocs-title">{l.name}<em>{l.addr.split(":")[0]}</em></span>
            <ChevronRight size={18} className="ocs-chev" />
          </button>
        ))}
      </section>
      <h3 className="ocs-head">Or enter its address</h3>
      <section className="ocs-group">
        <label className="ocs-row">
          <span className="ocs-title">Address</span>
          <input className="ocs-input" inputMode="decimal" value={manual} placeholder="192.168.1.20" onChange={(e) => setManual(e.target.value)} />
        </label>
        {addr && (
          <button className="ocs-row" onClick={() => pick({ name: addr, addr })}>
            <span className="ocs-title osy-accent">Continue</span>
            <ChevronRight size={18} className="ocs-chev" />
          </button>
        )}
      </section>
      <p className="ocs-note">The laptop shows its address under the pairing code.</p>
      <TetherHelp />
    </>
  );
}
