import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  useComponentsContext,
} from "@blocknote/react";
import { useEscape } from "../lib/overlay";

/** Rough panel height (two labelled rows of 32px buttons), used to open upward near the bottom. */
const PANEL_H = 150;

/** Notion-style "⋯" button that tucks alignment and indent controls away. */
export function ToolbarOverflow() {
  const Components = useComponentsContext()!;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEscape(() => setOpen(false), open);

  // Close on outside click or scroll; the toolbar scrolls, so the panel is fixed-positioned.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!wrapRef.current?.contains(t) && !t.closest?.(".oc-overflow-panel")) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      // Open below the button, or above it when the toolbar sits near the bottom of the window.
      const below = rect.bottom + 8 + PANEL_H <= window.innerHeight;
      setPos({ top: below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - PANEL_H), left: rect.right });
    }
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
          role="menu"
          aria-label="More formatting"
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
