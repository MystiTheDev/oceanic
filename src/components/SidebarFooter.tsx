import { Avatar } from "./SettingsModal";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Moon, MoreHorizontal, PenLine, Plus, Settings, Sun, Trash2 } from "lucide-react";
import type { WorkspaceRecord } from "../data/api";
import { colorOf } from "../lib/colors";
import { openContextMenu } from "./ContextMenu";
import { setDragGhost } from "../lib/dragGhost";

export const APP_VERSION = "1.0.2";

type SidebarFooterProps = {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  userName: string;
  avatar: string;
  theme: "dark" | "light";
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onEditWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onReorderWorkspaces: (ids: string[]) => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
};

/** Notion's sidebar bottom: workspace switcher, then the user row with a theme toggle. */
export function SidebarFooter(props: SidebarFooterProps) {
  const { workspaces, activeWorkspaceId, userName, avatar, theme } = props;
  const [open, setOpen] = useState<"workspaces" | "user" | null>(null);
  const wsRef = useRef<HTMLButtonElement>(null);
  const userRef = useRef<HTMLButtonElement>(null);
  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="flex flex-col gap-px border-t border-white/[0.05] p-2">
      <button
        ref={wsRef}
        type="button"
        onClick={() => setOpen((o) => (o === "workspaces" ? null : "workspaces"))}
        className={`flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[14px] transition-colors duration-100 ${
          open === "workspaces" ? "bg-white/[0.07] text-neutral-100" : "text-neutral-300 hover:bg-white/5"
        }`}
      >
        {active && <WorkspaceIcon ws={active} />}
        <span className="flex-1 truncate text-left font-medium">{active?.name ?? "Workspace"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-neutral-500" />
      </button>

      <div className="flex items-center gap-1">
        <button
          ref={userRef}
          type="button"
          onClick={() => setOpen((o) => (o === "user" ? null : "user"))}
          className={`flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[14px] transition-colors duration-100 ${
            open === "user" ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
          }`}
        >
          <Avatar name={userName} avatar={avatar} />
          <span className="truncate">{userName || "You"}</span>
        </button>
        <button
          type="button"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={props.onToggleTheme}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-neutral-500 transition-colors duration-100 hover:bg-white/5 hover:text-neutral-200"
        >
          {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
      </div>

      {open === "workspaces" && wsRef.current && (
        <Popover anchor={wsRef.current} onClose={() => setOpen(null)}>
          <WorkspaceList {...props} onDone={() => setOpen(null)} />
        </Popover>
      )}
      {open === "user" && userRef.current && (
        <Popover anchor={userRef.current} onClose={() => setOpen(null)}>
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={userName} avatar={avatar} size={32} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-neutral-100">{userName || "You"}</p>
              <p className="text-[11px] text-neutral-500">Local profile</p>
            </div>
          </div>
          <div className="my-1 h-px bg-white/[0.06]" />
          <MenuRow
            icon={<Settings className="size-4" />}
            onClick={() => {
              setOpen(null);
              props.onOpenSettings();
            }}
          >
            Settings
          </MenuRow>
          <div className="my-1 h-px bg-white/[0.06]" />
          <p className="px-2.5 py-1 text-[11px] text-neutral-500">Oceanic v{APP_VERSION}</p>
        </Popover>
      )}
    </div>
  );
}

function WorkspaceList({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onReorderWorkspaces,
  onDone,
}: SidebarFooterProps & { onDone: () => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = workspaces.map((w) => w.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId) + (workspaces.findIndex((w) => w.id === dragId) < workspaces.findIndex((w) => w.id === targetId) ? 1 : 0), 0, dragId);
    onReorderWorkspaces(ids);
  };

  const menu = (e: React.MouseEvent, ws: WorkspaceRecord) =>
    openContextMenu(e, [
      { label: "Rename & icon", icon: <PenLine className="size-4" />, onSelect: () => (onDone(), onEditWorkspace(ws.id)) },
      "divider",
      {
        label: "Delete workspace",
        icon: <Trash2 className="size-4" />,
        danger: true,
        disabled: workspaces.length <= 1,
        onSelect: () => (onDone(), onDeleteWorkspace(ws.id)),
      },
    ]);

  return (
    <>
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-neutral-500">Workspaces</p>
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          draggable
          onDragStart={(e) => {
            setDragGhost(e, ws.icon, ws.name);
            setDragId(ws.id);
          }}
          onDragEnd={() => (setDragId(null), setOver(null))}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            setOver(ws.id);
          }}
          onDrop={() => (drop(ws.id), setOver(null))}
          onContextMenu={(e) => menu(e, ws)}
          className={`group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-neutral-200 transition-colors duration-100 hover:bg-white/[0.06] ${
            over === ws.id && dragId !== ws.id ? "ring-1 ring-sky-500/60" : ""
          } ${dragId === ws.id ? "opacity-40" : ""}`}
          onClick={() => (onSelectWorkspace(ws.id), onDone())}
        >
          <WorkspaceIcon ws={ws} />
          <span className="flex-1 truncate">{ws.name}</span>
          <button
            type="button"
            title="Workspace options"
            onClick={(e) => (e.stopPropagation(), menu(e, ws))}
            className="grid size-5 place-items-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-neutral-200 group-hover:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {ws.id === activeWorkspaceId && <Check className="size-4 shrink-0 text-neutral-300" />}
        </div>
      ))}
      <div className="my-1 h-px bg-white/[0.06]" />
      <MenuRow icon={<Plus className="size-4" />} onClick={() => (onDone(), onNewWorkspace())}>
        New workspace
      </MenuRow>
    </>
  );
}

export function WorkspaceIcon({ ws }: { ws: Pick<WorkspaceRecord, "icon" | "color"> }) {
  return (
    <span
      className="grid size-[22px] shrink-0 place-items-center rounded-md text-[12px]"
      style={{ backgroundColor: colorOf(ws.color).bg }}
    >
      {ws.icon}
    </span>
  );
}

function MenuRow({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-neutral-300 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-100"
    >
      <span className="text-neutral-400">{icon}</span>
      {children}
    </button>
  );
}

/** Opens upward from a footer row, like Notion's account menu. */
function Popover({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // Clicks in a context menu opened from this popover don't close it.
      if ((t as Element).closest?.(".oc-context-menu")) return;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);
  const r = anchor.getBoundingClientRect();
  return createPortal(
    <div
      ref={ref}
      style={{ left: r.left, bottom: window.innerHeight - r.top + 6, width: Math.max(r.width, 240) }}
      className="oc-pop-in fixed z-50 origin-bottom-left rounded-lg border border-white/[0.08] bg-[var(--oc-surface)] p-1 shadow-xl shadow-black/50"
    >
      {children}
    </div>,
    document.body,
  );
}
