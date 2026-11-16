import type { ReactNode } from "react";
import type { PartialBlock } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";
import { Copy, Lightbulb, Palette, Trash2 } from "lucide-react";
import { HEADINGS_TO_ATLAS } from "./PromoteDialog";

/** Menu label with a leading icon. */
function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="oc-menu-label">
      <span className="oc-menu-icon">{icon}</span>
      {children}
    </span>
  );
}

/** Copy of a block (and its children) without ids, so BlockNote assigns new ones. */
function withoutIds(block: PartialBlock): PartialBlock {
  const { id: _id, children, ...rest } = block as PartialBlock & { id?: string };
  return { ...rest, children: children?.map(withoutIds) } as PartialBlock;
}

function DuplicateBlockItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => editor.insertBlocks([withoutIds(block as PartialBlock)], block, "after")}
    >
      <Label icon={<Copy className="size-4" />}>
        Duplicate
      </Label>
    </Components.Generic.Menu.Item>
  );
}

/** Headings only: open "Send to Atlas" with this heading ticked. */
function AtlasItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (block?.type !== "heading") return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => window.dispatchEvent(new CustomEvent(HEADINGS_TO_ATLAS, { detail: { blockId: block.id } }))}
    >
      <Label icon={<Lightbulb className="size-4" />}>Make Atlas concept</Label>
    </Components.Generic.Menu.Item>
  );
}

/** Notion's block (⋮⋮) menu: Duplicate, Delete, then Color — each with an icon. */
export function BlockHandleMenu() {
  return (
    <DragHandleMenu>
      <DuplicateBlockItem />
      <AtlasItem />
      <RemoveBlockItem>
        <Label icon={<Trash2 className="size-4" />}>
          Delete
        </Label>
      </RemoveBlockItem>
      <BlockColorsItem>
        <Label icon={<Palette className="size-4" />}>Color</Label>
      </BlockColorsItem>
    </DragHandleMenu>
  );
}
