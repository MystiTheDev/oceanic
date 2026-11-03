import { useState, type ReactNode } from "react";
import { Copy, ExternalLink, FileText, FolderOpen, House, Pencil, Plus, Trash2 } from "lucide-react";
import { openContextMenu } from "../components/ContextMenu";
import { requestDelete } from "../lib/confirmDelete";
import docsLogo from "../assets/docs-logo.png";
import { docTitle, duplicateDoc, newUntitled, refreshFiles, renameDoc, replaceRecent, revealDoc, trashDoc, useDocs } from "./store";

const ROW = "flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] transition-colors duration-100";

/** The sidebar while Oceanic Docs is open: its Home, new doc, and the folder's files. */
export function DocsSidebar({
  activePath,
  onOpen,
  onHome,
  onOpenNewTab,
  onRenamed,
  onDeleted,
  footer,
}: {
  onOpenNewTab: (p: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (p: string) => void;
  activePath: string | null;
  onOpen: (p: string) => void;
  onHome: () => void;
  footer: ReactNode;
}) {
  const { files } = useDocs();
  const [renaming, setRenaming] = useState<string | null>(null);
  const commitRename = async (path: string, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === docTitle(path)) return;
    try {
      const to = await renameDoc(path, name);
      replaceRecent(path, to);
      onRenamed(path, to);
      void refreshFiles();
    } catch (e) {
      alert(String(e));
    }
  };
  const menu = (e: React.MouseEvent, path: string) =>
    openContextMenu(e, [
      { label: "Open in new tab", icon: <ExternalLink className="size-4" />, onSelect: () => onOpenNewTab(path) },
      { label: "Rename", icon: <Pencil className="size-4" />, onSelect: () => setRenaming(path) },
      {
        label: "Duplicate",
        icon: <Copy className="size-4" />,
        onSelect: async () => {
          await duplicateDoc(path);
          void refreshFiles();
        },
      },
      { label: "Show in File Explorer", icon: <FolderOpen className="size-4" />, onSelect: () => void revealDoc(path) },
      "divider",
      {
        label: "Delete",
        icon: <Trash2 className="size-4" />,
        danger: true,
        onSelect: () =>
          requestDelete({
            app: "docs",
            kind: "recycle",
            title: docTitle(path),
            entry: `doc:${path}`,
            run: async () => {
              await trashDoc(path);
              replaceRecent(path, null);
              onDeleted(path);
              void refreshFiles();
            },
          }),
      },
    ]);
  return (
    <aside className="oc-fade-in flex h-full w-[264px] shrink-0 flex-col overflow-hidden rounded-r-2xl border-r border-white/[0.06] bg-[var(--oc-sidebar)] backdrop-blur">
      <div className="flex h-16 items-center gap-2.5 px-3 pt-2">
        <img src={docsLogo} alt="Oceanic Docs logo" className="size-9 shrink-0" />
        <div className="oc-docs-word min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-[-0.02em]">Oceanic Docs</div>
      </div>
      <div className="flex flex-col gap-px px-2 pb-1">
        <button
          type="button"
          onClick={onHome}
          className={`${ROW} ${activePath === null ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"}`}
        >
          <House className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">Home</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen(newUntitled())}
          className={`${ROW} text-neutral-400 hover:bg-white/5 hover:text-neutral-300`}
        >
          <Plus className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">New document</span>
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        <p className="mt-4 px-2 pb-1 text-[12px] font-semibold text-neutral-500">Documents</p>
        {!files.length && <p className="px-2 py-1 text-[13px] text-neutral-600">No documents yet</p>}
        {files.map((f) =>
          renaming === f.path ? (
            <input
              key={f.path}
              autoFocus
              defaultValue={docTitle(f.path)}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => void commitRename(f.path, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="h-[30px] w-full rounded-md border border-[color:var(--oc-docs)] bg-neutral-800 px-2 text-[14px] text-neutral-100 outline-none"
            />
          ) : (
          <button
            onContextMenu={(e) => menu(e, f.path)}
            onDoubleClick={() => setRenaming(f.path)}
            key={f.path}
            type="button"
            onClick={() => onOpen(f.path)}
            className={`${ROW} ${f.path === activePath ? "bg-white/10 font-medium text-neutral-100" : "text-neutral-300 hover:bg-white/5"}`}
          >
            <FileText className="size-4 shrink-0 text-[color:var(--oc-docs)]" />
            <span className="min-w-0 flex-1 truncate text-left">{docTitle(f.path)}</span>
          </button>
          ),
        )}
      </div>
      {footer}
    </aside>
  );
}
