/** Phone-only preferences (this device only), kept in localStorage. */
import { useSyncExternalStore } from "react";

export type MobilePrefs = { haptics: boolean; reduceMotion: boolean };

const KEY = "oceanic.mobilePrefs";
const listeners = new Set<() => void>();

function read(): MobilePrefs {
  try {
    return { haptics: true, reduceMotion: false, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { haptics: true, reduceMotion: false };
  }
}

let current = read();

export function setMobilePref(patch: Partial<MobilePrefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((l) => l());
}

export function useMobilePrefs() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

/** Light tap feedback, unless turned off in Settings. */
export const buzz = () => current.haptics && navigator.vibrate?.(8);
