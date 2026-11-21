/**
 * Profile photo tools shared by the PC and phone apps.
 * - AvatarCropper: drag and zoom a picked photo inside a round frame (pinch on
 *   phones, wheel on PC, or the ruler dial), rotate, then save a 512px square JPEG.
 * - AvatarViewer: tap a profile photo to see it large in a circle (Instagram-style).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { buzz } from "../mobile/mobilePrefs";
import "./avatar-cropper.css";

const OUT = 512;
const MAX = 5;
/** Ruler dial: pixels of drag per 1x of zoom. */
const PER = 120;

export function AvatarCropper({ file, phone, onDone, onCancel }: { file: File; phone?: boolean; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const D = Math.min(phone ? window.innerWidth - 48 : 300, 340); // round frame size
  const [zoom, setZoom] = useState(1); // 1 = photo just covers the frame
  const [rot, setRot] = useState(0); // quarter turns
  const [at, setAt] = useState({ x: 0, y: 0 }); // photo centre offset from frame centre
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const dial = useRef<{ x: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const nw = img?.naturalWidth ?? 0;
  const nh = img?.naturalHeight ?? 0;
  const base = img ? D / Math.min(nw, nh) : 1; // px per image px at zoom 1
  const scale = base * zoom;
  const w = nw * scale; // drawn size before rotation
  const h = nh * scale;
  // Keep the (rotated) photo covering the whole circle.
  const clamp = (p: { x: number; y: number }, s = scale, r = rot) => {
    const [bw, bh] = r % 2 ? [nh * s, nw * s] : [nw * s, nh * s];
    const mx = Math.max(0, (bw - D) / 2);
    const my = Math.max(0, (bh - D) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZoomTo = (z: number) => {
    const nz = Math.min(MAX, Math.max(1, z));
    // Phone: a light tick when passing a whole step (1x, 2x, 3x...).
    if (phone && Math.floor(nz + 0.001) !== Math.floor(zoom + 0.001)) buzz();
    setZoom(nz);
    setAt((p) => clamp(p, base * nz));
  };
  const rotate = () => {
    buzz();
    const r = (rot + 1) % 4;
    setRot(r);
    setAt((p) => clamp(p, scale, r));
  };
  const reset = () => (buzz(), setZoom(1), setRot(0), setAt({ x: 0, y: 0 }));

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
    } else if (pointers.current.size === 1) {
      setAt((p) => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = () => {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = c.height = OUT;
    const g = c.getContext("2d")!;
    // Redraw exactly what the frame shows, scaled up to OUT px.
    g.scale(OUT / D, OUT / D);
    g.translate(D / 2 + at.x, D / 2 + at.y);
    g.rotate((rot * Math.PI) / 2);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    onDone(c.toDataURL("image/jpeg", 0.88));
  };

  // Ruler: a tick every 0.1x, a tall labelled tick at each whole step; the strip slides under a fixed centre needle.
  const ticks = Array.from({ length: (MAX - 1) * 10 + 1 }, (_, i) => 1 + i / 10);
  const step = (d: number) => setZoomTo(Math.round((zoom + d) * 4) / 4);

  return createPortal(
    <div className={`oc-crop${phone ? " phone" : ""}`} onWheel={(e) => setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
      <div className="oc-crop-box">
        {!phone && <h2>Adjust photo</h2>}
        <div className="oc-crop-frame" style={{ width: D, height: D }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{ width: w, height: h, left: D / 2 - w / 2 + at.x, top: D / 2 - h / 2 + at.y, transform: `rotate(${rot * 90}deg)` }}
            />
          )}
          <span className="oc-crop-ring" />
        </div>
        <p className="oc-crop-hint">{phone ? "Drag to move · pinch or turn the dial to zoom" : "Drag to move · scroll or turn the dial to zoom"}</p>
        <div className="oc-crop-tools">
          <button aria-label="Rotate" onClick={rotate}>
            <RotateCw size={18} />
          </button>
          <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => step(-0.25)}>
            <Minus size={18} />
          </button>
          <div
            className="oc-dial"
            role="slider"
            aria-label="Zoom"
            aria-valuemin={1}
            aria-valuemax={MAX}
            aria-valuenow={+zoom.toFixed(1)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") setZoomTo(zoom + 0.1);
              if (e.key === "ArrowLeft" || e.key === "ArrowDown") setZoomTo(zoom - 0.1);
            }}
            onPointerDown={(e) => {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              dial.current = { x: e.clientX, zoom };
            }}
            onPointerMove={(e) => dial.current && setZoomTo(dial.current.zoom - (e.clientX - dial.current.x) / PER)}
            onPointerUp={() => (dial.current = null)}
            onPointerCancel={() => (dial.current = null)}
          >
            <div className="oc-dial-strip" style={{ transform: `translateX(${-(zoom - 1) * PER}px)` }}>
              {ticks.map((t) => {
                const major = Math.abs(t - Math.round(t)) < 0.001;
                const half = !major && Math.abs(t * 2 - Math.round(t * 2)) < 0.001;
                return (
                  <i key={t} className={major ? "major" : half ? "half" : ""} style={{ left: (t - 1) * PER }}>
                    {major && <b>{Math.round(t)}×</b>}
                  </i>
                );
              })}
            </div>
            <span className="oc-dial-needle" />
            <em className="oc-dial-value">{zoom.toFixed(1)}×</em>
          </div>
          <button aria-label="Zoom in" disabled={zoom >= MAX} onClick={() => step(0.25)}>
            <Plus size={18} />
          </button>
          <button aria-label="Reset" disabled={zoom === 1 && !rot && !at.x && !at.y} onClick={reset}>
            <RotateCcw size={18} />
          </button>
        </div>
        <div className="oc-crop-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!img} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Large round view of a profile photo; tap anywhere (or Android back) to close. */
export function AvatarViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    history.pushState({ ocAvatar: 1 }, "");
    // Other back handlers skip while .oc-avatar-view is on screen, so this step only closes the viewer.
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && history.back();
    window.addEventListener("keydown", onKey);
    return () => (window.removeEventListener("popstate", onPop), window.removeEventListener("keydown", onKey));
  }, []);
  return createPortal(
    <motion.div className="oc-avatar-view" onClick={() => history.back()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <motion.img
        src={src}
        alt="Profile photo"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      />
    </motion.div>,
    document.body,
  );
}
