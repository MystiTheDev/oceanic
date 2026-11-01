import { createReactBlockSpec } from "@blocknote/react";

/**
 * Databases were removed. Notes that still contain an old database block keep
 * opening; the block shows a short note (its rows remain as subpages).
 */
export const DatabaseBlock = createReactBlockSpec(
  { type: "database", propSchema: { dbId: { default: "" }, mode: { default: "new" } }, content: "none" },
  {
    render: () => (
      <div contentEditable={false} className="rounded-md border border-dashed border-white/10 px-3 py-2 text-[13px] text-neutral-500">
        Databases are no longer supported. Its pages are kept as subpages of this page.
      </div>
    ),
  },
);
