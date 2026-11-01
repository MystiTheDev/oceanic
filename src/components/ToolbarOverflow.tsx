import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  useComponentsContext,
} from "@blocknote/react";

/** Notion-style "⋯" button that tucks alignment and indent controls away. */
export function ToolbarOverflow() {
  const Components = useComponentsContext()!;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Close on outside click; the toolbar scrolls, so the panel is fixed-positioned.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!wrapRef.current?.contains(t) && !t.closest?.(".oc-overflow-panel")) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 8, left: rect.right });
    setOpen((o) => !o);
  };

  return (
    <span ref={wrapRef} className="oc-overflow">
      <Components.FormattingToolbar.Button
        mainTooltip="More"
        label="More"
        isSelected={open}
        onClick={toggle}
        icon={<span className="oc-overflow-dots">⋯</span>}
      />
      {open &&
        createPortal(
        <div
          className="oc-overflow-panel"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="oc-overflow-label">Align</div>
          <div className="oc-overflow-row">
            <TextAlignButton textAlignment="left" />
            <TextAlignButton textAlignment="center" />
            <TextAlignButton textAlignment="right" />
          </div>
          <div className="oc-overflow-label">Indent</div>
          <div className="oc-overflow-row">
            <UnnestBlockButton />
            <NestBlockButton />
          </div>
        </div>,
          // Portal past the transformed toolbar, but stay inside the themed container.
          wrapRef.current?.closest(".bn-container") ?? document.body,
        )}
    </span>
  );
}
