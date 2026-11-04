import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookPlus, EyeOff, Sparkles } from "lucide-react";
import { addToDictionary, autocorrectFor, ignoreWord, noteWord, suggestionsFor } from "../lib/spell/engine";
import { SPELL_POPUP, type SpellPopupDetail } from "../lib/spell/plugin";

/** Custom spelling popup (click an underlined word) + autocorrect in plain text boxes. */
export function SpellUI() {
  const [pop, setPop] = useState<SpellPopupDetail | null>(null);

  useEffect(() => {
    const open = (e: Event) => setPop((e as CustomEvent<SpellPopupDetail>).detail);
    window.addEventListener(SPELL_POPUP, open);

    // Titles, search and other text boxes: autocorrect + learning when a word ends.
    const input = (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      const ie = e as InputEvent;
      if (!(el instanceof HTMLInputElement && ["text", "search", ""].includes(el.type)) && !(el instanceof HTMLTextAreaElement)) return;
      if (ie.inputType !== "insertText" || !ie.data || !/^[\s.,!?;:)]$/.test(ie.data) || el.dataset.noSpell != null) return;
      const caret = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, caret - 1);
      const m = /[A-Za-z][A-Za-z'’]*$/.exec(before);
      if (!m) return;
      noteWord(m[0]);
      const fix = autocorrectFor(m[0]);
      if (!fix || fix === m[0]) return;
      const start = caret - 1 - m[0].length;
      const value = el.value.slice(0, start) + fix + el.value.slice(caret - 1);
      // Set through the native setter so React-controlled boxes notice.
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const at = start + fix.length + 1;
      el.setSelectionRange(at, at);
    };
    document.addEventListener("input", input, true);
    return () => (window.removeEventListener(SPELL_POPUP, open), document.removeEventListener("input", input, true));
  }, []);

  if (!pop) return null;
  const sugg = suggestionsFor(pop.word);
  const close = () => setPop(null);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[85]" onMouseDown={close} />
      <div
        className="oc-docs-pop fixed z-[86] w-60 overflow-hidden rounded-xl border border-white/[0.1] bg-[var(--oc-surface)] shadow-[0_14px_36px_rgba(0,0,0,0.5)]"
        style={{ left: Math.min(pop.x, window.innerWidth - 250), top: Math.min(pop.y, window.innerHeight - 220) }}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <Sparkles className="size-3.5 text-amber-300" />
          <span className="truncate text-[12px] text-neutral-400">
            “<span className="text-red-300 underline decoration-wavy decoration-red-400/70">{pop.word}</span>” isn't in the dictionary
          </span>
        </div>
        <div className="p-1">
          {sugg.length ? (
            sugg.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => (pop.replace(s), close())}
                className={`flex h-8 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-[14px] hover:bg-sky-500/15 hover:text-sky-200 ${i === 0 ? "font-semibold text-neutral-100" : "text-neutral-200"}`}
              >
                {s}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-1.5 text-[12.5px] text-neutral-500">No suggestions</p>
          )}
        </div>
        <div className="border-t border-white/[0.06] p-1">
          <button type="button" onClick={() => (addToDictionary(pop.word), close())} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] text-neutral-300 hover:bg-white/[0.06]">
            <BookPlus className="size-4 text-emerald-400" /> Add to my dictionary
          </button>
          <button type="button" onClick={() => (ignoreWord(pop.word), close())} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] text-neutral-300 hover:bg-white/[0.06]">
            <EyeOff className="size-4 text-neutral-500" /> Ignore for now
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
