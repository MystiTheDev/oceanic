/** Per-device interface zoom and density (not synced: a phone may want a bigger zoom than the PC). */
export const ZOOMS: [string, string][] = [["90", "90%"], ["100", "100%"], ["110", "110%"], ["125", "125%"]];
export const DENSITIES: [string, string][] = [["compact", "Compact"], ["default", "Default"], ["relaxed", "Relaxed"]];
const ZOOM_KEY = "oc-zoom";
const DENSITY_KEY = "oc-density";

const read = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};

export const getZoom = () => read(ZOOM_KEY, "100");
export const getDensity = () => read(DENSITY_KEY, "default");

/** Applies both to <html>: `zoom` scales the whole UI, `data-density` switches the spacing variables. */
export function applyUiScale() {
  const html = document.documentElement;
  html.style.setProperty("zoom", getZoom() === "100" ? "" : `${Number(getZoom()) / 100}`);
  html.dataset.density = getDensity();
}

export function setUiScale(kind: "zoom" | "density", v: string) {
  try {
    localStorage.setItem(kind === "zoom" ? ZOOM_KEY : DENSITY_KEY, v);
  } catch {
    /* storage blocked */
  }
  applyUiScale();
}
