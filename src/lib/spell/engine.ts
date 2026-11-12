import { useSyncExternalStore } from "react";
import { api } from "../../data/api";

/**
 * Offline spelling for Oceanic: a bundled English word list (~275k words),
 * your own dictionary, auto-learned words, custom replacements and subject
 * word packs. Everything runs locally.
 */
/** "uk"/"us": the other spelling is flagged and autocorrected (colour ↔ color). */
export type Dialect = "both" | "uk" | "us";
export type SpellSettings = { autocorrect: boolean; underline: boolean; complete: boolean; dialect: Dialect };
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
let state: State = { ready: false, settings: { autocorrect: true, underline: true, complete: true, dialect: "both" }, user: [], learned: {}, replacements: {}, packs: [] };
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
/** Word → frequency rank (0 = most common), from a 50k subtitle-corpus list. */
let rank = new Map<string, number>();
/** "dont" → "don't": apostrophe-less contractions, fixed as you type. */
let contractions = new Map<string, string>();
const rankOf = (w: string) => rank.get(w) ?? 1e6;

/* ------------------------------------------------------------ UK ↔ US */
const OUR = "colour favour flavour honour humour labour neighbour rumour behaviour harbour vapour odour armour savour endeavour vigour rigour tumour parlour splendour clamour candour valour saviour ardour fervour";
const RE = "centre theatre metre litre fibre calibre sombre spectre lustre meagre sabre kilometre centimetre millimetre";
const PAIRS =
  "defence:defense offence:offense grey:gray travelled:traveled travelling:traveling traveller:traveler travellers:travelers cancelled:canceled cancelling:canceling " +
  "labelled:labeled labelling:labeling modelled:modeled modelling:modeling fuelled:fueled jewellery:jewelry aluminium:aluminum catalogue:catalog analogue:analog " +
  "plough:plow pyjamas:pajamas sceptical:skeptical sceptic:skeptic mould:mold smoulder:smolder enrol:enroll fulfil:fulfill skilful:skillful aeroplane:airplane " +
  "manoeuvre:maneuver paediatric:pediatric encyclopaedia:encyclopedia ageing:aging judgement:judgment acknowledgement:acknowledgment analyse:analyze analysed:analyzed " +
  "analysing:analyzing paralyse:paralyze paralysed:paralyzed catalyse:catalyze";
/** UK → US and US → UK, built once the word lists load. */
const toUS = new Map<string, string>(), toUK = new Map<string, string>();
function buildDialects() {
  const add = (uk: string, us: string) => (toUS.set(uk, us), toUK.set(us, uk));
  for (const p of PAIRS.split(" ")) add(...(p.split(":") as [string, string]));
  const both = (uk: string, us: string) => words.has(uk) && words.has(us) && add(uk, us);
  for (const b of OUR.split(" ")) for (const e of ["", "s", "ed", "ing", "ite", "ites", "able", "ful", "less", "ably"]) both(b + e, b.replace(/our$/, "or") + e);
  for (const b of RE.split(" ")) for (const e of ["", "s", "d"]) both(b + e, b.replace(/re$/, "er") + e);
  // -ise → -ize, only where both spellings are common words ("realise"/"realize", not "surprise").
  for (const [w, r] of rank) {
    if (r > 30000 || w.length < 6) continue;
    const m = w.match(/^(.+)is(e|es|ed|ing|ation|ations|er|ers)$/);
    if (m && rankOf(`${m[1]}iz${m[2]}`) < 30000) add(w, `${m[1]}iz${m[2]}`);
  }
}
/** The spelling the chosen dialect wants for w, or null if w is already fine. */
const dialectFix = (w: string) => (state.settings.dialect === "uk" ? toUK.get(w) : state.settings.dialect === "us" ? toUS.get(w) : undefined) ?? null;
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
    "becasue:because whcih:which wiht:with tehre:there thsi:this yuo:you abotu:about " +
    "definatly:definitely definatley:definitely definitly:definitely occurence:occurrence occurance:occurrence persue:pursue publically:publicly " +
    "begining:beginning beleif:belief calender:calendar cemetary:cemetery colum:column concensus:consensus embarass:embarrass foriegn:foreign " +
    "fourty:forty gaurd:guard harrass:harass hieght:height ignorence:ignorance immediatly:immediately interupt:interrupt lenght:length " +
    "maintainance:maintenance millenium:millennium mischevious:mischievous mispell:misspell occassionally:occasionally oppurtunity:opportunity " +
    "parliment:parliament peice:piece posible:possible prefered:preferred priviledge:privilege pronounciation:pronunciation reciept:receipt " +
    "rythm:rhythm sieze:seize sentance:sentence similiar:similar strenght:strength tendancy:tendency threshhold:threshold tommorrow:tomorrow " +
    "vaccum:vacuum wether:whether wierd:weird").split(" ").map((p) => p.split(":")),
);

/** Subject packs: extra words never flagged. */
export const PACKS: Record<string, { label: string; words: string }> = {
  science: { label: "Science", words: "photosynthesis mitochondria chloroplast ribosome eukaryotic prokaryotic enzyme catalyst isotope electrolysis exothermic endothermic covalent stoichiometry titration oxidation hydrocarbon alkane alkene polymer momentum acceleration kinematics thermodynamics wavelength refraction diffraction capacitor resistor ohm joule newton kilojoule genotype phenotype allele chromosome meiosis mitosis" },
  maths: { label: "Maths", words: "polynomial quadratic logarithm exponent integral derivative differentiation integration trigonometry sine cosine tangent hypotenuse asymptote matrix matrices vector scalar eigenvalue binomial permutation combination probability theorem lemma corollary parabola hyperbola ellipse circumference perpendicular parallelogram rhombus trapezium sigma summation factorial" },
  computing: { label: "Computing", words: "algorithm boolean recursion iteration bytecode compiler interpreter runtime array struct pointer integer float string null async await promise callback api json html css javascript typescript python java kotlin rust sql database backend frontend localhost github repo" },
};

/** Modern / app words missing from both word lists (always accepted). */
const MODERN = new Set(
  ("autocorrect autocorrects autocorrected autocomplete autofill spellcheck spellchecker mindmap mindmaps flashcard flashcards dropdown dropdowns checkbox checkboxes " +
    "wifi emoji emojis selfie selfies youtube youtuber google googled instagram tiktok whatsapp netflix spotify chatbot chatbots podcast podcasts livestream " +
    "smartwatch touchscreen screenshot screenshots screencast webcam webpage webpages website websites username usernames login logins logout signup " +
    "hashtag hashtags inbox timestamp timestamps workspace workspaces sidebar sidebars toolbar toolbars homepage dashboard dashboards backlink backlinks " +
    "subpage subpages tooltip tooltips popup popups darkmode offline online email emails emailed emailing app apps ebook ebooks pdf pdfs docx " +
    "unselect deselect redo undo multitask multitasking pomodoro").split(" "),
);

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
  const freq = ((await import("./freq.json")) as { default: string[] }).default;
  words = new Set(list);
  sorted = list.slice().sort();
  rank = new Map(freq.map((w, i) => [w, i]));
  buildDialects();
  contractions = new Map(freq.filter((w) => w.includes("'")).map((w) => [w.replace(/'/g, ""), w]));
  set({ ready: true });
}

const norm = (w: string) => w.toLowerCase().replace(/[’']/g, "'");
/** Is this word fine? (dictionary, your words, learned, packs, numbers, capitals/acronyms) */
export function isKnown(word: string) {
  if (!state.ready || word.length < 2 || /\d/.test(word) || ignored.has(norm(word))) return true;
  const w = norm(word).replace(/'s$/, "");
  if (dialectFix(w) && !state.user.includes(w)) return false;
  if (words.has(w) || words.has(norm(word))) return true;
  if (MODERN.has(w)) return true;
  // Contractions: don't, shouldn't, they're, we'll, I'd… (the dictionary has no apostrophes).
  if (w.includes("'") && ([...contractions.values()].includes(w) || /^(can't|won't|shan't|ain't)$/.test(w) || (/(n't|'re|'ve|'ll|'d|'m)$/.test(w) && isKnown(w.replace(/n't$|'re$|'ve$|'ll$|'d$|'m$/, ""))))) return true;
  // Common words the dictionary lacks (names, newer words), but not typos or "dont"-style contractions.
  if (rankOf(w) < 20000 && !TYPOS[w] && !contractions.has(w)) return true;
  if (state.user.includes(w) || (state.learned[w] ?? 0) >= 3) return true;
  if (state.packs.some((p) => PACKS[p]?.words.split(" ").includes(w))) return true;
  if (/^[A-Z0-9]{2,}$/.test(word)) return true; // acronyms
  return false;
}

/** Fix-as-you-type: your replacements first, then common typos. Keeps the word's capitalisation. */
export function autocorrectFor(word: string): string | null {
  if (!state.settings.autocorrect) return null;
  const w = norm(word);
  const fix = state.replacements[w] ?? TYPOS[w] ?? contractions.get(w) ?? dialectFix(w) ?? swapFix(word);
  if (!fix) return null;
  return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
}

/** Safe autocorrect: two swapped letters making a common word ("form"/"from" untouched: both are words), or one unambiguous edit on a long word. */
function swapFix(word: string): string | null {
  const w = norm(word);
  if (w.length < 4 || isKnown(word)) return null;
  let best: string | null = null;
  for (let i = 0; i < w.length - 1; i++) {
    const x = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
    if (rankOf(x) < 5000 && (!best || rankOf(x) < rankOf(best))) best = x;
  }
  if (best || w.length < 6) return best;
  // Longer words with exactly one common word one edit away ("excercise" → "exercise").
  const hits = [...edits1(w)].filter((x) => rankOf(x) < 15000);
  return hits.length === 1 ? hits[0] : null;
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
  const known = (x: string) => words.has(x) || rank.has(x) || MODERN.has(x) || state.user.includes(x) || (state.learned[x] ?? 0) >= 3;
  // Your words first, then by how common the word is (rare dictionary words last).
  const cost = (x: string) => ((state.learned[x] ?? 0) >= 3 || state.user.includes(x) ? -1 : Math.log2(rankOf(x) + 2));
  const one = [...edits1(w)].filter(known);
  let found = one.sort((a, b) => cost(a) - cost(b));
  // Also try two edits when one edit only found rare words.
  if (w.length <= 12 && (!one.length || rankOf(one[0]) > 20000)) {
    const two = new Set<string>();
    for (const e of edits1(w)) for (const e2 of edits1(e)) if (rank.has(e2) && rankOf(e2) < 20000) two.add(e2);
    // A common word two edits away beats a rare word one edit away.
    found = [...new Set([...found.filter((x) => rankOf(x) < 20000), ...[...two].sort((a, b) => cost(a) - cost(b)), ...found])];
  }
  const typo = TYPOS[w] ?? contractions.get(w) ?? dialectFix(w);
  const ranked = [...new Set([...(typo ? [typo] : []), ...found])].filter((x) => x !== w).slice(0, 3);
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
    freqPrefix(p) ??
    (p.length >= 6 ? dictPrefix(p) : null);
  if (!pick) return null;
  return prefix + pick.slice(prefix.length);
}
/** Most common word that starts with p and adds at least 2 letters (worth a Tab). */
function freqPrefix(p: string) {
  for (const [w] of rank) if (w.length >= p.length + 2 && w.startsWith(p) && !w.includes("'")) return w;
  return null;
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
