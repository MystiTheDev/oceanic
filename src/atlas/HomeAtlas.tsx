import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { api } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { openLens, type Lens } from "./lenses";

/** Home chip: the most useful Atlas lens right now (concepts to review, else unlinked notes). Hidden when there's nothing to do. */
export function HomeAtlas({ pages, workspaceId: ws }: { pages: PageMeta[]; workspaceId: string }) {
  const [tip, setTip] = useState<{ lens: Lens; text: string } | null>(null);
  useEffect(() => {
    if (!ws) return;
    let live = true;
    Promise.all([api.listConcepts(ws).catch(() => []), api.getLinks().catch(() => []), api.getCanvasEdges().catch(() => [])]).then(([cs, links, edges]) => {
      if (!live) return;
      const due = cs.filter((c) => c.state === "review" || c.state === "learning").length;
      if (due) return setTip({ lens: "study", text: `${due} concept${due === 1 ? "" : "s"} to review` });
      const linked = new Set([...links, ...edges].flatMap((e) => [e.sourceId, e.targetId]));
      const parents = new Set(pages.map((p) => p.parentId));
      const mine = pages;
      const lone = mine.filter((p) => !linked.has(p.id) && !p.parentId && !parents.has(p.id)).length;
      setTip(lone >= 2 && mine.length >= 4 ? { lens: "suggest", text: `${lone} notes not linked yet` } : null);
    });
    return () => void (live = false);
  }, [ws, pages.length]);
  if (!tip) return null;
  return (
    <button type="button" onClick={() => openLens(tip.lens)} title="Open Atlas"
      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#2dd4bf]/15 px-2.5 py-1 text-[12px] font-medium text-[#5eead4] hover:bg-[#2dd4bf]/25">
      <Network className="size-3.5" /> {tip.text}
    </button>
  );
}
