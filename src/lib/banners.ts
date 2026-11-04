import { useSyncExternalStore } from "react";
import { api } from "../data/api";

/**
 * Page banners (Notion-style covers). Stored as one JSON map in settings
 * ("pageBanners"), so no database change is needed.
 * `src` is an image URL, or a CSS gradient/color when it starts with "css:".
 * `y` is the vertical crop position, 0–100 (%).
 */
export type Banner = { src: string; y: number };

const gallery = import.meta.glob("../assets/banners/*.jpg", { eager: true, import: "default" }) as Record<string, string>;
export const GALLERY: string[] = Object.keys(gallery)
  .sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")))
  .map((k) => gallery[k]);

export const GRADIENTS: string[] = [
  "linear-gradient(135deg,#0f2027,#2c5364)",
  "linear-gradient(135deg,#1e3c72,#2a5298)",
  "linear-gradient(135deg,#134e5e,#71b280)",
  "linear-gradient(135deg,#42275a,#734b6d)",
  "linear-gradient(135deg,#ff7e5f,#feb47b)",
  "linear-gradient(135deg,#00c6ff,#0072ff)",
  "linear-gradient(135deg,#f7971e,#ffd200)",
  "linear-gradient(135deg,#ee0979,#ff6a00)",
  "#2383e2",
  "#10b981",
  "#ef4444",
  "#374151",
];

let map: Record<string, Banner> = {};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

api
  .getSettings()
  .then((s) => {
    try {
      map = JSON.parse(s.pageBanners ?? "{}");
      emit();
    } catch {
      /* bad JSON: start empty */
    }
  })
  .catch(() => {});

export function setBanner(pageId: string, banner: Banner | null) {
  const next = { ...map };
  if (banner) next[pageId] = banner;
  else delete next[pageId];
  map = next;
  emit();
  api.setSetting("pageBanners", JSON.stringify(map)).catch(() => {});
}

export const getBanner = (pageId: string): Banner | null => map[pageId] ?? null;

export function useBanner(pageId: string): Banner | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => map[pageId] ?? null,
  );
}

/** CSS `background` for a banner. */
export const bannerBg = (b: Banner) => (b.src.startsWith("css:") ? b.src.slice(4) : `center ${b.y}% / cover no-repeat url("${b.src}")`);
