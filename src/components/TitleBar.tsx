import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openContextMenu } from "./ContextMenu";
import logoRaw from "../assets/logo-raw.png";
import mindmapLogo from "../assets/mindmap-logo.png";
import docsLogo from "../assets/docs-logo.png";
import sketchLogo from "../assets/sketch-logo.png";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Minus,
  PanelLeft,
  Plus,
  Square,
  X,
} from "lucide-react";

export type TabInfo = {
  tabId: string;
  icon: string;
  title: string;
  /** The Home tab: icon only, no close button, stays first. */
  pinned?: boolean;
};

type TitleBarProps = {
  tabs: TabInfo[];
  activeTabId: string | null;
  sidebarCollapsed: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsToRight: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onMoveTab: (tabId: string, toIndex: number) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
};

/**
 * Notion's desktop title bar: sidebar toggle, ← →, browser-style tabs that
 * shrink evenly, "+", then window controls. Empty space drags the window.
 */
export function TitleBar({
  tabs,
  activeTabId,
  sidebarCollapsed,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onDuplicateTab,
  onMoveTab,
  onNewTab,
  onToggleSidebar,
}: TitleBarProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  /** Live drag: which tab, where it was grabbed, and the pointer x. */
  const drag = useRef<{ id: string; grab: number; x: number } | null>(null);
  const lastLeft = useRef(new Map<string, number>());

  /** Keeps the dragged tab under the cursor, whatever slot it currently has. */
  const followCursor = () => {
    const d = drag.current;
    const tab = d && document.querySelector<HTMLElement>(`[data-tab-id="${d.id}"]`);
    if (!d || !tab?.offsetParent) return;
    const base = (tab.offsetParent as HTMLElement).getBoundingClientRect().left + tab.offsetLeft;
    tab.style.transition = "none";
    tab.style.transform = `translateX(${d.x - d.grab - base}px)`;
  };

  // FLIP: when the order changes, the other tabs slide from their old spot.
  const order = tabs.map((t) => t.tabId).join("|");
  useLayoutEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-tab-id]")];
    for (const el of els) {
      const id = el.dataset.tabId!;
      const prev = lastLeft.current.get(id);
      const now = el.offsetLeft;
      if (id !== drag.current?.id && prev !== undefined && prev !== now) {
        el.style.transition = "none";
        el.style.transform = `translateX(${prev - now}px)`;
        void el.offsetWidth;
        el.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
        el.style.transform = "";
      }
    }
    lastLeft.current = new Map(els.map((el) => [el.dataset.tabId!, el.offsetLeft]));
    followCursor();
  }, [order]);

  /**
   * Pointer-driven reordering (HTML5 drag-and-drop is swallowed by Tauri's
   * file-drop handler on Windows). Past a 4px threshold the tab follows the
   * cursor; crossing a neighbour's midpoint swaps them, like browser tabs.
   */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>, tabId: string) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    const el = e.currentTarget;
    const startX = e.clientX;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 4) return;
      if (!dragging) {
        dragging = true;
        drag.current = { id: tabId, grab: startX - el.getBoundingClientRect().left, x: ev.clientX };
        setDragId(tabId);
        onSelectTab(tabId);
      }
      drag.current!.x = ev.clientX;
      followCursor();
      const strip = el.parentElement!;
      const others = [...strip.querySelectorAll<HTMLElement>("[data-tab-id]")];
      const from = others.findIndex((t) => t.dataset.tabId === tabId);
      let to = from;
      others.forEach((t, i) => {
        if (i === from) return;
        const r = t.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        if (i < from && ev.clientX < mid) to = Math.min(to, i);
        if (i > from && ev.clientX > mid) to = Math.max(to, i);
      });
      if (to !== from) onMoveTab(tabId, to);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = drag.current;
      drag.current = null;
      setDragId(null);
      // Settle into its slot.
      const tab = d && document.querySelector<HTMLElement>(`[data-tab-id="${d.id}"]`);
      if (tab) {
        tab.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
        tab.style.transform = "";
        window.setTimeout(() => (tab.style.transition = ""), 180);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const activeIdx = tabs.findIndex((t) => t.tabId === activeTabId);

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-end bg-[var(--oc-titlebar)] pl-2"
    >
      {/* ---- Left cluster: sidebar toggle, back / forward ---- */}
      <div data-tauri-drag-region className="flex h-full items-center gap-0.5 pr-3">
        <BarButton
          title={sidebarCollapsed ? "Open sidebar (Ctrl + \\)" : "Close sidebar (Ctrl + \\)"}
          onClick={onToggleSidebar}
        >
          <PanelLeft className="size-4" />
        </BarButton>
        <BarButton title="Go back (Alt + ←)" disabled={!canGoBack} onClick={onBack}>
          <ArrowLeft className="size-4" />
        </BarButton>
        <BarButton title="Go forward (Alt + →)" disabled={!canGoForward} onClick={onForward}>
          <ArrowRight className="size-4" />
        </BarButton>
        {/* Separator between the nav buttons and the tab strip */}
        <span className="ml-3 h-5 w-px bg-white/15" />
      </div>

      {/* ---- Tabs: shrink evenly from 220px, then scroll ---- */}
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 [scrollbar-width:none] items-end overflow-x-auto"
      >
        {tabs.map((tab, i) => {
          const active = tab.tabId === activeTabId;
          // Hairline between two inactive neighbours, like browser tabs.
          const divider = !active && i + 1 !== activeIdx && i < tabs.length - 1;
          if (tab.pinned) {
            return (
              <div
                key={tab.tabId}
                data-tab-id={tab.tabId}
                title={tab.title}
                onClick={() => onSelectTab(tab.tabId)}
                className={`relative grid h-[34px] w-11 shrink-0 cursor-default place-items-center rounded-t-lg transition-colors duration-100 ${
                  active ? "oc-tab-active z-10 bg-neutral-900" : "hover:bg-white/[0.06]"
                }`}
              >
                <img
                  src={tab.icon === "mindmap-logo" ? mindmapLogo : tab.icon === "docs-logo" ? docsLogo : tab.icon === "sketch-logo" ? sketchLogo : logoRaw}
                  alt={tab.title}
                  className={`size-[18px] object-contain transition-opacity ${active ? "" : "opacity-70"}`}
                />
                {divider && <span className="pointer-events-none absolute right-0 top-1/2 h-4 w-px -translate-y-1/2 bg-white/10" />}
              </div>
            );
          }
          return (
            <div
              key={tab.tabId}
              data-tab-id={tab.tabId}
              title={tab.title}
              onClick={() => onSelectTab(tab.tabId)}
              onPointerDown={(e) => startDrag(e, tab.tabId)}
              onAuxClick={(e) => e.button === 1 && onCloseTab(tab.tabId)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onContextMenu={(e) =>
                openContextMenu(e, [
                  {
                    label: "Duplicate tab",
                    icon: <Copy className="size-4" />,
                    onSelect: () => onDuplicateTab(tab.tabId),
                  },
                  {
                    label: "Close tab",
                    icon: <X className="size-4" />,
                    hint: "Ctrl+W",
                    onSelect: () => onCloseTab(tab.tabId),
                  },
                  "divider",
                  {
                    label: "Close other tabs",
                    disabled: tabs.filter((t) => !t.pinned).length === 1,
                    onSelect: () => onCloseOtherTabs(tab.tabId),
                  },
                  {
                    label: "Close tabs to the right",
                    disabled: i === tabs.length - 1,
                    onSelect: () => onCloseTabsToRight(tab.tabId),
                  },
                ])
              }
              className={`oc-tab-in group relative mx-px flex h-[34px] min-w-[72px] max-w-[200px] flex-[0_1_200px] cursor-default items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-[13px] transition-colors duration-100 ${
                active
                  ? "oc-tab-active z-10 bg-neutral-900 text-neutral-100 shadow-[0_-1px_0_rgba(255,255,255,0.06)]"
                  : "text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
              } ${dragId === tab.tabId ? "oc-tab-dragging z-20 bg-neutral-800" : ""}`}
            >
              {tab.icon === "logo" || tab.icon === "mindmap-logo" || tab.icon === "docs-logo" || tab.icon === "sketch-logo" ? (
                <img src={tab.icon === "logo" ? logoRaw : tab.icon === "docs-logo" ? docsLogo : tab.icon === "sketch-logo" ? sketchLogo : mindmapLogo} alt="" className="size-4 shrink-0 rounded-[3px] object-contain" />
              ) : (
                <span className="shrink-0 text-[14px] leading-none">{tab.icon}</span>
              )}
              {/* Long titles fade out instead of ellipsis */}
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]">
                {tab.title}
              </span>
              <button
                type="button"
                title="Close tab (Ctrl + W)"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.tabId);
                }}
                className={`grid size-5 shrink-0 cursor-pointer place-items-center rounded text-neutral-400 transition-[opacity,background-color,color] duration-100 hover:bg-white/10 hover:text-neutral-100 ${
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X className="size-3.5" />
              </button>
              {divider && (
                <span className="pointer-events-none absolute -right-px top-1/2 h-5 w-px -translate-y-1/2 bg-white/20 group-hover:opacity-0" />
              )}
            </div>
          );
        })}

        <div data-tauri-drag-region className="flex h-full shrink-0 items-center pl-1 pr-3">
          <BarButton title="New page (Ctrl + N)" onClick={onNewTab}>
            <Plus className="size-4" />
          </BarButton>
        </div>
      </div>

      <WindowControls />

    </header>
  );
}

/* ---------------------------------------------------------------- Bits */
function BarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-neutral-400 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-200 disabled:cursor-default disabled:text-neutral-700 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Windows-style – □ × buttons; hidden when running in a plain browser. */
export function WindowControls() {
  if (!isTauri()) return <div data-tauri-drag-region className="w-2" />;
  const win = getCurrentWindow();
  const base =
    "grid h-full w-[46px] cursor-default place-items-center text-neutral-400 transition-colors duration-100";
  return (
    <div className="flex h-full shrink-0">
      <button type="button" title="Minimize" onClick={() => win.minimize()} className={`${base} hover:bg-white/[0.06] hover:text-neutral-100`}>
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <button type="button" title="Maximize" onClick={() => win.toggleMaximize()} className={`${base} hover:bg-white/[0.06] hover:text-neutral-100`}>
        <Square className="size-3" strokeWidth={1.5} />
      </button>
      <button type="button" title="Close" onClick={() => win.close()} className={`${base} hover:bg-[#c42b1c] hover:text-[#fff]`}>
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
