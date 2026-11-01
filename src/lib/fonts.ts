/* ---------------------------------------------------------------------------
 * Bundled font families (offline), used by the page font and the selection
 * toolbar's Font dropdown.
 * ------------------------------------------------------------------------ */
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";

export const FONTS = {
  default: { label: "Default", sample: "Ag", stack: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  serif: { label: "Serif", sample: "Ag", stack: '"Lora", Georgia, serif' },
  mono: { label: "Mono", sample: "Ag", stack: '"JetBrains Mono", ui-monospace, Consolas, monospace' },
  dyslexic: { label: "Dyslexic", sample: "Ag", stack: '"OpenDyslexic", sans-serif' },
  hand: { label: "Handwriting", sample: "Ag", stack: '"Caveat", cursive' },
} as const;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];
export const fontStack = (id: string | undefined) => FONTS[(id as FontId) in FONTS ? (id as FontId) : "default"].stack;
