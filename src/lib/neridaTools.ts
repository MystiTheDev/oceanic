import { invoke } from "@tauri-apps/api/core";
import { api } from "../data/api";
import { findDate } from "./neridaTask";

/* Tools the app runs before Nerida answers: small models get maths, dates and
 * facts wrong, so the app works them out and hands over the exact results. */

const web = (url: string) => invoke<string>("web_get", { url });
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** "what is 12*(3+4)^2" → 588. Only digits and operators are ever evaluated. */
function calc(text: string) {
  const m = text.replace(/[×x](?=\s*\d)/g, "*").replace(/÷/g, "/").match(/[\d.]+(?:\s*[-+*/^%]\s*\(*\s*[\d.]+\s*\)*)+|\([\d.\s+\-*/^%()]+\)[\d.\s+\-*/^%()]*/g);
  const expr = m?.sort((a, b) => b.length - a.length)[0]?.trim();
  if (!expr || !/^[\d.\s+\-*/^%()]+$/.test(expr)) return "";
  try {
    const v = Function(`"use strict";return (${expr.replace(/\^/g, "**")})`)() as number;
    return Number.isFinite(v) ? `${expr} = ${+v.toFixed(10)}` : "";
  } catch {
    return "";
  }
}

const UNITS: Record<string, [string, number]> = {
  mm: ["m", 0.001], cm: ["m", 0.01], m: ["m", 1], km: ["m", 1000], in: ["m", 0.0254], inch: ["m", 0.0254], inches: ["m", 0.0254], ft: ["m", 0.3048], feet: ["m", 0.3048], foot: ["m", 0.3048], yd: ["m", 0.9144], mi: ["m", 1609.344], mile: ["m", 1609.344], miles: ["m", 1609.344],
  mg: ["g", 0.001], g: ["g", 1], kg: ["g", 1000], lb: ["g", 453.592], lbs: ["g", 453.592], oz: ["g", 28.3495],
  ml: ["l", 0.001], l: ["l", 1], litre: ["l", 1], liter: ["l", 1], litres: ["l", 1], liters: ["l", 1],
  s: ["s", 1], sec: ["s", 1], min: ["s", 60], h: ["s", 3600], hr: ["s", 3600], hours: ["s", 3600], day: ["s", 86400], days: ["s", 86400],
};
/** "convert 5 km to miles", "100 f in c", "days until 20 dec". */
function convert(text: string) {
  const t = text.toLowerCase();
  const temp = t.match(/(-?[\d.]+)\s*°?\s*(c|f|k|celsius|fahrenheit|kelvin)\b.*?\b(?:to|in)\s*°?\s*(c|f|k|celsius|fahrenheit|kelvin)\b/);
  if (temp) {
    const [v, a, b] = [+temp[1], temp[2][0], temp[3][0]];
    const c = a === "c" ? v : a === "f" ? ((v - 32) * 5) / 9 : v - 273.15;
    const out = b === "c" ? c : b === "f" ? (c * 9) / 5 + 32 : c + 273.15;
    return `${v}°${a.toUpperCase()} = ${+out.toFixed(2)}°${b.toUpperCase()}`;
  }
  const u = t.match(/(-?[\d.]+)\s*([a-z]+)\s+(?:to|in|into)\s+([a-z]+)/);
  if (u && UNITS[u[2]] && UNITS[u[3]] && UNITS[u[2]][0] === UNITS[u[3]][0]) return `${u[1]} ${u[2]} = ${+((+u[1] * UNITS[u[2]][1]) / UNITS[u[3]][1]).toPrecision(6)} ${u[3]}`;
  if (/\b(days?|weeks?) (until|till|left|to go|before)\b|how long until/.test(t)) {
    const d = findDate(text);
    if (d) {
      const now = new Date();
      const days = Math.round((d.date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
      return `${d.date.toDateString()} is ${days} day${days === 1 ? "" : "s"} from today (${(days / 7).toFixed(1)} weeks).`;
    }
  }
  return "";
}

async function define(text: string) {
  const w = text.toLowerCase().match(/\b(?:define|definition of|meaning of|what does)\s+"?([a-z-]+)"?/)?.[1];
  if (!w) return "";
  try {
    const j = JSON.parse(await web(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`));
    const ms = (j[0]?.meanings ?? []).slice(0, 3).map((m: { partOfSpeech: string; definitions: { definition: string }[] }) => `(${m.partOfSpeech}) ${m.definitions[0]?.definition}`);
    return ms.length ? `Dictionary, "${w}": ${ms.join(" ")}` : "";
  } catch {
    return ""; // offline: Nerida answers from what it knows
  }
}

/** Wikipedia first (clean, reliable); DuckDuckGo snippets when it has nothing. */
export async function searchWeb(q: string): Promise<{ text: string; sources: string[] }> {
  const query = q.replace(/\b(please|can you|could you|tell me|search|look up|google|on the (web|internet))\b/gi, "").trim();
  try {
    const s = JSON.parse(await web(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=2&srsearch=${encodeURIComponent(query)}`));
    const titles: string[] = (s.query?.search ?? []).map((r: { title: string }) => r.title);
    if (titles.length) {
      const e = JSON.parse(await web(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&format=json&titles=${encodeURIComponent(titles.join("|"))}`));
      const pages = Object.values(e.query?.pages ?? {}) as { title: string; extract?: string }[];
      const text = pages.filter((p) => p.extract).map((p) => `Wikipedia, "${p.title}": ${p.extract!.slice(0, 2500)}`).join("\n\n");
      if (text) return { text, sources: pages.map((p) => `[${p.title} — Wikipedia](https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))})`) };
    }
  } catch {
    /* try DuckDuckGo */
  }
  const html = await web(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const hits = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 4);
  const url = (h: string) => decodeURIComponent(h.match(/uddg=([^&]+)/)?.[1] ?? h);
  return { text: hits.map((h) => `${strip(h[2])}: ${strip(h[3])}`).join("\n"), sources: hits.map((h) => `[${strip(h[2])}](${url(h[1])})`) };
}

/** Top notes for a question across the whole workspace (used when no note is attached). */
export async function searchNotes(q: string) {
  const words = (q.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !["what", "when", "where", "which", "about", "does", "have", "this", "that", "with", "from", "explain", "notes", "note"].includes(w));
  if (!words.length) return [];
  // The search ANDs its words, so search each word and rank notes by how many they match.
  const score = new Map<string, number>();
  for (const w of words.slice(0, 6)) for (const h of await api.searchPages(w, false).catch(() => [])) score.set(h.pageId, (score.get(h.pageId) ?? 0) + 1);
  return [...score].filter(([, n]) => n >= Math.min(2, words.length)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
}

/** Exact results for the question, ready to put in front of Nerida (empty when no tool fits). */
export async function runTools(text: string) {
  const out = [calc(text), convert(text), await define(text)].filter(Boolean);
  return out.length ? `Exact results worked out by the app (use these, don't recalculate):\n${out.join("\n")}` : "";
}
