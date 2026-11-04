import { useEffect, useState } from "react";
import { api, type MindmapRecord } from "../data/api";
import { fromRecord, logoOf, subjectOf } from "./model";

const cache = new Map<string, string>();

/** A saved map's logo (root topic's emoji, else its subject icon). */
export function useMapLogo(m: MindmapRecord): string {
  const key = `${m.id}@${m.updatedAt}`;
  const [logo, setLogo] = useState(() => cache.get(key) ?? subjectOf(m.subjectTag).icon);
  useEffect(() => {
    if (cache.has(key)) return void setLogo(cache.get(key)!);
    let live = true;
    api.getMindmapById(m.id).then((x) => {
      const l = logoOf(x?.nodes.map(fromRecord), m.subjectTag);
      cache.set(key, l);
      if (live) setLogo(l);
    });
    return () => void (live = false);
  }, [key]);
  return logo;
}
