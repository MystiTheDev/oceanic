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
} from "lucide-react";
import { buildPageTree, subtreeIds, type PageMeta, type PageNode } from "../data/workspace";
import { SearchModal } from "./SearchModal";
import { PageMenu, type PageMenuAction } from "./PageMenu";
import { TrashPopover } from "./TrashPopover";
import { ViewSwitcher, type AppView } from "./ViewSwitcher";
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
/** On-screen width; contents render at 90% (zoom) so everything is a touch smaller. */
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
  onImport,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
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

  const runMenuAction = (action: PageMenuAction) => {
    if (!menu) return;
    const id = menu.pageId;
    if (action === "favorite") onTogglePin(id);
    else if (action === "rename") setRenamingKey(menu.anchor.dataset.rowKey ?? id);
    else if (action === "duplicate") onDuplicatePage(id);
    else if (action === "trash") onTrashPage(id);
  };

  const rowProps = {
    expanded,
    activePageId,
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
      style={{ width: SIDEBAR_WIDTH / 0.9, zoom: 0.9 }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), setFileOver(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFileOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setFileOver(false);
        onImport([...e.dataTransfer.files]);
      }}
      className="oc-sidebar relative z-10 my-2 ml-2 flex h-[calc(100%-16px)] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--oc-sidebar)] backdrop-blur"
    >
      {fileOver && (
        <div className="oc-fade-in pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-sky-400/70 bg-sky-500/10 text-[13px] font-medium text-sky-300">
          Drop to import notes
        </div>
      )}
      {/* ---- Workspace header ---- */}
      <div className="flex h-16 items-center gap-2.5 px-3 pt-2">
        <img src={logoRaw} alt="Oceanic logo" className="oc-brand-logo size-10 shrink-0 rounded-lg object-contain" />
        <div className="oc-brand-word flex-1 truncate text-[20px] font-extrabold tracking-[-0.02em]">Oceanic</div>
      </div>

      {/* ---- Search: Notion's bordered box with the shortcut badge ---- */}
      <div className="px-2.5 pb-2">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title="Search (Ctrl+K)"
          className="oc-search flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2.5 text-[14px] text-neutral-500 transition-colors duration-100 hover:bg-white/[0.06] hover:text-neutral-400"
        >
          <SearchIcon className="size-4 shrink-0 oc-ic-search" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 font-sans text-[11px] leading-none text-neutral-400">Ctrl+K</kbd>
        </button>
      </div>

      {/* ---- Home + Tags ---- */}
      <div className="flex flex-col gap-px px-2 pb-1">
        <button
          type="button"
          onClick={onHome}
          className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-100 ${
            homeActive ? "oc-nav-active text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
          }`}
        >
          <HomeIcon className="size-4 shrink-0 text-neutral-500 oc-ic-home" />
          <span className="flex-1 text-left">Home</span>
        </button>
        <button
          type="button"
          onClick={onLibrary}
          className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-100 ${
            libraryActive ? "oc-nav-active text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
          }`}
        >
          <LibraryIcon className="size-4 shrink-0 text-neutral-500 oc-ic-library" />
          <span className="flex-1 text-left">Library</span>
        </button>
        <button
          type="button"
          onClick={onOpenTags}
          className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-100 text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
        >
          <TagsIcon className="size-4 shrink-0 text-neutral-500 oc-ic-tags" />
          <span className="flex-1 text-left">Tags &amp; status</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            const el = e.currentTarget;
            setTrashAnchor((a) => (a ? null : el));
          }}
          className={`relative flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-100 ${
            trashAnchor
              ? "bg-white/[0.07] text-neutral-200"
              : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"
          }`}
        >
          <TrashIcon className="size-4 text-neutral-500 oc-ic-trash" />
          <span className="flex-1 text-left">Trash</span>
          {trashedPages.length > 0 && (
            <span className="oc-keep oc-badge text-[11px] text-neutral-500">{trashedPages.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onImport()}
          title="Markdown, Word, text, HTML or a Notion export (.zip). You can also drop files on the sidebar."
          className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-neutral-400 transition-colors duration-100 hover:bg-white/5 hover:text-neutral-300"
        >
          <ImportIcon className="size-4 text-neutral-500 oc-ic-import" />
          <span className="flex-1 text-left">Import</span>
        </button>
      </div>

      <div className="oc-rail-hide">
        <ViewSwitcher view={view} onChange={onChangeView} />
      </div>

      {/* ---- Scrollable body: Favorites + Private page tree ---- */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        <>
            <SectionHeader
              label="Favorites"
              count={pinned.length}
              open={favoritesOpen}
              onToggle={() => setFavoritesOpen((v) => !v)}
            />
            <Collapse open={favoritesOpen}>
              {pinned.length === 0 && (
                <p className="px-2 py-1 text-[12px] leading-snug text-neutral-600">
                  No favorites yet. Use ⋯ → Add to Favorites to pin a page here.
                </p>
              )}
              {pinned.map((page) => (
                <PageTreeRow
                  key={`fav-${page.id}`}
                  node={{ page, children: [] }}
                  {...rowProps}
                  expandKey={`fav-${page.id}`}
                />
              ))}
            </Collapse>
        </>

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

      {/* ---- Bottom: Trash + New page ---- */}
      <div className="flex flex-col gap-px p-2">
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
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
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
      className={`group mt-4 flex h-[30px] items-center rounded-lg px-2 transition-colors duration-100 ${
        dropActive ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/60" : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-500 transition-colors duration-100 group-hover:text-neutral-400"
      >
        {label}
        {count !== undefined && (
          <span className="font-normal text-neutral-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100">· {count}</span>
        )}
        <ChevronRight
          className={`size-3 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 ${
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
};

function PageTreeRow(props: PageTreeRowProps) {
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
  } = props;
  const { page } = node;
  const children = node.children;
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(expandKey);
  const active = activePageId === page.id;
  const renaming = renamingKey === expandKey;
  const menuOpen = menuPageId === page.id;
  // Only the Private tree reorders; Favorites rows are shortcuts.
  const dnd = !expandKey.startsWith("fav-") && !renaming;
  const dropZone = dnd && drop?.targetId === page.id ? drop.zone : null;

  return (
    <>
      <div
        onClick={() => !renaming && onOpenPage(page.id)}
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
        className={`oc-row group relative flex h-[34px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[14px] transition-colors duration-100 ${
          dropZone === "inside"
            ? "bg-sky-500/15 text-neutral-100 ring-1 ring-inset ring-sky-500/60"
            : active
              ? "oc-nav-active font-medium text-neutral-100"
              : menuOpen
                ? "bg-white/5 text-neutral-300"
                : "text-neutral-300 hover:bg-white/5"
        } ${dragId === page.id ? "opacity-40 transition-opacity" : ""}`}
      >
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
            className={`leading-none transition-opacity duration-150 ${
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
                className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
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
        {/* Collapsed parents show how many sub-pages they hold (hidden while hovering). */}
        {!renaming && hasChildren && !isOpen && (
          <span className="shrink-0 pr-1 text-[11px] tabular-nums text-neutral-600 group-hover:opacity-0">{children.length}</span>
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
          <div className="ml-[17px] border-l border-white/[0.07] pl-1">
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
      className="oc-fade-in h-[22px] min-w-0 flex-1 rounded border border-sky-500/60 bg-neutral-800 px-1.5 text-[14px] text-neutral-100 outline-none"
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
