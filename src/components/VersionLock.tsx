// Kill switch: when online, min-version.json on main says the oldest allowed
// version. Older apps get a full-screen lock with only a Download button.
// Offline or on any fetch error the app works as usual; nothing is cached.
// A bridge APK (VITE_BRIDGE=<target version>, see android.yml) is always locked
// and points at that version: reusable for any future forced upgrade.
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isAndroid } from "../mobile/formFactor";
import { newer } from "../mobile/MobileUpdater";
import "./VersionLock.css";

const MIN_URL = "https://raw.githubusercontent.com/MystiTheDev/oceanic/main/min-version.json";
const releasePage = (v: string) => `https://github.com/MystiTheDev/oceanic/releases/tag/v${v}`;
const apkUrl = (v: string) => `https://github.com/MystiTheDev/oceanic/releases/download/v${v}/Oceanic_${v}_android_arm64.apk`;

export function VersionLock() {
  const [min, setMin] = useState<string | null>(import.meta.env.VITE_BRIDGE || null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("");

  useEffect(() => { getVersion().then(setCurrent, () => {}); }, []);

  useEffect(() => {
    if (import.meta.env.VITE_BRIDGE) return;
    (async () => {
      try {
        const res = await fetch(MIN_URL, { cache: "no-store" });
        if (!res.ok) return;
        const want = (await res.json())?.[isAndroid ? "android" : "desktop"];
        if (typeof want === "string" && newer(want, await getVersion())) setMin(want);
      } catch { /* offline: never lock */ }
    })();
  }, []);

  if (!min) return null;
  const download = async () => {
    if (!isAndroid) return void openUrl(releasePage(min));
    setError("");
    setProgress(0);
    const onProgress = new Channel<{ percent: number }>();
    onProgress.onmessage = (m) => setProgress(m.percent);
    try {
      await invoke("apk_install", { url: apkUrl(min), onProgress });
    } catch (e) {
      setError(String(e).includes("needs-permission")
        ? "Allow Oceanic to install apps, then come back and tap Upgrade again."
        : "The download failed. Check your connection and try again.");
    }
    setProgress(null);
  };

  const busy = progress !== null;
  return (
    <div className="ocv-lock" role="alertdialog" aria-labelledby="ocv-title">
      <div className="ocv-body">
        <img className="ocv-logo" src="/logo-shell.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        <h1 id="ocv-title">Upgrade to the latest version of Oceanic</h1>
        <p className="ocv-text">This version is no longer supported. Upgrade to Oceanic {min} to keep using the app. Your notes stay safe on this device.</p>
        {current && <p className="ocv-meta">You have {current} · Latest is {min}</p>}
        <button className="ocv-btn" disabled={busy} onClick={download}>
          {busy && <span className="ocv-bar" style={{ width: `${progress! < 0 ? 100 : progress}%` }} />}
          <span>{!busy ? `Upgrade to ${min}` : progress! < 0 ? "Downloading…" : `Downloading… ${progress}%`}</span>
        </button>
        {error ? <p className="ocv-error">{error}</p> : isAndroid && <p className="ocv-hint">After downloading, tap Install when Android asks.</p>}
        <button className="ocv-link" onClick={() => void openUrl(releasePage(min))}>Open the release page</button>
      </div>
    </div>
  );
}

