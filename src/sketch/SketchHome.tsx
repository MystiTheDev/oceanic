import { OpenNowRow, type OpenItem } from "../components/OpenNowRow";
import { HomeMotif } from "../components/HomeMotif";
import { useEffect, useState, type ReactNode } from "react";
import { Brush, ExternalLink, FolderOpen, FolderSearch, ImageIcon, Plus, Trash2, X } from "lucide-react";
import { openContextMenu } from "../components/ContextMenu";
import { requestDelete } from "../lib/confirmDelete";
import sketchLogo from "../assets/sketch-logo.png";
import { Modal, ModalButton } from "../components/Modal";
import { newSketch, pickImage, pickSketchFolder, readImageFile, sketchTitle, useSketch, forgetRecentSketch, revealSketch, trashSketch } from "./store";

const PRESETS: [string, number, number][] = [
  ["HD", 1280, 720],
  ["Full HD", 1920, 1080],
  ["Square", 1080, 1080],
  ["A4 (150 dpi)", 1240, 1754],
  ["Phone", 1080, 1920],
  ["Small", 800, 600],
];

/** Paint asks for the size of every new canvas. */
export function NewCanvasDialog({ onCreate, onClose }: { onCreate: (path: string) => void; onClose: () => void }) {
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const field = "h-8 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2 text-[13px] text-neutral-100 outline-none focus:border-[color:var(--oc-sketch)]";
  return (
    <Modal onClose={onClose} className="w-[440px] p-5">
      <h2 className="mb-4 text-[15px] font-semibold text-neutral-100">New canvas</h2>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {PRESETS.map(([name, pw, ph]) => (
          <button
            key={name}
            type="button"
            onClick={() => (setW(pw), setH(ph))}
            className={`cursor-pointer rounded-lg border px-2 py-2 text-left transition-colors ${w === pw && h === ph ? "border-[color:var(--oc-sketch)] bg-[color:var(--oc-sketch)]/10" : "border-white/[0.08] hover:border-white/20"}`}
          >
            <span className="block text-[13px] text-neutral-100">{name}</span>
            <span className="block text-[11px] text-neutral-500">{pw} × {ph}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[12px] text-neutral-400">Width (px)<input type="number" min={1} max={8000} value={w} onChange={(e) => setW(Number(e.target.value))} className={`${field} mt-1`} /></label>
        <label className="text-[12px] text-neutral-400">Height (px)<input type="number" min={1} max={8000} value={h} onChange={(e) => setH(Number(e.target.value))} className={`${field} mt-1`} /></label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" autoFocus onClick={() => w > 0 && h > 0 && onCreate(newSketch(Math.min(8000, w), Math.min(8000, h)))}>
          Create
        </ModalButton>
      </div>
    </Modal>
  );
}

/** Oceanic Sketch's Home: animated brand, new canvas, recent images. */
export function SketchHome({ onOpen, openNow, onFocusTab, onCloseTab }: { onOpen: (path: string) => void; openNow: OpenItem[]; onFocusTab: (tabId: string) => void; onCloseTab: (tabId: string) => void }) {
  const { folder, files, recent } = useSketch();
  const [asking, setAsking] = useState(false);
  const elsewhere = recent.filter((r) => !files.some((f) => f.path === r)).slice(0, 6);
  return (
    <div className="oc-app-home oc-docs-home-in scrollbar-thin relative h-full overflow-y-auto" style={{ "--home-tone": "var(--oc-sketch)" } as React.CSSProperties}>
      <HomeMotif kind="sketch" />
      <div className="oc-stagger relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-8 pb-24 pt-[10vh]">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src={sketchLogo} alt="Oceanic Sketch" className="oc-sketch-logo size-24" />
          <svg viewBox="0 0 680 90" className="oc-brush-word h-[72px] w-auto" aria-label="Oceanic Sketch">
            <defs>
              <linearGradient id="oc-sketch-ink" x1="0" x2="1">
                <stop offset="0" stopColor="var(--oc-text-strong)" />
                <stop offset="1" stopColor="var(--oc-sketch-light)" />
              </linearGradient>
            </defs>
            <text x="50%" y="70" textAnchor="middle" fontSize="72" fontWeight="800" letterSpacing="-2" stroke="url(#oc-sketch-ink)" fill="url(#oc-sketch-ink)">
              Oceanic Sketch
            </text>
          </svg>
          <p className="oc-fade-in text-[14px] text-neutral-400 [animation-delay:1.6s] [animation-fill-mode:backwards]">Draw, paint and edit images.</p>
        </div>

        <OpenNowRow items={openNow} icon={<Brush className="size-4" />} tone="var(--oc-sketch)" onFocus={onFocusTab} onClose={onCloseTab} />
        <section className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setAsking(true)} className="oc-template flex cursor-pointer items-center gap-3 rounded-xl border px-5 py-4 text-left" style={{ "--tone": "var(--oc-sketch)" } as React.CSSProperties}>
            <Plus className="size-6 text-[color:var(--oc-sketch-light)]" />
            <span>
              <span className="block text-[14px] font-semibold text-neutral-100">New canvas</span>
              <span className="block text-[12px] text-neutral-400">Choose a size</span>
            </span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const f = await pickImage();
              if (f) onOpen(f);
            }}
            className="oc-template flex cursor-pointer items-center gap-3 rounded-xl border px-5 py-4 text-left"
            style={{ "--tone": "#5aa2e9" } as React.CSSProperties}
          >
            <FolderOpen className="size-6 text-sky-400" />
            <span>
              <span className="block text-[14px] font-semibold text-neutral-100">Open image</span>
              <span className="block text-[12px] text-neutral-400">PNG or JPG</span>
            </span>
          </button>
        </section>

        <section>
          <div className="mb-3 flex items-center">
            <h2 className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">{folder ? folder.split(/[\\/]/).pop() : "Your images"}</h2>
            <button type="button" onClick={pickSketchFolder} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200">
              <FolderSearch className="size-4" /> Change folder
            </button>
          </div>
          {files.length ? (
            <Grid>{files.map((f) => <Thumb key={f.path} path={f.path} inFolder onOpen={onOpen} />)}</Grid>
          ) : (
            <p className="oc-glass p-6 text-center text-[14px] text-neutral-400">No images here yet. Start a new canvas above.</p>
          )}
          {elsewhere.length > 0 && (
            <>
              <p className="mb-2 mt-6 text-[12px] font-medium text-neutral-500">Opened from elsewhere</p>
              <Grid>{elsewhere.map((r) => <Thumb key={r} path={r} inFolder={false} onOpen={onOpen} />)}</Grid>
            </>
          )}
        </section>
      </div>
      {asking && <NewCanvasDialog onClose={() => setAsking(false)} onCreate={(p) => (setAsking(false), onOpen(p))} />}
    </div>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">{children}</div>;

/** Right-click on a Sketch image: Open, Show in Explorer, then Delete (folder) or Remove from list (elsewhere). */
export function sketchMenu(e: React.MouseEvent, path: string, inFolder: boolean, onOpen: (p: string) => void, onOpenNewTab?: (p: string) => void) {
  e.preventDefault();
  e.stopPropagation();
  const title = sketchTitle(path);
  openContextMenu(e, [
    { label: "Open", icon: <ImageIcon className="size-4" />, onSelect: () => onOpen(path) },
    ...(onOpenNewTab ? [{ label: "Open in new tab", icon: <ExternalLink className="size-4" />, onSelect: () => onOpenNewTab(path) }] : []),
    { label: "Show in File Explorer", icon: <FolderOpen className="size-4" />, onSelect: () => void revealSketch(path).catch(() => {}) },
    "divider",
    inFolder
      ? { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => requestDelete({ app: "sketch", kind: "recycle", title, entry: `sketch:${path}`, run: () => trashSketch(path) }) }
      : { label: "Remove from list", icon: <X className="size-4" />, danger: true, onSelect: () => requestDelete({ app: "sketch", kind: "remove", title, entry: `sketch:${path}`, run: () => forgetRecentSketch(path) }) },
  ]);
}

function Thumb({ path, inFolder, onOpen }: { path: string; inFolder: boolean; onOpen: (p: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    readImageFile(path)
      .then((b) => setUrl((u = URL.createObjectURL(new Blob([b as BlobPart])))))
      .catch(() => {});
    return () => void (u && URL.revokeObjectURL(u));
  }, [path]);
  const del = () =>
    inFolder
      ? requestDelete({ app: "sketch", kind: "recycle", title: sketchTitle(path), entry: `sketch:${path}`, run: () => trashSketch(path) })
      : requestDelete({ app: "sketch", kind: "remove", title: sketchTitle(path), entry: `sketch:${path}`, run: () => forgetRecentSketch(path) });
  return (
    <div className="group relative">
      <button type="button" onClick={() => onOpen(path)} onContextMenu={(e) => sketchMenu(e, path, inFolder, onOpen)} title={path} className="flex w-full cursor-pointer flex-col gap-2 text-left">
        <span className="oc-checker grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border border-white/[0.08] transition-all group-hover:-translate-y-1 group-hover:border-[color:var(--oc-sketch)]">
          {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-6 text-neutral-500" />}
        </span>
        <span className="truncate text-[13px] font-medium text-neutral-200">{sketchTitle(path)}</span>
      </button>
      <button
        type="button"
        data-tip={inFolder ? "Delete" : "Remove from list"}
        onClick={del}
        className="absolute right-1.5 top-1.5 grid size-7 cursor-pointer place-items-center rounded-md bg-neutral-900/80 text-neutral-300 opacity-0 shadow-md backdrop-blur transition-all hover:bg-red-500/90 hover:text-white group-hover:-translate-y-1 group-hover:opacity-100"
      >
        {inFolder ? <Trash2 className="size-3.5" /> : <X className="size-3.5" />}
      </button>
    </div>
  );
}
