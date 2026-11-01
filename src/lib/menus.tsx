/* ---------------------------------------------------------------------------
 * Shared right-click menu builders.
 * ------------------------------------------------------------------------ */
import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react";
import type { MenuItem } from "../components/ContextMenu";
import { copySelection, cutSelection, readClipboardText } from "./clipboard";

/** Inputs and textareas: the usual edit commands, acting on that field. */
export function textFieldMenu(el: HTMLInputElement | HTMLTextAreaElement): MenuItem[] {
  const hasSelection = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0);
  const editable = !el.readOnly && !el.disabled;
  return [
    {
      label: "Cut",
      icon: <Scissors className="size-4" />,
      hint: "Ctrl+X",
      disabled: !hasSelection || !editable,
      onSelect: () => {
        el.focus();
        cutSelection();
      },
    },
    {
      label: "Copy",
      icon: <Copy className="size-4" />,
      hint: "Ctrl+C",
      disabled: !hasSelection,
      onSelect: () => {
        el.focus();
        copySelection();
      },
    },
    {
      label: "Paste",
      icon: <ClipboardPaste className="size-4" />,
      hint: "Ctrl+V",
      disabled: !editable,
      onSelect: async () => {
        const text = await readClipboardText();
        el.focus();
        // insertText keeps undo history and fires React's onChange.
        if (text) document.execCommand("insertText", false, text);
      },
    },
    "divider",
    {
      label: "Select all",
      icon: <TextSelect className="size-4" />,
      hint: "Ctrl+A",
      onSelect: () => {
        el.focus();
        el.select();
      },
    },
  ];
}

export const isTextField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && /^(text|search|url|email|password|)$/.test(el.type));
