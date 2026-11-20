/* Word-level diff for Nerida's before/after previews (editor AI actions, and Phase 4.5 agent edits). */

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** Words with their trailing spaces, so joining the parts gives the text back exactly. */
const tokens = (s: string) => s.match(/\s+|[^\s]+\s*/g) ?? [];

/** LCS on words; neighbouring parts of the same kind are merged. Very long texts fall back to
 *  "all removed, all added" rather than a slow table. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before), b = tokens(after);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const l = out[out.length - 1];
    if (l?.kind === kind) l.text += text;
    else if (text) out.push({ kind, text });
  };
  if (a.length * b.length > 4_000_000) return [{ kind: "del", text: before }, { kind: "add", text: after }].filter((p) => p.text) as DiffPart[];
  // Compare words without their trailing spaces, so "end." vs "end. " still match.
  const key = (t: string) => t.trimEnd();
  const n = a.length, m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * (m + 1) + j] = key(a[i]) === key(b[j]) ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    // Same word: keep the original's trailing space when the new text has none (e.g. it ends there).
    if (key(a[i]) === key(b[j])) push("same", b[j].length < a[i].length ? a[i] : b[j]), i++, j++;
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

/** True when the edit changed nothing but spacing. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
