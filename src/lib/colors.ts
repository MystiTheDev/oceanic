/* ---------------------------------------------------------------------------
 * Notion's named color palette (dark mode), shared by workspaces and tags.
 * ------------------------------------------------------------------------ */
export const COLORS = {
  gray: { label: "Gray", text: "#9b9b9b", bg: "rgba(255,255,255,0.09)", solid: "#6b6b6b" },
  brown: { label: "Brown", text: "#ba856f", bg: "rgba(184,101,69,0.22)", solid: "#8a5a44" },
  orange: { label: "Orange", text: "#c77d48", bg: "rgba(233,126,35,0.2)", solid: "#c4742b" },
  yellow: { label: "Yellow", text: "#ca9849", bg: "rgba(250,177,67,0.18)", solid: "#c59a2e" },
  green: { label: "Green", text: "#529e72", bg: "rgba(45,153,100,0.2)", solid: "#3c8a5f" },
  blue: { label: "Blue", text: "#5e87c9", bg: "rgba(51,126,169,0.25)", solid: "#2f6fb5" },
  purple: { label: "Purple", text: "#9d68d3", bg: "rgba(154,107,180,0.22)", solid: "#7d52b8" },
  pink: { label: "Pink", text: "#d15796", bg: "rgba(193,76,138,0.22)", solid: "#b2477f" },
  red: { label: "Red", text: "#df5452", bg: "rgba(207,81,72,0.22)", solid: "#be4440" },
} as const;

export type ColorId = keyof typeof COLORS;
export const COLOR_IDS = Object.keys(COLORS) as ColorId[];

export const colorOf = (id: string) => COLORS[(id as ColorId) in COLORS ? (id as ColorId) : "gray"];

/** Colors picked in the Tags panel; anything else falls back to a hash of the name. */
let tagOverrides: Record<string, string> = {};
export const setTagColors = (map: Record<string, string>) => {
  tagOverrides = map;
};

/** A tag keeps the same color everywhere: its picked color, else one hashed from its name. */
export function tagColor(tag: string) {
  if (tagOverrides[tag] && tagOverrides[tag] in COLORS) return COLORS[tagOverrides[tag] as ColorId];
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[COLOR_IDS[Math.abs(h) % COLOR_IDS.length]];
}

/* ---------------------------------------------------------------- Dates */
/** Local `YYYY-MM-DD` (not UTC, so late-evening dates don't slip a day). */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseIsoDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const STATUSES = {
  not_started: { label: "Not started", color: COLORS.gray },
  in_progress: { label: "In progress", color: COLORS.blue },
  done: { label: "Done", color: COLORS.green },
} as const;
