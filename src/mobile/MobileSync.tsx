/** Settings → Sync on the phone (phase 7a): paired laptops and the two-step pairing flow. */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Laptop, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { sync, type FoundLaptop, type SyncInfo } from "../lib/sync";
import { buzz } from "./mobilePrefs";

type Tone = "idle" | "busy" | "ok" | "err";

export function SyncScreen({ onPair }: { onPair: () => void }) {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [state, setState] = useState<Record<string, { tone: Tone; text: string }>>({});
  const [arming, setArming] = useState("");
  const refresh = () => void sync.info().then(setInfo).catch(() => {});
  useEffect(refresh, []);
  if (!info) return null;

  const test = async (id: string) => {
    buzz();
    setState((s) => ({ ...s, [id]: { tone: "busy", text: "Testing…" } }));
    try {
      await sync.test(id);
      setState((s) => ({ ...s, [id]: { tone: "ok", text: "Connected" } }));
    } catch (e) {
      setState((s) => ({ ...s, [id]: { tone: "err", text: (e as Error).message } }));
    }
  };
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
        const st = state[d.id] ?? { tone: "idle" as Tone, text: d.addr ? `Last seen at ${d.addr}` : "Not tested" };
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
              <button onClick={() => void test(d.id)} disabled={st.tone === "busy"}>
                {st.tone === "busy" ? <Loader2 size={16} className="osy-spin" /> : <RefreshCw size={16} />} Test connection
              </button>
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
      <p className="ocs-note">Notes don't sync yet. This update pairs devices and checks the connection.</p>
    </>
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
  const join = async (c: string) => {
    if (!target) return;
    setBusy(true);
    setErr("");
    try {
      setPeer(await sync.pairJoin(target.addr, c));
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

  const addr = manual.trim();
  return (
    <>
      <p className="ocs-note">On the laptop, open Settings → Sync → Pair a phone. Both devices must be on the same Wi-Fi or hotspot.</p>
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
    </>
  );
}
