import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { HomeIcon, ImportIcon, LibraryIcon, SearchIcon, TagsIcon, TrashIcon } from "./SidebarIcons";
import {
  AppWindow,
  FolderInput,
  ChevronRight,
  Copy,
  MoreHorizontal,
  PenLine,
  Plus,
  Star,
  Trash2,
  AlarmClock,
} from "lucide-react";
import { motion } from "motion/react";
import { buildPageTree, subtreeIds, type PageMeta, type PageNode } from "../data/workspace";
import { SearchModal } from "./SearchModal";
import { PageMenu, type PageMenuAction } from "./PageMenu";
import { VersionHistory } from "./VersionHistory";
import { TrashPopover } from "./TrashPopover";
import { ViewSwitcher, VIEWS, type AppView } from "./ViewSwitcher";
import type { WorkspaceRecord } from "../data/api";
import { openContextMenu } from "./ContextMenu";
import { flashLanded, setDragGhost } from "../lib/dragGhost";
import logoRaw from "../assets/logo-raw.png";

type SidebarProps = {
  /** Live pages of the active workspace. */
  pages: PageMeta[];
  /** Live pages of every workspace (search spans them all). */
  allPages: PageMeta[];
  view: AppView;
  onChangeView: (view: AppView) => void;
  workspaces: WorkspaceRecord[];
  onMoveToWorkspace: (pageId: string, workspaceId: string) => void;
  footer: ReactNode;
  homeActive: boolean;
  onHome: () => void;
  libraryActive: boolean;
  onLibrary: () => void;
  onOpenTags: () => void;
  onOpenTimers: () => void;
  /** Import notes: the picker (no files) or files dropped on the sidebar. */
  onImport: (files?: File[]) => void;
  trashedPages: PageMeta[];
  activePageId: string | null;
  onOpenPage: (id: string) => void;
  onTogglePin: (id: string) => void;
  onCreatePage: (parentId: string | null) => void;
  onRenamePage: (id: string, title: string) => void;
  onDuplicatePage: (id: string) => void;
  onTrashPage: (id: string) => void;
  onRestorePage: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onRestoreAll: () => void;
  onEmptyTrash: () => void;
  onMovePage: (id: string, parentId: string | null, position: number) => void;
  onOpenInNewTab: (id: string) => void;
};

/** Where a dragged page would land: above / below a row, inside it, or at the top level. */
type DropZone = "before" | "after" | "inside";
type DropTarget = { targetId: string | null; zone: DropZone };

/** Fired on window to open the search palette from elsewhere (e.g. right-click menu). */
/** Notion's sidebar bounds. */
/** Sidebar width (px), real size. */
const SIDEBAR_WIDTH = 264;

export const OPEN_SEARCH_EVENT = "oceanic:open-search";

/** How long hovering a collapsed page waits before expanding it, like Notion. */
const AUTO_EXPAND_MS = 500;

export function Sidebar({
  pages,
  trashedPages,
  activePageId,
  onOpenPage,
  onTogglePin,
  onCreatePage,
  onRenamePage,
  onDuplicatePage,
  onTrashPage,
  onRestorePage,
  onDeleteForever,
  onRestoreAll,
  onEmptyTrash,
  onMovePage,
  onOpenInNewTab,
  allPages,
  view,
  onChangeView,
  workspaces,
  onMoveToWorkspace,
  footer,
  homeActive,
  onHome,
  libraryActive,
  onLibrary,
  onOpenTags,
  onOpenTimers,
  onImport,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  // Which row (tree or Favorites) was clicked, so only that copy shows as active.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [privateOpen, setPrivateOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["roadmap"]));
  const [menu, setMenu] = useState<{ pageId: string; anchor: HTMLElement } | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [trashAnchor, setTrashAnchor] = useState<HTMLElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);

  const pageTree = buildPageTree(pages);
  const pinned = pages.filter((p) => p.pinned);
  const menuPage = menu ? pages.find((p) => p.id === menu.pageId) : undefined;

  // Ctrl+K lives in App's universal keys, which send this event in Notes.
  useEffect(() => {
    const onOpenSearch = () => setSearchOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
  }, []);

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ---------------------------------------------------------- drag & drop */
  // The dragged page and everything under it can't be drop targets.
  const blocked = dragId ? subtreeIds(pages, dragId) : new Set<string>();

  const clearExpandTimer = () => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };

  const endDrag = () => {
    clearExpandTimer();
    setDragId(null);
    setDrop(null);
  };

  const dragOverRow = (e: DragEvent, page: PageMeta, hasChildren: boolean, isOpen: boolean) => {
    if (!dragId || blocked.has(page.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone: DropZone = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
    if (drop?.targetId !== page.id || drop.zone !== zone) setDrop({ targetId: page.id, zone });

    // Hovering the middle of a collapsed parent opens it after a beat.
    if (zone === "inside" && hasChildren && !isOpen) {
      if (expandTimer.current?.id !== page.id) {
        clearExpandTimer();
        expandTimer.current = {
          id: page.id,
          timer: window.setTimeout(() => {
            setExpanded((prev) => new Set(prev).add(page.id));
            expandTimer.current = null;
          }, AUTO_EXPAND_MS),
        };
      }
    } else if (expandTimer.current?.id === page.id) {
      clearExpandTimer();
    }
  };

  const dropOnTarget = () => {
    if (!dragId || !drop) return endDrag();
    flashLanded(`aside [data-row-id="${dragId}"]`);
    if (drop.targetId === null) {
      // Top level, appended after the last root page.
      const roots = pages.filter((p) => p.parentId === null && p.id !== dragId);
      onMovePage(dragId, null, roots.length);
    } else {
      const target = pages.find((p) => p.id === drop.targetId);
      if (target && drop.zone === "inside") {
        const children = pages.filter((p) => p.parentId === target.id && p.id !== dragId);
        onMovePage(dragId, target.id, children.length);
        setExpanded((prev) => new Set(prev).add(target.id));
      } else if (target) {
        const siblings = pages.filter((p) => p.parentId === target.parentId && p.id !== dragId);
        const idx = siblings.findIndex((p) => p.id === target.id);
        onMovePage(dragId, target.parentId, drop.zone === "before" ? idx : idx + 1);
      }
    }
    endDrag();
  };

  const [historyId, setHistoryId] = useState<string | null>(null);
  const runMenuAction = (action: PageMenuAction) => {
    if (!menu) return;
    const id = menu.pageId;
    if (action === "favorite") onTogglePin(id);
    else if (action === "rename") setRenamingKey(menu.anchor.dataset.rowKey ?? id);
    else if (action === "duplicate") onDuplicatePage(id);
    else if (action === "trash") onTrashPage(id);
    else if (action === "history") setHistoryId(id);
  };

  const rowProps = {
    expanded,
    activePageId,
    activeKey,
    onActivateKey: setActiveKey,
    renamingKey,
    menuPageId: menu?.pageId ?? null,
    onToggleExpanded: toggleExpanded,
    onOpenPage,
    onTogglePin,
    onCreatePage,
    onOpenMenu: (pageId: string, anchor: HTMLElement) =>
      setMenu((m) => (m?.anchor === anchor ? null : { pageId, anchor })),
    onRename: (id: string, title: string) => onRenamePage(id, title),
    onEndRename: () => setRenamingKey(null),
    dragId,
    drop,
    onDragStartRow: (id: string) => setDragId(id),
    onDragOverRow: dragOverRow,
    onDropRow: dropOnTarget,
    onDragEndRow: endDrag,
    onRowContextMenu: (e: MouseEvent, page: PageMeta, rowKey: string) =>
      openContextMenu(e, [
        {
          label: "Open in new tab",
          icon: <AppWindow className="size-4" />,
          onSelect: () => onOpenInNewTab(page.id),
        },
        "divider",
        {
          label: page.pinned ? "Remove from Favorites" : "Add to Favorites",
          icon: <Star className="size-4" />,
          onSelect: () => onTogglePin(page.id),
        },
        { label: "Rename", icon: <PenLine className="size-4" />, onSelect: () => setRenamingKey(rowKey) },
        { label: "Duplicate", icon: <Copy className="size-4" />, onSelect: () => onDuplicatePage(page.id) },
        {
          label: "Move to",
          icon: <FolderInput className="size-4" />,
          disabled: workspaces.length < 2,
          children: workspaces
            .filter((w) => w.id !== page.workspaceId)
            .map((w) => ({
              label: w.name,
              icon: <span className="w-4 text-center text-[14px]">{w.icon}</span>,
              onSelect: () => onMoveToWorkspace(page.id, w.id),
            })),
        },
        {
          label: "Add a sub-page",
          icon: <Plus className="size-4" />,
          onSelect: () => {
            setExpanded((prev) => new Set(prev).add(rowKey));
            onCreatePage(page.id);
          },
        },
        "divider",
        {
          label: "Move to Trash",
          icon: <Trash2 className="size-4" />,
          danger: true,
          onSelect: () => onTrashPage(page.id),
        },
      ]),
  };

  return (
    <aside
      style={{ width: SIDEBAR_WIDTH }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), setFileOver(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFileOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setFileOver(false);
        const files = [...e.dataTransfer.files];
        // Images embed into the open page (ignored if none); never become notes.
        const images = files.filter((f) => f.type.startsWith("image/"));
        if (images.length) window.dispatchEvent(new CustomEvent("oc-insert-images", { detail: images }));
        const rest = files.filter((f) => !images.includes(f));
        if (rest.length) onImport(rest);
      }}
      data-tour="sidebar"
      onClickCapture={(e) => {
        // Replay the clicked item's icon animation (CSS: .oc-clicked).
        const el = (e.target as HTMLElement).closest<HTMLElement>("button, .oc-row");
        if (!el) return;
        el.classList.remove("oc-clicked");
        void el.offsetWidth;
        el.classList.add("oc-clicked");
        window.setTimeout(() => el.classList.remove("oc-clicked"), 700);
      }}
      className="oc-sidebar relative z-10 my-2 ml-2 flex h-[calc(100%-16px)] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[var(--oc-sidebar)] backdrop-blur"
    >
      {fileOver && (
        <div className="oc-fade-in pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-sky-400/70 bg-sky-500/10 text-[13px] font-medium text-[var(--oc-brand-light)]">
          Drop to import notes
        </div>
      )}
      {/* ---- Workspace header ---- */}
      <div className="flex h-14 items-center gap-2.5 px-3 pt-1.5">
        <img src={logoRaw} alt="Oceanic logo" className="oc-brand-logo size-9 shrink-0 rounded-lg object-contain" />
        <div className="oc-brand-word flex-1 truncate text-[20px] font-extrabold tracking-[-0.02em]">Oceanic</div>
      </div>

      {/* ---- Search field ---- */}
      <div className="px-2 pb-2 pt-1">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title="Search (Ctrl+K)"
          data-rail-search
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.03] px-2.5 text-[13.5px] text-neutral-500 transition-[border-color,box-shadow,background-color] duration-150 hover:border-white/[0.16] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-brand-light)]/40"
        >
          <SearchIcon className="size-4 shrink-0 oc-ic-search" />
          <span className="flex-1 truncate text-left">Search or jump to…</span>
          <kbd className="oc-keep shrink-0 rounded border border-white/[0.1] px-1.5 py-px font-sans text-[10.5px] leading-4 text-neutral-500">Ctrl K</kbd>
        </button>
      </div>

      {/* ---- Top nav ---- */}
      <div className="flex flex-col gap-px px-2 pb-1">
        <NavRow icon={<HomeIcon className="size-4 oc-ic-home" />} label="Home" active={homeActive} onClick={onHome} />
        <NavRow icon={<LibraryIcon className="size-4 oc-ic-library" />} label="Library" active={libraryActive} onClick={onLibrary} />
        <NavRow icon={<TagsIcon className="size-4 oc-ic-tags" />} label="Tags & status" onClick={onOpenTags} />
        <NavRow icon={<AlarmClock className="size-4 oc-ic-timer" />} label="Timers" onClick={onOpenTimers} />
      </div>

      <div className="oc-rail-hide">
        <ViewSwitcher view={view} onChange={onChangeView} />
      </div>

      {/* ---- Collapsed rail only: new page, views, favorites ---- */}
      <div className="oc-rail-only hidden flex-col gap-px px-2 pb-1">
        <RailBtn title="New page (Ctrl+N)" onClick={() => onCreatePage(null)}><Plus className="size-4" /></RailBtn>
        <div className="mx-2 my-1 border-t border-white/[0.06]" />
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <RailBtn key={id} title={label} active={view === id} onClick={() => onChangeView(id)}><Icon className="size-4" /></RailBtn>
        ))}
        {pinned.length > 0 && <div className="mx-2 my-1 border-t border-white/[0.06]" />}
        {pinned.slice(0, 8).map((p) => (
          <RailBtn key={p.id} title={p.title || "Untitled"} active={p.id === activePageId} onClick={() => onOpenPage(p.id)}>
            <span className="oc-keep text-[15px] leading-none">{p.icon || (p.title || "U")[0].toUpperCase()}</span>
          </RailBtn>
        ))}
      </div>

      {/* ---- Scrollable body: Favorites + Private page tree ---- */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && <>
            <SectionHeader
              label="Favorites"
              count={pinned.length}
              open={favoritesOpen}
              onToggle={() => setFavoritesOpen((v) => !v)}
            />
            <Collapse open={favoritesOpen}>
              {pinned.map((page) => (
                <PageTreeRow
                  key={`fav-${page.id}`}
                  node={{ page, children: [] }}
                  {...rowProps}
                  expandKey={`fav-${page.id}`}
                />
              ))}
            </Collapse>
        </>}

        <SectionHeader
          label="Pages"
          count={pages.length}
          open={privateOpen}
          onToggle={() => setPrivateOpen((v) => !v)}
          onAdd={() => onCreatePage(null)}
          dropActive={drop?.targetId === null}
          onDragOver={
            dragId
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (drop?.targetId !== null) setDrop({ targetId: null, zone: "inside" });
                }
              : undefined
          }
          onDrop={dropOnTarget}
        />
        <Collapse open={privateOpen}>
          {pageTree.map((node) => (
            <PageTreeRow key={node.page.id} node={node} {...rowProps} />
          ))}
        </Collapse>
      </div>

      {/* ---- Bottom: Trash + Import, like Notion; divider below, then More apps ---- */}
      <div className="mx-2 mt-1 mb-1 flex flex-col gap-px border-b border-white/[0.06] pb-1.5">
        <NavRow
          icon={<TrashIcon className="size-4 oc-ic-trash" />}
          label="Trash"
          open={!!trashAnchor}
          onClick={(e) => {
            const el = e.currentTarget as HTMLElement;
            setTrashAnchor((a) => (a ? null : el));
          }}
        >
          {trashedPages.length > 0 && <span className="oc-keep oc-badge rounded-full bg-white/[0.08] px-1.5 text-[11px] leading-[18px] tabular-nums text-neutral-400">{trashedPages.length}</span>}
        </NavRow>
        <NavRow
          icon={<ImportIcon className="size-4 oc-ic-import" />}
          label={fileOver ? "Drop to import" : "Import"}
          glow={fileOver}
          title="Markdown, Word, text, HTML or a Notion export (.zip). You can also drop files on the sidebar."
          onClick={() => onImport()}
        />
      </div>

      {footer}

      {searchOpen && (
        <SearchModal
          pages={allPages}
          workspaces={workspaces}
          onOpenPage={onOpenPage}
          onOpenInNewTab={onOpenInNewTab}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {historyId && <VersionHistory pageId={historyId} onClose={() => setHistoryId(null)} />}
      {menu && menuPage && (
        <PageMenu
          anchor={menu.anchor}
          pinned={menuPage.pinned}
          onAction={runMenuAction}
          onClose={() => setMenu(null)}
        />
      )}
      {trashAnchor && (
        <TrashPopover
          anchor={trashAnchor}
          pages={trashedPages}
          onRestore={onRestorePage}
          onDeleteForever={onDeleteForever}
          onRestoreAll={onRestoreAll}
          onEmptyTrash={onEmptyTrash}
          onClose={() => setTrashAnchor(null)}
        />
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- Collapse */
/** Height animation via the grid 0fr → 1fr trick; children stay mounted. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? "oc-col-open grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Section header */
function SectionHeader({
  label,
  open,
  onToggle,
  onAdd,
  count,
  dropActive,
  onDragOver,
  onDrop,
}: {
  label: string;
  /** Shown beside the label on hover. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  /** Highlighted while a dragged page would move to the top level. */
  dropActive?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
}) {
  // Notion: sentence-case muted label; the caret and "+" appear only on hover.
  return (
    <div
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      className={`group mt-3 flex h-7 items-center rounded-md px-2 transition-colors duration-100 ${
        dropActive ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/60" : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-[12px] font-medium text-neutral-500 transition-colors duration-100 group-hover:text-neutral-400"
      >
        {label}
        {count !== undefined && (
          <span className="font-normal text-neutral-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100">· {count}</span>
        )}
        <ChevronRight
          className={`oc-ic-chev size-3 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {onAdd && (
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <HoverAction title="New page (Ctrl+N)" onClick={onAdd}>
            <Plus className="size-3.5" />
          </HoverAction>
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Tree row */
type PageTreeRowProps = {
  node: PageNode;
  expanded: Set<string>;
  activePageId: string | null;
  renamingKey: string | null;
  menuPageId: string | null;
  onToggleExpanded: (id: string) => void;
  onOpenPage: (id: string) => void;
  onTogglePin: (id: string) => void;
  onCreatePage: (parentId: string | null) => void;
  onOpenMenu: (pageId: string, anchor: HTMLElement) => void;
  onRename: (id: string, title: string) => void;
  onEndRename: () => void;
  dragId: string | null;
  drop: DropTarget | null;
  onDragStartRow: (id: string) => void;
  onDragOverRow: (e: DragEvent, page: PageMeta, hasChildren: boolean, isOpen: boolean) => void;
  onDropRow: () => void;
  onDragEndRow: () => void;
  onRowContextMenu: (e: MouseEvent, page: PageMeta, rowKey: string) => void;
  /** Favorites mirror tree rows; give them their own expand/rename state. */
  expandKey?: string;
  /** Row key last clicked; picks which copy of a favourited page is highlighted. */
  activeKey: string | null;
  onActivateKey: (key: string) => void;
};

/** Pages seen since launch; a row for an unseen page pops in (after the first second, so startup does not animate). */
const seenPages = new Set<string>();
let sidebarBooted = false;
if (typeof window !== "undefined") window.setTimeout(() => (sidebarBooted = true), 1500);

function PageTreeRow(props: PageTreeRowProps) {
  const [isNew] = useState(() => {
    const n = sidebarBooted && !seenPages.has(props.node.page.id);
    seenPages.add(props.node.page.id);
    return n;
  });
  const {
    node,
    expanded,
    activePageId,
    renamingKey,
    menuPageId,
    onToggleExpanded,
    onOpenPage,
    onCreatePage,
    onOpenMenu,
    onRename,
    onEndRename,
    dragId,
    drop,
    onDragStartRow,
    onDragOverRow,
    onDropRow,
    onDragEndRow,
    onRowContextMenu,
    expandKey = node.page.id,
    activeKey,
    onActivateKey,
  } = props;
  const { page } = node;
  const children = node.children;
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(expandKey);
  const isFav = expandKey.startsWith("fav-");
  // A favourited page shows in both lists: highlight the copy that was clicked,
  // or the tree row when the page was opened from somewhere else.
  const active =
    activePageId === page.id && (activeKey === expandKey || (!isFav && activeKey !== `fav-${page.id}`));
  const renaming = renamingKey === expandKey;
  const menuOpen = menuPageId === page.id;
  // Only the Private tree reorders; Favorites rows are shortcuts.
  const dnd = !expandKey.startsWith("fav-") && !renaming;
  const dropZone = dnd && drop?.targetId === page.id ? drop.zone : null;

  return (
    <>
      <div
        onClick={() => !renaming && (onActivateKey(expandKey), onOpenPage(page.id))}
        draggable={dnd}
        data-row-id={page.id}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", page.id);
          setDragGhost(e, page.icon, page.title);
          onDragStartRow(page.id);
        }}
        onDragOver={dnd ? (e) => onDragOverRow(e, page, hasChildren, isOpen) : undefined}
        onDrop={(e) => {
          e.preventDefault();
          onDropRow();
        }}
        onDragEnd={onDragEndRow}
        onContextMenu={(e) => !renaming && onRowContextMenu(e, page, expandKey)}
        className={`oc-row ${isNew ? "oc-row-new" : ""} group relative isolate flex h-7 pointer-coarse:h-[34px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-[14px] transition-colors duration-100 ${
          dropZone === "inside"
            ? "bg-sky-500/15 text-neutral-100 ring-1 ring-inset ring-sky-500/60"
            : active
              ? "oc-nav-active font-medium text-neutral-100"
              : menuOpen
                ? "bg-white/5 text-neutral-300"
                : "text-neutral-300 hover:bg-white/5"
        } ${dragId === page.id ? "opacity-40 transition-opacity" : ""}`}
      >
        {active && <motion.span layoutId="oc-nav-hl" className="oc-nav-hl pointer-events-none absolute inset-0 -z-10 rounded-md" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
        {/* Notion's blue insertion line for "drop above / below" */}
        {(dropZone === "before" || dropZone === "after") && (
          <span
            className={`oc-drop-line pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-sky-500 ${
              dropZone === "before" ? "-top-px" : "-bottom-px"
            }`}
          />
        )}
        {/* Icon slot: on hover the page icon swaps to the expand chevron */}
        <span className="relative grid size-5 shrink-0 place-items-center">
          <span
            className={`oc-page-ico oc-ic-page inline-block leading-none transition-opacity duration-150 ${
              hasChildren ? "group-hover:opacity-0" : ""
            }`}
          >
            {page.icon}
          </span>
          {hasChildren && (
            <button
              type="button"
              title={isOpen ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(expandKey);
              }}
              className="absolute inset-0 grid cursor-pointer place-items-center rounded text-neutral-400 opacity-0 transition-opacity duration-150 hover:bg-white/10 group-hover:opacity-100"
            >
              <ChevronRight
                className={`oc-ic-chev size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
              />
            </button>
          )}
        </span>

        {renaming ? (
          <RenameInput
            initial={page.title}
            onCommit={(title) => {
              onRename(page.id, title);
              onEndRename();
            }}
            onCancel={onEndRename}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate group-focus-within:pr-[44px] group-hover:pr-[44px]">
            {page.title || "Untitled"}
          </span>
        )}

        {/* Hover actions, pinned to the row's right edge */}
        {!renaming && (
          <span
            className={`absolute right-1 flex items-center gap-0.5 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 ${
              menuOpen ? "opacity-100" : "opacity-0"
            }`}
          >
            <HoverAction
              title="Delete, duplicate, and more…"
              rowKey={expandKey}
              onClick={(e) => {
                e.stopPropagation();
                onOpenMenu(page.id, e.currentTarget as HTMLElement);
              }}
            >
              <MoreHorizontal className="size-3.5" />
            </HoverAction>
            <HoverAction
              title="Add a sub-page"
              onClick={(e) => {
                e.stopPropagation();
                if (!isOpen) onToggleExpanded(expandKey);
                onCreatePage(page.id);
              }}
            >
              <Plus className="size-3.5" />
            </HoverAction>
          </span>
        )}
      </div>

      {/* Sub-tree: indented one step, hairline guide under the icon, animated open */}
      {hasChildren && (
        <Collapse open={isOpen}>
          <div className="ml-[17px] border-l border-white/[0.1] pl-1">
            {children.map((child) => (
              <PageTreeRow
                key={child.page.id}
                {...props}
                node={child}
                expandKey={expandKey === page.id ? child.page.id : `${expandKey}/${child.page.id}`}
              />
            ))}
          </div>
        </Collapse>
      )}
    </>
  );
}

/** Inline title editor: Enter / blur saves, Escape cancels. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value.trim() || "Untitled");
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className="oc-fade-in h-[22px] min-w-0 flex-1 rounded border border-sky-500/60 bg-[var(--oc-sidebar)] px-1.5 text-[14px] text-neutral-100 outline-none"
    />
  );
}

function HoverAction({
  title,
  onClick,
  rowKey,
  children,
}: {
  title: string;
  onClick?: (e: MouseEvent) => void;
  /** Lets the ⋯ menu know which row (tree vs. Favorites) to rename. */
  rowKey?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-row-key={rowKey}
      className="grid size-5 cursor-pointer place-items-center rounded text-neutral-500 transition-colors duration-100 hover:bg-white/10 hover:text-neutral-200"
    >
      {children}
    </button>
  );
}

/** Icon-only button for the collapsed rail; App turns `title` into the hover tip. */
function RailBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`grid h-8 w-full cursor-pointer place-items-center rounded-md transition-colors duration-100 ${active ? "bg-white/[0.08] text-[var(--oc-brand-light)]" : "text-neutral-500 hover:bg-white/5 hover:text-neutral-300"}`}>
      {children}
    </button>
  );
}

/** Notion-style nav row: mono icon, 28px (34px on touch), gray hover. */
function NavRow({ icon, label, title, active, open, glow, onClick, children }: {
  icon: ReactNode; label: string; title?: string; active?: boolean; open?: boolean; glow?: boolean;
  onClick: (e: MouseEvent) => void; children?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`group relative isolate flex h-7 pointer-coarse:h-[34px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] transition-colors duration-100 ${
        glow ? "oc-drop-glow text-neutral-100" : active ? "oc-nav-active font-medium text-neutral-100" : open ? "bg-white/[0.07] text-neutral-200" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
      }`}
    >
      {active && <motion.span layoutId="oc-nav-hl" className="oc-nav-hl pointer-events-none absolute inset-0 -z-10 rounded-md" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
      <span className="grid size-5 shrink-0 place-items-center text-neutral-500">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {children}
    </button>
  );
}
