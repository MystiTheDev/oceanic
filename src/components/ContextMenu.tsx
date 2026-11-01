/* ---------------------------------------------------------------------------
 * App-wide custom right-click menu.
 *
 * Any component can call `openContextMenu(e, items)` from its onContextMenu
 * handler (that also prevents the native menu). Right-clicks nobody handles
 * fall through to the global menu (see <ContextMenuHost>), so the browser's
 * own menu never shows.
 * ------------------------------------------------------------------------ */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export type MenuItem =
  | "divider"
  | {
      label: string;
      icon?: ReactNode;
      /** Shortcut hint; only for shortcuts that really work. */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      /** A check mark on the right (current color, current block type…). */
      checked?: boolean;
      onSelect?: () => void;
      /** Opens a submenu to the side. */
      children?: MenuItem[];
    };

type MenuState = { x: number; y: number; items: MenuItem[]; key: number } | null;

/* ------------------------------------------------------------------ store */
let state: MenuState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openContextMenu(e: ReactMouseEvent | MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  state = { x: e.clientX, y: e.clientY, items: tidy(items), key: Date.now() };
  emit();
}

export function closeContextMenu() {
  if (!state) return;
  state = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Drop leading / trailing / doubled dividers left by conditional items. */
function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if (item === "divider" && (out.length === 0 || out[out.length - 1] === "divider")) continue;
    out.push(item);
  }
  while (out[out.length - 1] === "divider") out.pop();
  return out;
}

/* ------------------------------------------------------------------ host */
/**
 * Renders the open menu and catches unhandled right-clicks anywhere in the
 * window. `fallback` builds the menu for those (text field or global items).
 */
export function ContextMenuHost({ fallback }: { fallback: (e: MouseEvent) => MenuItem[] }) {
  const menu = useSyncExternalStore(subscribe, () => state, () => state);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    // Bubble phase on window: component handlers (React, delegated at the
    // root) have already run and called preventDefault if they handled it.
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const items = fallbackRef.current(e);
      e.preventDefault();
      if (items.length) openContextMenu(e, items);
      else closeContextMenu();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => closeContextMenu();
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".oc-context-menu")) close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  if (!menu) return null;
  return createPortal(<MenuPanel key={menu.key} items={menu.items} x={menu.x} y={menu.y} root />, document.body);
}

/* ------------------------------------------------------------------ panel */
function MenuPanel({
  items,
  x,
  y,
  root,
  flipX,
  onCloseSub,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  root?: boolean;
  /** Right edge to use when there's no room on the right (submenus open leftwards). */
  flipX?: number;
  /** Submenus: ← / Escape closes just this level. */
  onCloseSub?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [cursor, setCursor] = useState(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the panel on screen: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width > window.innerWidth - 8 ? Math.max(8, (flipX ?? x) - width) : x;
    const top = y + height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - height - 8) : y;
    setPos({ left, top });
  }, [x, y, flipX]);

  const selectable = items
    .map((item, i) => (item !== "divider" && !item.disabled ? i : -1))
    .filter((i) => i >= 0);

  const activate = (i: number) => {
    const item = items[i];
    if (item === "divider" || item.disabled) return;
    if (item.children) {
      setOpenSub(i);
      return;
    }
    closeContextMenu();
    item.onSelect?.();
  };

  // Keyboard: ↑ ↓ to move, Enter / → to choose, ← / Esc to back out.
  useEffect(() => {
    if (openSub !== null) return; // the submenu owns the keyboard
    const onKey = (e: KeyboardEvent) => {
      const at = selectable.indexOf(cursor);
      if (e.key === "ArrowDown") setCursor(selectable[(at + 1) % selectable.length]);
      else if (e.key === "ArrowUp") setCursor(selectable[(at - 1 + selectable.length) % selectable.length]);
      else if ((e.key === "Enter" || e.key === "ArrowRight") && cursor >= 0) activate(cursor);
      else if (e.key === "ArrowLeft" && !root) onCloseSub?.();
      else if (e.key === "Escape") (root ? closeContextMenu : onCloseSub)?.();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      // Keep focus (and the text selection) where it was, e.g. in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      className={`oc-context-menu oc-pop-in fixed z-[100] min-w-[220px] max-w-[300px] rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl shadow-black/50 ${
        root ? "origin-top-left" : "origin-left"
      }`}
    >
      {items.map((item, i) => {
        if (item === "divider") return <div key={`d${i}`} className="mx-1 my-1 h-px bg-white/[0.07]" />;
        const active = i === cursor || i === openSub;
        return (
          <div key={`${i}-${item.label}`} className="relative">
            <button
              ref={(el) => {
                rows.current[i] = el;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => {
                setCursor(i);
                setOpenSub(item.children ? i : null);
              }}
              onClick={() => activate(i)}
              className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors duration-75 disabled:cursor-default disabled:opacity-40 ${
                active && !item.disabled
                  ? item.danger
                    ? "bg-red-500/10 text-red-400"
                    : "bg-white/[0.06] text-neutral-100"
                  : item.danger
                    ? "text-neutral-300"
                    : "text-neutral-300"
              }`}
            >
              <span
                className={`grid w-4 shrink-0 place-items-center ${
                  active && item.danger ? "text-red-400" : "text-neutral-400"
                }`}
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.checked && <span className="text-[12px] text-neutral-300">✓</span>}
              {item.hint && <span className="shrink-0 text-[11px] text-neutral-500">{item.hint}</span>}
              {item.children && <ChevronRight className="size-3.5 shrink-0 text-neutral-500" />}
            </button>
            {openSub === i && item.children && (
              <SubMenu
                anchor={rows.current[i]}
                items={item.children}
                onClose={() => setOpenSub(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubMenu({
  anchor,
  items,
  onClose,
}: {
  anchor: HTMLButtonElement | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  return <MenuPanel items={tidy(items)} x={r.right + 4} y={r.top - 4} flipX={r.left - 4} onCloseSub={onClose} />;
}
