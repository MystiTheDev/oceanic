import { useSyncExternalStore } from "react";

// Dev only: `localStorage.ocFormFactor = "android"` makes a browser act as the Android app.
const fake = import.meta.env.DEV && localStorage.getItem("ocFormFactor") === "android";
/** True inside the Android app (phone or tablet). */
export const isAndroid = fake || /Android/i.test(navigator.userAgent);
/** Android tablet: shortest screen side is at least 600dp. */
export const isTablet = isAndroid && Math.min(fake ? innerWidth : screen.width, fake ? innerHeight : screen.height) >= 600;

const landscape = matchMedia("(orientation: landscape)");
const sub = (cb: () => void) => (landscape.addEventListener("change", cb), () => landscape.removeEventListener("change", cb));
/** Phone UI: phones, and tablets held upright. Landscape tablets get the desktop UI. */
export const phoneUINow = () => isAndroid && !(isTablet && landscape.matches);
export const usePhoneUI = () => useSyncExternalStore(sub, phoneUINow);

if (isTablet) document.documentElement.classList.add("tablet");

const vv = window.visualViewport;
const subKb = (cb: () => void) => (vv?.addEventListener("resize", cb), () => vv?.removeEventListener("resize", cb));
/** Soft keyboard open: the visual viewport lost over a quarter of the window height. */
export const useSoftKeyboard = () => useSyncExternalStore(subKb, () => isAndroid && !!vv && vv.height < innerHeight * 0.75);
