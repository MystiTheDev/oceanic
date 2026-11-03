import type { ReactNode } from "react";
import { ExternalLink, House, Plus, Trash2 } from "lucide-react";
import { openContextMenu } from "../components/ContextMenu";
import { askDeleteMindmap } from "./MindmapGallery";
import type { MindmapRecord } from "../data/api";
import { subjectOf } from "./model";
import mindmapLogo from "../assets/mindmap-logo.png";

type Props = {
  maps: MindmapRecord[];
  /** Open map id, or null on the gallery. */
  activeId: string | null;
  onOpen: (id: string) => void;
  onGallery: () => void;
  onOpenNewTab: (id: string) => void;
  onNew: () => void;
  footer: ReactNode;
};

const ROW = "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-[14px] transition-colors duration-100";

/** The sidebar while Oceanic Mindmap is open: its own header and map list. */
export function MindmapSidebar({ maps, activeId, onOpen, onGallery, onOpenNewTab, onNew,  footer }: Props) {
  return (
    <aside className="oc-fade-in flex h-full w-[264px] shrink-0 flex-col overflow-hidden rounded-r-2xl border-r border-white/[0.06] bg-[var(--oc-sidebar)] backdrop-blur">
      <div className="flex h-16 items-center gap-2.5 px-3 pt-2">
        <img src={mindmapLogo} alt="Oceanic Mindmap logo" className="oc-brand-logo size-9 shrink-0 object-contain" />
        <div className="oc-mm-word min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-[-0.02em]">Oceanic Mindmap</div>
      </div>

      <div className="flex flex-col gap-px px-2 pb-1">
        <button
          type="button"
          onClick={onGallery}
          className={`${ROW} ${activeId === null ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"}`}
        >
          <House className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">Home</span>
        </button>
        <button type="button" onClick={onNew} className={`${ROW} text-neutral-400 hover:bg-white/5 hover:text-neutral-300`}>
          <Plus className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">New mindmap</span>
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        <p className="mt-4 px-2 pb-1 text-[12px] font-semibold text-neutral-500">Maps</p>
        {maps.length === 0 && <p className="px-2 py-1 text-[13px] text-neutral-600">No mindmaps yet</p>}
        {maps.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpen(m.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openContextMenu(e, [
                { label: "Open", onSelect: () => onOpen(m.id) },
                { label: "Open in new tab", icon: <ExternalLink className="size-4" />, onSelect: () => onOpenNewTab(m.id) },
                "divider",
                { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => askDeleteMindmap(m) },
              ]);
            }}
            className={`${ROW} ${m.id === activeId ? "bg-white/10 font-medium text-neutral-100" : "text-neutral-300 hover:bg-white/5"}`}
          >
            <span className="w-5 shrink-0 text-center leading-none">{subjectOf(m.subjectTag).icon}</span>
            <span className="min-w-0 flex-1 truncate text-left">{m.title}</span>
          </button>
        ))}
      </div>

      {footer}
    </aside>
  );
}
