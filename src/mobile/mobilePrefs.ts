/** Phone-only preferences (this device only), kept in localStorage. */
import { useSyncExternalStore } from "react";

/** Home sections in their default order; the user can hide and reorder them. */
export const HOME_SECTIONS = { create: "New page & task", week: "This week", recent: "Recent pages", shortcuts: "Shortcuts", tags: "Tags & collections", due: "Due soon" };
export type HomeSection = keyof typeof HOME_SECTIONS;
export type MobilePrefs = { haptics: boolean; reduceMotion: boolean; homeOrder: HomeSection[]; homeHidden: HomeSection[]; calMode: "month" | "week" };
const DEFAULTS: MobilePrefs = { haptics: true, reduceMotion: false, homeOrder: Object.keys(HOME_SECTIONS) as HomeSection[], homeHidden: [], calMode: "month" };

const KEY = "oceanic.mobilePrefs";
const listeners = new Set<() => void>();

function read(): MobilePrefs {
  try {
    const p: MobilePrefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    // Sections added in later versions join a saved order at their default spot.
    const order = DEFAULTS.homeOrder.filter((s) => !p.homeOrder.includes(s)).reduce((o, s) => (o.splice(DEFAULTS.homeOrder.indexOf(s), 0, s), o), [...p.homeOrder]);
    return { ...p, homeOrder: order.filter((s) => s in HOME_SECTIONS) };
  } catch {
    return DEFAULTS;
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
