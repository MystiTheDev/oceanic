import type { ReactNode } from "react";
import { ArrowLeft, House, ImageIcon } from "lucide-react";
import sketchLogo from "../assets/sketch-logo.png";
import { sketchTitle, useSketch } from "./store";

const ROW = "flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] transition-colors duration-100";

/** The sidebar on Sketch Home: back, home and the folder's images. */
export function SketchSidebar({ activePath, onOpen, onHome, onBack, footer }: { activePath: string | null; onOpen: (p: string) => void; onHome: () => void; onBack: () => void; footer: ReactNode }) {
  const { files } = useSketch();
  return (
    <aside className="oc-fade-in flex h-full w-[264px] shrink-0 flex-col overflow-hidden rounded-r-2xl border-r border-white/[0.06] bg-[var(--oc-sidebar)] backdrop-blur">
      <div className="flex h-16 items-center gap-2.5 px-3 pt-2">
        <img src={sketchLogo} alt="Oceanic Sketch logo" className="size-9 shrink-0" />
        <div className="oc-sketch-word min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-[-0.02em]">Oceanic Sketch</div>
      </div>
      <div className="flex flex-col gap-px px-2 pb-1">
        <button type="button" onClick={onBack} className={`${ROW} text-neutral-400 hover:bg-white/5 hover:text-neutral-300`}>
          <ArrowLeft className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">Back to Oceanic</span>
        </button>
        <button type="button" onClick={onHome} className={`${ROW} ${activePath === null ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-300"}`}>
          <House className="size-4 shrink-0 text-neutral-500" />
          <span className="flex-1 text-left">Home</span>
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        <p className="mt-4 px-2 pb-1 text-[12px] font-semibold text-neutral-500">Images</p>
        {!files.length && <p className="px-2 py-1 text-[13px] text-neutral-600">No images yet</p>}
        {files.map((f) => (
          <button key={f.path} type="button" onClick={() => onOpen(f.path)} className={`${ROW} ${f.path === activePath ? "bg-white/10 font-medium text-neutral-100" : "text-neutral-300 hover:bg-white/5"}`}>
            <ImageIcon className="size-4 shrink-0 text-[color:var(--oc-sketch)]" />
            <span className="min-w-0 flex-1 truncate text-left">{sketchTitle(f.path)}</span>
          </button>
        ))}
      </div>
      {footer}
    </aside>
  );
}
