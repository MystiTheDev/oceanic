import { useBlockNoteEditor, useEditorState } from "@blocknote/react";
import { ChevronDown } from "lucide-react";
import { FONT_IDS, FONTS } from "../lib/fonts";
import { openContextMenu, type MenuItem } from "./ContextMenu";

/** Selection toolbar: font family for the selected text ("Default" clears it). */
export function FontButton() {
  const editor = useBlockNoteEditor();
  const current = useEditorState({
    editor,
    selector: ({ editor }) => (editor.getActiveStyles() as { font?: string }).font ?? "default",
  });

  const open = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(
      { clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} } as never,
      FONT_IDS.map(
        (id): MenuItem => ({
          label: FONTS[id].label,
          icon: <span style={{ fontFamily: FONTS[id].stack }} className="w-4 text-center text-[13px]">Ag</span>,
          checked: current === id,
          onSelect: () => {
            editor.focus();
            if (id === "default") editor.removeStyles({ font: "" } as never);
            else editor.addStyles({ font: id } as never);
          },
        }),
      ),
    );
  };

  return (
    <button
      type="button"
      title="Font"
      onMouseDown={(e) => e.preventDefault()}
      onClick={open}
      className="oc-font-button flex h-7 cursor-pointer items-center gap-1 rounded px-1.5 text-[13px] text-[var(--oc-text-2)] transition-colors hover:bg-[rgba(var(--oc-ink),0.06)]"
    >
      <span style={{ fontFamily: FONTS[current as keyof typeof FONTS]?.stack }}>Aa</span>
      <ChevronDown className="size-3" />
    </button>
  );
}
