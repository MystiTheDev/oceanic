import { useEffect, useState } from "react";
import { ThinkingStatus } from "./NeridaEffort";
import { isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { builtin, engine, MODEL_NAMES, modelLabel, nerida, useNerida } from "../lib/nerida";
import { gatherText, generateCards, saveCards, stopGenerating, type CardStyle, type Difficulty, type GenCard } from "../lib/neridaStudy";
import { Modal, ModalButton } from "./Modal";
import { neridaNote, pdfPages } from "../lib/neridaPdf";
import { BetaPill, NeridaMark } from "./NeridaOrb";

/** `pdf`: cards from a PDF (or a selection in it), saved to a "<PDF> flashcards" note. */
type Req = { pageId: string; selection?: string; pdf?: { docId: string; name: string } };
export const openNeridaCards = (req: Req) => window.dispatchEvent(new CustomEvent("oc-nerida-flashcards", { detail: req }));

/** Mounted once in App: opens the generator when something asks for it. */
export function NeridaCardsHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<Req>).detail);
    window.addEventListener("oc-nerida-flashcards", on);
    return () => window.removeEventListener("oc-nerida-flashcards", on);
  }, []);
  return req ? <NeridaCards key={req.pageId + (req.pdf?.docId ?? "") + (req.selection ?? "")} {...req} onClose={() => setReq(null)} /> : null;
}

const chip = (on: boolean) => `cursor-pointer rounded-full border px-3 py-1 text-[12.5px] transition-colors ${on ? "border-teal-300/50 bg-teal-300/10 text-teal-100" : "border-white/[0.1] text-neutral-400 hover:text-neutral-200"}`;
const label = "mb-1.5 mt-4 block text-[12px] text-neutral-400";

function NeridaCards({ pageId, selection, pdf, onClose }: Req & { onClose: () => void }) {
  const { model } = useNerida();
  const [count, setCount] = useState(10);
  const [styles, setStyles] = useState<CardStyle[]>(["qa"]);
  const [level, setLevel] = useState<Difficulty>("medium");
  const [related, setRelated] = useState(false);
  const [cards, setCards] = useState<GenCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    const b = builtin(model);
    if (!isTauri()) return setReady(false);
    if (!b) return setReady(true);
    void engine.status().then((s) => setReady(s.server && !!s.models.find((m) => m.id === b)?.installed)).catch(() => setReady(false));
  }, [model]);

  const run = async () => {
    setErr("");
    setBusy(true);
    setCards((c) => c ?? []);
    try {
      // PDF lines break mid-sentence: join them back into sentences.
      const flat = (t: string) => t.replace(/-\n(?=[a-z])/g, "").replace(/\n(?!\n)/g, " ");
      const src = selection
        ? [{ pageId, title: "Selection", text: pdf ? flat(selection) : selection }]
        : pdf
          ? (await pdfPages(pdf.docId)).map((p) => ({ pageId, title: pdf.name, text: flat(p.text) }))
          : await gatherText([pageId], related);
      const before = cards?.length ?? 0;
      const made = await generateCards(src, count, styles, level, (c) => setCards((x) => [...(x ?? []), c]), (cards ?? []).map((c) => c.text.split(" :: ")[0]));
      if (!made && !before) setErr("Nerida couldn't find enough facts to make cards from. Try a longer note or another model.");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? (list.length > 1 ? list.filter((x) => x !== v) : list) : [...list, v]);
  const close = () => (busy && stopGenerating(), onClose());

  return (
    <Modal onClose={close} className="w-[560px]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-3.5">
        <NeridaMark size={22} busy={busy} />
        <h2 className="flex-1 text-[15px] font-semibold text-neutral-100">Make flashcards{selection ? " from selection" : pdf ? " from PDF" : ""}<BetaPill /></h2>
        <span className="text-[12px] text-neutral-500">{modelLabel(model)}</span>
      </div>

      <div className="scrollbar-thin max-h-[62vh] overflow-y-auto px-5 pb-4">
        {ready === false ? (
          <div className="mt-5 text-center text-[13px] text-neutral-400">
            <p>{builtin(model) ? `${MODEL_NAMES[builtin(model)!]} isn't set up yet.` : "Nerida runs in the Oceanic desktop app."}</p>
            {isTauri() && <button type="button" onClick={() => (onClose(), nerida.set({ open: true }))} className="mt-3 cursor-pointer rounded-lg bg-teal-400/90 px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-teal-300">Set up Nerida</button>}
          </div>
        ) : cards === null ? (
          <>
            <span className={label}>How many cards · {count}</span>
            <input type="range" min={5} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-teal-400" />
            <span className={label}>Card style</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setStyles(toggle(styles, "qa"))} className={chip(styles.includes("qa"))}>Question :: Answer</button>
              <button type="button" onClick={() => setStyles(toggle(styles, "cloze"))} className={chip(styles.includes("cloze"))}>Fill in the {"{{blank}}"}</button>
            </div>
            <span className={label}>Difficulty</span>
            <div className="flex gap-1.5">
              {(["easy", "medium", "hard"] as const).map((d) => <button key={d} type="button" onClick={() => setLevel(d)} className={chip(level === d)}>{d[0].toUpperCase() + d.slice(1)}</button>)}
            </div>
            {!selection && !pdf && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-neutral-300">
                <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} className="accent-teal-400" />
                Include sub-pages and linked notes
              </label>
            )}
            <p className="mt-4 text-[11.5px] text-neutral-500">Every card is checked against your note: answers Nerida can't find in it are dropped.</p>
          </>
        ) : (
          <div className="mt-3 space-y-1.5">
            {cards.map((c, i) => (
              <div key={c.id} className="oc-row-in flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                <span className="mt-1.5 w-5 shrink-0 text-right text-[11px] text-neutral-600">{i + 1}</span>
                <textarea value={c.text} rows={Math.max(1, Math.ceil(c.text.length / 60))} onChange={(e) => setCards((x) => x!.map((y) => (y.id === c.id ? { ...y, text: e.target.value } : y)))}
                  className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] text-neutral-100 outline-none" />
                <button type="button" title="Remove" onClick={() => setCards((x) => x!.filter((y) => y.id !== c.id))} className="mt-1 cursor-pointer text-neutral-500 hover:text-red-400"><X className="size-4" /></button>
              </div>
            ))}
            {busy && (
              <>
                <ThinkingStatus />
                <p className="flex items-center gap-2 px-1 py-2 text-[12.5px]"><NeridaMark busy size={15} /><span className="oc-nerida-shimmer">Writing card {cards.length + 1}…</span></p>
              </>
            )}
            {!busy && !cards.length && !err && <p className="py-4 text-center text-[13px] text-neutral-500">No cards.</p>}
          </div>
        )}
        {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">{err}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
        {cards === null ? (
          <>
            <ModalButton onClick={close}>Cancel</ModalButton>
            <ModalButton variant="primary" disabled={!ready} onClick={() => void run()}>Generate</ModalButton>
          </>
        ) : busy ? (
          <ModalButton onClick={stopGenerating}>Stop</ModalButton>
        ) : (
          <>
            <ModalButton onClick={close}>Discard</ModalButton>
            <ModalButton onClick={() => void run()}>Generate more</ModalButton>
            <ModalButton variant="primary" disabled={!cards.some((c) => c.text.trim())} onClick={async () => {
              const list = cards.map((c) => c.text.trim()).filter(Boolean);
              saveCards(pdf ? await neridaNote(`${pdf.name.replace(/\.pdf$/i, "")} flashcards`, undefined, true) : pageId, list);
              onClose();
            }}>
              Save {cards.length} card{cards.length === 1 ? "" : "s"}
            </ModalButton>
          </>
        )}
      </div>
    </Modal>
  );
}
