import { useSyncExternalStore } from "react";
import { api } from "../../data/api";

/**
 * Offline spelling for Oceanic: a bundled English word list (~275k words),
 * your own dictionary, auto-learned words, custom replacements and subject
 * word packs. Everything runs locally.
 */
export type SpellSettings = { autocorrect: boolean; underline: boolean; complete: boolean };
type State = {
  ready: boolean;
  settings: SpellSettings;
  /** Words you added: never flagged. */
  user: string[];
  /** Words you typed often (count), learned automatically after 3 uses. */
  learned: Record<string, number>;
  /** Your shortcuts: "pls" → "please". */
  replacements: Record<string, string>;
  packs: string[];
};
let state: State = { ready: false, settings: { autocorrect: true, underline: true, complete: true }, user: [], learned: {}, replacements: {}, packs: [] };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => ((state = { ...state, ...p }), listeners.forEach((l) => l()));
export const useSpell = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
export const spellState = () => state;
export const subscribeSpell = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

let words: Set<string> = new Set();
let sorted: string[] = [];
const ignored = new Set<string>();

/** Common typos fixed as you type. */
const TYPOS: Record<string, string> = Object.fromEntries(
  ("teh:the adn:and taht:that thier:their recieve:receive seperate:separate definately:definitely occured:occurred untill:until wich:which " +
    "becuase:because beacuse:because alot:a lot dont:don't cant:can't wont:won't im:I'm ive:I've didnt:didn't doesnt:doesn't isnt:isn't " +
    "wasnt:wasn't shouldnt:shouldn't couldnt:couldn't wouldnt:wouldn't youre:you're theyre:they're thats:that's whats:what's lets:let's " +
    "goverment:government enviroment:environment occassion:occasion accomodate:accommodate acheive:achieve arguement:argument beleive:believe " +
    "calender:calendar comming:coming commited:committed concious:conscious existance:existence experiance:experience freind:friend " +
    "garantee:guarantee grammer:grammar happend:happened independant:independent knowlege:knowledge libary:library neccessary:necessary " +
    "noticable:noticeable posession:possession prefered:preferred reccomend:recommend refered:referred relevent:relevant succesful:successful " +
    "suprise:surprise tommorow:tomorrow tounge:tongue truely:truly wierd:weird writting:writing hte:the fo:of nad:and waht:what jsut:just " +
    "becasue:because whcih:which wiht:with tehre:there thsi:this yuo:you abotu:about").split(" ").map((p) => p.split(":")),
);

/** Subject packs: extra words never flagged. */
export const PACKS: Record<string, { label: string; words: string }> = {
  science: { label: "Science", words: "photosynthesis mitochondria chloroplast ribosome eukaryotic prokaryotic enzyme catalyst isotope electrolysis exothermic endothermic covalent stoichiometry titration oxidation hydrocarbon alkane alkene polymer momentum acceleration kinematics thermodynamics wavelength refraction diffraction capacitor resistor ohm joule newton kilojoule genotype phenotype allele chromosome meiosis mitosis" },
  maths: { label: "Maths", words: "polynomial quadratic logarithm exponent integral derivative differentiation integration trigonometry sine cosine tangent hypotenuse asymptote matrix matrices vector scalar eigenvalue binomial permutation combination probability theorem lemma corollary parabola hyperbola ellipse circumference perpendicular parallelogram rhombus trapezium sigma summation factorial" },
  computing: { label: "Computing", words: "algorithm boolean recursion iteration bytecode compiler interpreter runtime array struct pointer integer float string null async await promise callback api json html css javascript typescript python java kotlin rust sql database backend frontend localhost github repo" },
};

/** Words worth completing (ranked first after learned words). */
const COMMON =
  "because between different important information something everything sometimes another through however without government development experience everyone together business question remember understand interesting probably especially definitely environment education community technology following beginning available particular necessary actually basically different difference knowledge important example examples especially homework assignment experiment chemistry physics biology mathematics geography history literature language science computer programme program project presentation conclusion introduction paragraph summary analysis evaluate explain describe discuss compare contrast therefore although whatever whenever wherever whether including including probably tomorrow yesterday";
const COMMON_LIST = COMMON.split(" ");

const SETTINGS_KEY = "spell";
const persist = () =>
  api
    .setSetting(SETTINGS_KEY, JSON.stringify({ settings: state.settings, user: state.user, learned: state.learned, replacements: state.replacements, packs: state.packs }))
    .catch(() => {});

export async function loadSpell(stored: Record<string, string>) {
  try {
    const s = stored[SETTINGS_KEY] ? JSON.parse(stored[SETTINGS_KEY]) : {};
    set({ settings: { ...state.settings, ...s.settings }, user: s.user ?? [], learned: s.learned ?? {}, replacements: s.replacements ?? {}, packs: s.packs ?? ["science", "maths", "computing"] });
  } catch {}
  // The big list loads in the background (its own chunk).
  const list = ((await import("an-array-of-english-words/index.json")) as { default: string[] }).default;
  words = new Set(list);
  sorted = list.slice().sort();
  set({ ready: true });
}

const norm = (w: string) => w.toLowerCase().replace(/[’']/g, "'");
/** Is this word fine? (dictionary, your words, learned, packs, numbers, capitals/acronyms) */
export function isKnown(word: string) {
  if (!state.ready || word.length < 2 || /\d/.test(word) || ignored.has(norm(word))) return true;
  const w = norm(word).replace(/'s$/, "");
  if (words.has(w) || words.has(norm(word))) return true;
  if (state.user.includes(w) || (state.learned[w] ?? 0) >= 3) return true;
  if (state.packs.some((p) => PACKS[p]?.words.split(" ").includes(w))) return true;
  if (/^[A-Z0-9]{2,}$/.test(word)) return true; // acronyms
  return false;
}

/** Fix-as-you-type: your replacements first, then common typos. Keeps the word's capitalisation. */
export function autocorrectFor(word: string): string | null {
  if (!state.settings.autocorrect) return null;
  const w = norm(word);
  const fix = state.replacements[w] ?? TYPOS[w];
  if (!fix) return null;
  return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz'";
function edits1(w: string) {
  const out = new Set<string>();
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b) out.add(a + b.slice(1));
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
    for (const c of ALPHA) {
      if (b) out.add(a + c + b.slice(1));
      out.add(a + c + b);
    }
  }
  return out;
}
/** Up to 3 suggestions, closest and most familiar first. */
export function suggestionsFor(word: string): string[] {
  const w = norm(word);
  const known = (x: string) => words.has(x) || state.user.includes(x) || (state.learned[x] ?? 0) >= 3;
  const score = (x: string) => (state.learned[x] ?? 0) * 10 + (COMMON_LIST.includes(x) ? 50 : 0) - Math.abs(x.length - w.length);
  let found = [...edits1(w)].filter(known);
  if (!found.length && w.length <= 12) {
    const two = new Set<string>();
    for (const e of edits1(w)) for (const e2 of edits1(e)) if (known(e2)) two.add(e2);
    found = [...two];
  }
  const typo = TYPOS[w];
  const ranked = [...new Set([...(typo ? [typo] : []), ...found.sort((a, b) => score(b) - score(a))])].slice(0, 3);
  const cap = word[0] !== word[0].toLowerCase();
  return ranked.map((s) => (cap ? s[0].toUpperCase() + s.slice(1) : s));
}

/** Completion for a prefix (≥3 letters): your learned/added words, then common words, then the dictionary. */
export function completionFor(prefix: string): string | null {
  if (!state.settings.complete || prefix.length < 3 || !state.ready) return null;
  const p = norm(prefix);
  const learned = Object.entries(state.learned)
    .filter(([w, n]) => n >= 2 && w.startsWith(p) && w !== p)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const pick =
    learned ??
    state.user.find((w) => w.startsWith(p) && w !== p) ??
    COMMON_LIST.find((w) => w.startsWith(p) && w !== p) ??
    (p.length >= 5 ? dictPrefix(p) : null);
  if (!pick) return null;
  return prefix + pick.slice(prefix.length);
}
function dictPrefix(p: string) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  // Shortest of the first few matches.
  const hits = sorted.slice(lo, lo + 30).filter((w) => w.startsWith(p) && w !== p);
  return hits.sort((a, b) => a.length - b.length)[0] ?? null;
}

/** Called for each finished word: unknown words used 3 times become known. */
export function noteWord(word: string) {
  const w = norm(word);
  if (w.length < 3 || /\d/.test(w)) return;
  const n = (state.learned[w] ?? 0) + 1;
  if (words.has(w) && n < 2) return; // track dictionary words only for completion ranking
  set({ learned: { ...state.learned, [w]: n } });
  window.clearTimeout(saveT);
  saveT = window.setTimeout(persist, 1500);
}
let saveT = 0;

export const addToDictionary = (word: string) => (set({ user: [...new Set([...state.user, norm(word)])] }), persist());
export const removeFromDictionary = (word: string) => (set({ user: state.user.filter((w) => w !== word) }), persist());
export const forgetLearned = (word: string) => {
  const learned = { ...state.learned };
  delete learned[word];
  set({ learned });
  persist();
};
export const ignoreWord = (word: string) => (ignored.add(norm(word)), set({}));
export const setReplacements = (replacements: Record<string, string>) => (set({ replacements }), persist());
export const setPacks = (packs: string[]) => (set({ packs }), persist());
export const setSpellSettings = (p: Partial<SpellSettings>) => (set({ settings: { ...state.settings, ...p } }), persist());
