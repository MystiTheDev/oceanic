// Phone self-updater: checks GitHub for a newer `vX.Y.Z` release with an
// APK, shows a bottom sheet, and hands the download to UpdaterPlugin.kt.
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { buzz } from "./mobilePrefs";

const API = "https://api.github.com/repos/MystiTheDev/oceanic/releases?per_page=30";
const SKIPPED = "oc-update-skipped";
const RETRY = [10_000, 30_000, 60_000, 120_000]; // failed startup check: try again after these delays

type Release = { version: string; notes: string; apk: string };
type CheckResult = "found" | "none" | "error";

export const parse = (v: string) => v.replace(/^\D*/, "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
export const newer = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// Markdown to readable plain text.
const plain = (md: string) =>
  md
    .replace(/\r/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/(\*\*|__|`)/g, "")
    .trim();

// Only the "## ... Android" section of the release notes, up to the next "## ".
const androidNotes = (md: string) => md.replace(/\r/g, "").match(/^##[^\n]*Android[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? "";

async function latest(): Promise<Release | null> {
  const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const list: { tag_name: string; body: string | null; draft: boolean; prerelease: boolean; assets: { name: string; browser_download_url: string }[] }[] = await res.json();
  let best: (typeof list)[number] | null = null;
  for (const r of list) {
    if (r.draft || r.prerelease || !/^v\d/.test(r.tag_name)) continue;
    if (!best || newer(r.tag_name, best.tag_name)) best = r;
  }
  // The APK is uploaded late; until it is there, there is no update.
  const apk = best?.assets.find((a) => a.name.endsWith(".apk"));
  if (!best || !apk) return null;
  return { version: best.tag_name.slice(1), notes: plain(androidNotes(best.body ?? "")), apk: apk.browser_download_url };
}

// Settings' "Check for updates" asks the mounted prompt through this.
let manualCheck: (() => Promise<CheckResult>) | null = null;
export const checkForUpdates = () => (manualCheck ? manualCheck() : Promise.resolve<CheckResult>("error"));

export function MobileUpdater() {
  const [release, setRelease] = useState<Release | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // null = not downloading
  const [error, setError] = useState("");

  useEffect(() => {
    const check = async (manual: boolean): Promise<CheckResult> => {
      try {
        const [r, current] = await Promise.all([latest(), getVersion()]);
        if (!r || !newer(r.version, current)) return "none";
        if (!manual && store.get(SKIPPED) === r.version) return "none";
        setError("");
        setRelease(r);
        return "found";
      } catch {
        return "error";
      }
    };
    manualCheck = () => check(true);
    let timer = 0;
    const auto = async (n: number) => {
      if ((await check(false)) === "error" && n < RETRY.length) timer = window.setTimeout(() => void auto(n + 1), RETRY[n]);
    };
    void auto(0);
    return () => { manualCheck = null; window.clearTimeout(timer); };
  }, []);

  if (!release) return null;
  const close = () => { if (progress === null) setRelease(null); };
  const update = async () => {
    buzz();
    setError("");
    setProgress(0);
    const onProgress = new Channel<{ percent: number }>();
    onProgress.onmessage = (m) => setProgress(m.percent);
    try {
      await invoke("apk_install", { url: release.apk, onProgress });
      setRelease(null);
    } catch (e) {
      setError(String(e).includes("needs-permission")
        ? "Allow Oceanic to install apps, then come back and tap Update again."
        : "The download failed. Check your connection and try again.");
    }
    setProgress(null);
  };

  return (
    <div className="ocme-sheet-bg ocu-bg" onClick={close}>
      <div className="ocme-sheet ocu-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ocme-grab" />
        <h2>Oceanic {release.version} is available</h2>
        {release.notes && <p className="ocu-notes">{release.notes}</p>}
        {error && <p className="ocu-error">{error}</p>}
        {progress !== null ? (
          <div className="ocu-progress" aria-label="Downloading">
            <span style={{ width: `${progress < 0 ? 100 : progress}%` }} className={progress < 0 ? "ocu-indef" : ""} />
            <em>{progress < 0 ? "Downloading…" : `Downloading… ${progress}%`}</em>
          </div>
        ) : (
          <div className="ocu-actions">
            <button className="ocu-primary" onClick={update}>Update</button>
            <button onClick={() => (buzz(), close())}>Later</button>
            <button onClick={() => (buzz(), store.set(SKIPPED, release.version), close())}>Skip this version</button>
          </div>
        )}
      </div>
    </div>
  );
}
