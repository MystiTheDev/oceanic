/**
 * Tags & status on phones: full screen like Settings. Tap a tag for a sheet to
 * rename, recolour or delete it; tap a tag or status to see its pages.
 * Android back closes the sheet, then the screen.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import type { PageStatus } from "../data/api";
import type { PageMeta } from "../data/workspace";
import { COLOR_IDS, COLORS, STATUSES, tagColor } from "../lib/colors";
import { useConfirmDelete } from "../lib/confirmDelete";
import { buzz } from "./mobilePrefs";
import "./mobile-settings.css";

type Props = {
  pages: PageMeta[];
  library: string[];
  onOpenPage: (id: string) => void;
  onCreateTag: (tag: string, color: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onDeleteTag: (tag: string) => void;
  onTagColor: (tag: string, color: string) => void;
  onClose: () => void;
};

/** What the sheet shows: a tag, a status, or the new-tag form. */
type Sheet = { tag: string } | { status: PageStatus } | { create: true };

export function MobileTags({ pages, library, onOpenPage, onCreateTag, onRenameTag, onDeleteTag, onTagColor, onClose }: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);
  const { ask } = useConfirmDelete();

  // One history entry for the screen, one for the sheet (same as MobileSettings).
  const depth = sheet ? 2 : 1;
  const pushed = useRef(0);
  const after = useRef<string | null>(null);
  const state = useRef({ sheet, onClose, onOpenPage });
  state.current = { sheet, onClose, onOpenPage };
  useEffect(() => {
    while (pushed.current < depth) history.pushState({ ocTags: ++pushed.current }, "");
  }, [depth]);
  useEffect(() => {
    const onPop = () => {
      pushed.current--;
      const id = after.current;
      if (id) {
        pushed.current = 0;
        state.current.onClose();
        state.current.onOpenPage(id);
      } else if (state.current.sheet) setSheet(null);
      else state.current.onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const back = () => history.back();
  // Leave this screen (both entries) first, then open the page.
  const goTo = (id: string) => ((after.current = id), history.go(-pushed.current));
  const open = (s: Sheet) => (buzz(), setName("tag" in s ? s.tag : ""), setSure(false), setSheet(s));

  const count = new Map<string, number>();
  for (const p of pages) for (const t of p.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  const tags = [...new Set([...count.keys(), ...library])].sort((a, b) => a.localeCompare(b));
  const dot = (bg: string) => <span className="oct-dot" style={{ background: bg }} />;

  const tag = sheet && "tag" in sheet ? sheet.tag : null;
  const status = sheet && "status" in sheet ? sheet.status : null;
  const listed = tag ? pages.filter((p) => p.tags?.includes(tag)) : status ? pages.filter((p) => p.status === status) : [];
  const save = () => {
    const v = name.trim();
    if (sheet && "create" in sheet && v) onCreateTag(v, "gray");
    if (tag && v && v !== tag) onRenameTag(tag, v);
    back();
  };

  return (
    <div className="ocs">
      <header className="ocs-bar">
        <button className="ocs-back" aria-label="Back" onClick={back}>
          <ChevronLeft size={24} />
        </button>
        <h1>Tags &amp; status</h1>
      </header>
      <div className="ocs-scroll">
        <h3 className="ocs-head">Status</h3>
        <section className="ocs-group">
          {(Object.keys(STATUSES) as PageStatus[]).map((s) => (
            <button key={s} className="ocs-row" onClick={() => open({ status: s })}>
              {dot(STATUSES[s].color.solid)}
              <span className="ocs-title">{STATUSES[s].label}</span>
              <span className="ocs-value">{pages.filter((p) => p.status === s).length}</span>
            </button>
          ))}
        </section>
        <h3 className="ocs-head">Tags</h3>
        <section className="ocs-group">
          {tags.map((t) => (
            <button key={t} className="ocs-row" onClick={() => open({ tag: t })}>
              {dot(tagColor(t).solid)}
              <span className="ocs-title">{t}</span>
              <span className="ocs-value">{count.get(t) ?? 0}</span>
            </button>
          ))}
          <button className="ocs-row ocs-link" onClick={() => open({ create: true })}>
            <Plus size={20} /> New tag
          </button>
        </section>
      </div>
      {sheet && (
        <div className="ocs-sheet-bg" onClick={back}>
          <div className="ocs-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ocs-grab" />
            <h2>{tag ?? (status ? STATUSES[status].label : "New tag")}</h2>
            {!status && (
              <form className="oct-name" onSubmit={(e) => (e.preventDefault(), save())}>
                <input className="ocs-input" autoFocus={!tag} value={name} placeholder="Tag name" onChange={(e) => setName(e.target.value)} />
                <button className="ocs-link">{tag ? "Rename" : "Create"}</button>
              </form>
            )}
            {tag && (
              <div className="ocs-colors">
                {COLOR_IDS.map((id) => (
                  <button
                    key={id}
                    aria-label={COLORS[id].label}
                    style={{ background: COLORS[id].solid, outline: tagColor(tag) === COLORS[id] ? "3px solid var(--oc-text-strong)" : "none" }}
                    onClick={() => (buzz(), onTagColor(tag, id))}
                  />
                ))}
              </div>
            )}
            <div className="oct-pages">
              {listed.map((p) => (
                <button key={p.id} className="ocs-radio" onClick={() => goTo(p.id)}>
                  {p.icon || "📄"} {p.title || "Untitled"}
                </button>
              ))}
            </div>
            {tag && (
              <button
                className="ocs-radio oct-danger"
                onClick={() => {
                  if (ask.notes && !sure) return setSure(true);
                  onDeleteTag(tag);
                  back();
                }}
              >
                {sure ? `Tap again: remove from ${count.get(tag) ?? 0} page(s)` : "Delete tag"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
