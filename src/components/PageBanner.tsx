import { useRef, useState } from "react";
import { ImagePlus, Move, Trash2, RefreshCw, Upload } from "lucide-react";
import { bannerBg, GALLERY, GRADIENTS, setBanner, useBanner, type Banner } from "../lib/banners";
import { uploadFile } from "../editor/audio";

/** Notion-style page cover: full-width image/gradient with Change, Reposition and Remove on hover. */
export function PageBanner({ pageId }: { pageId: string }) {
  const banner = useBanner(pageId);
  const [picker, setPicker] = useState(false);
  const [moving, setMoving] = useState<Banner | null>(null);
  const drag = useRef<{ y: number; start: number } | null>(null);
  const shown = moving ?? banner;

  if (!shown) {
    return (
      <div className="relative mx-auto w-full max-w-3xl px-10 pt-6">
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-neutral-500 opacity-0 transition-opacity duration-150 hover:bg-white/5 hover:text-neutral-300 focus:opacity-100 [.oc-banner-zone:hover_&]:opacity-100"
        >
          <ImagePlus className="size-3.5" /> Add banner
        </button>
        {picker && <BannerPicker onPick={(b) => (setBanner(pageId, b), setPicker(false))} onClose={() => setPicker(false)} />}
      </div>
    );
  }

  const isImage = !shown.src.startsWith("css:");
  return (
    <div
      className={`group relative h-[30vh] max-h-[280px] min-h-[160px] w-full shrink-0 select-none ${moving ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ background: bannerBg(shown) }}
      onPointerDown={(e) => {
        if (!moving || (e.target as HTMLElement).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, start: moving.y };
      }}
      onPointerMove={(e) => {
        if (!moving || !drag.current) return;
        const h = e.currentTarget.clientHeight;
        const y = Math.max(0, Math.min(100, drag.current.start - ((e.clientY - drag.current.y) / h) * 100));
        setMoving({ ...moving, y });
      }}
      onPointerUp={() => (drag.current = null)}
    >
      {moving && <span className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] font-medium text-white drop-shadow">Drag image to reposition</span>}
      <div className={`absolute right-4 top-3 z-20 flex gap-1 transition-opacity duration-150 ${moving ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {moving ? (
          <>
            <Btn onClick={() => (setBanner(pageId, moving), setMoving(null))}>Save position</Btn>
            <Btn onClick={() => setMoving(null)}>Cancel</Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => setPicker(true)}><RefreshCw className="size-3.5" /> Change</Btn>
            {isImage && <Btn onClick={() => setMoving(banner)}><Move className="size-3.5" /> Reposition</Btn>}
            <Btn onClick={() => setBanner(pageId, null)}><Trash2 className="size-3.5" /> Remove</Btn>
          </>
        )}
      </div>
      {picker && (
        <div className="absolute right-4 top-12 z-30">
          <BannerPicker onPick={(b) => (setBanner(pageId, b), setPicker(false))} onClose={() => setPicker(false)} />
        </div>
      )}
    </div>
  );
}

const Btn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="flex cursor-pointer items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[12px] text-neutral-100 backdrop-blur-sm transition-colors hover:bg-black/75">
    {children}
  </button>
);

function BannerPicker({ onPick, onClose }: { onPick: (b: Banner) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"gallery" | "colors" | "upload">("gallery");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="oc-pop-in absolute right-0 z-50 mt-1 w-[380px] rounded-xl border border-white/[0.08] bg-[var(--oc-raised,#262626)] p-3 shadow-2xl">
        <div className="mb-3 flex gap-1 text-[13px]">
          {(["gallery", "colors", "upload"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`cursor-pointer rounded-md px-2.5 py-1 capitalize ${tab === t ? "bg-white/10 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === "gallery" && (
          <div className="grid grid-cols-3 gap-2">
            {GALLERY.map((src) => (
              <button key={src} type="button" onClick={() => onPick({ src, y: 50 })} className="h-16 cursor-pointer rounded-md bg-cover bg-center ring-white/40 hover:ring-2" style={{ backgroundImage: `url("${src}")` }} />
            ))}
          </div>
        )}
        {tab === "colors" && (
          <div className="grid grid-cols-4 gap-2">
            {GRADIENTS.map((g) => (
              <button key={g} type="button" onClick={() => onPick({ src: `css:${g}`, y: 50 })} className="h-12 cursor-pointer rounded-md ring-white/40 hover:ring-2" style={{ background: g }} />
            ))}
          </div>
        )}
        {tab === "upload" && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                try {
                  onPick({ src: await uploadFile(f), y: 50 });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <button type="button" disabled={busy} onClick={() => file.current?.click()} className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 text-[13px] text-neutral-400 hover:border-white/30 hover:text-neutral-200">
              <Upload className="size-5" />
              {busy ? "Uploading…" : "Choose an image from your computer"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
