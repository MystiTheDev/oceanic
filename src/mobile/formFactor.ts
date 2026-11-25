import { useSyncExternalStore } from "react";

// Dev only: `localStorage.ocFormFactor = "android"` makes a browser act as the Android app.
const fake = import.meta.env.DEV && localStorage.getItem("ocFormFactor") === "android";
/** True inside the Android app (phone or tablet). */
export const isAndroid = fake || /Android/i.test(navigator.userAgent);
/** Android tablet: shortest screen side is at least 600dp. */
export const isTablet = isAndroid && Math.min(fake ? innerWidth : screen.width, fake ? innerHeight : screen.height) >= 600;

const landscape = matchMedia("(orientation: landscape)");
const sub = (cb: () => void) => (landscape.addEventListener("change", cb), () => landscape.removeEventListener("change", cb));
const subResize = (cb: () => void) => (addEventListener("resize", cb), () => removeEventListener("resize", cb));
/** Phone shell (MobileShell): every Android device. Tablets get its tablet layout, see useTabletUI. */
export const phoneUINow = () => isAndroid;
export const usePhoneUI = () => isAndroid;
export const useLandscape = () => useSyncExternalStore(sub, () => landscape.matches);
/** Tablet layout: side rail; "split" (window >= 840px) also shows list + editor side by side. Narrow split-screen windows fall back to the phone layout. */
const tabletNow = () => (!isTablet || innerWidth < 600 ? null : innerWidth >= 840 ? "split" : "rail");
export const useTabletUI = () => useSyncExternalStore(subResize, tabletNow);

if (isTablet) {
  const html = document.documentElement;
  html.classList.add("tablet");
  // Rotation: crossfade the app into the new layout.
  landscape.addEventListener("change", () => {
    html.classList.remove("oc-rotate");
    void html.offsetWidth;
    html.classList.add("oc-rotate");
  });
}

const vv = window.visualViewport;
const subKb = (cb: () => void) => (vv?.addEventListener("resize", cb), () => vv?.removeEventListener("resize", cb));
/** Soft keyboard open: the visual viewport lost over a quarter of the window height. */
export const useSoftKeyboard = () => useSyncExternalStore(subKb, () => isAndroid && !!vv && vv.height < innerHeight * 0.75);
