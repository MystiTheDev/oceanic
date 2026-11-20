import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared overlay behaviour for dialogs, popovers and menus.
 * - Escape closes only the top-most open overlay (nested menu inside a dialog closes first).
 * - Dialogs trap Tab inside themselves and give focus back to what was focused before.
 */
const stack: { current: () => void }[] = [];
let listening = false;
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !stack.length || e.defaultPrevented) return;
  e.preventDefault();
  e.stopPropagation();
  stack[stack.length - 1].current();
}

/** Escape calls `onClose` while `active`; the most recently opened overlay wins. */
export function useEscape(onClose: (() => void) | undefined, active = true) {
  const ref = useRef(onClose ?? (() => {}));
  ref.current = onClose ?? (() => {});
  useEffect(() => {
    if (!active || !onClose) return;
    const entry = { get current() { return ref.current; } };
    stack.push(entry);
    if (!listening) (window.addEventListener("keydown", onKey, true), (listening = true));
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, !onClose]);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/** Keeps Tab inside `ref`, focuses it on open (unless something inside autofocused) and restores focus on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>("[autofocus],[data-autofocus]") ?? box;
      first.focus({ preventScroll: true });
    }
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return e.preventDefault();
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (!ref.current.contains(at)) return (e.preventDefault(), first.focus());
      if (e.shiftKey && (at === first || at === ref.current)) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && at === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, [active]);
}

/** Marks <html data-oc-kbd> while the user navigates by keyboard, so inputs only show the focus ring then. */
export function trackKeyboardMode() {
  const root = document.documentElement;
  window.addEventListener("keydown", (e) => { if (e.key === "Tab") root.dataset.ocKbd = ""; }, true);
  window.addEventListener("pointerdown", () => { delete root.dataset.ocKbd; }, true);
}

/** Enter runs a dialog's main action while `active`, unless focus is on a button, list or text area (they handle Enter themselves). */
export function useEnter(onEnter: (() => void) | undefined, active = true) {
  const ref = useRef(onEnter);
  ref.current = onEnter;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("button,a,select,textarea,[contenteditable='true'],[role='listbox'],[role='menu']")) return;
      // Only the top-most dialog reacts.
      const modals = document.querySelectorAll("[data-oc-modal]");
      const top = modals[modals.length - 1];
      if (top && t && !top.contains(t) && t !== document.body) return;
      e.preventDefault();
      ref.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
