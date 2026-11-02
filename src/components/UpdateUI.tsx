import { ArrowDownToLine, PartyPopper, Sparkles, X } from "lucide-react";
import logoRaw from "../assets/logo-raw.png";
import { Modal, ModalButton } from "./Modal";
import { closeUpdateModal, closeWhatsNew, dismissToast, installUpdate, openUpdateModal, useUpdates } from "../lib/updates";

/** Release notes: one bullet per non-empty line ("- " / "* " stripped). */
function Notes({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
  if (!lines.length) return <p className="text-[13px] text-neutral-400">Improvements and fixes.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map((l, i) => (
        <li key={i} className="oc-row-in flex gap-2 text-[13.5px] text-neutral-200" style={{ animationDelay: `${150 + i * 60}ms` }}>
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[color:var(--oc-brand-light)]" />
          {l}
        </li>
      ))}
    </ul>
  );
}

/** Layered waves; `fill` 0..1 raises the water (download progress). */
function Waves({ fill }: { fill: number }) {
  return (
    <div className="oc-update-sea absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out" style={{ height: `${28 + fill * 72}%` }}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 1200 120" preserveAspectRatio="none" className={`oc-wave oc-wave-${i}`}>
          <path d="M0 60 Q150 20 300 60 T600 60 T900 60 T1200 60 V120 H0 Z" />
          {/* foam along the crest */}
          {i === 2 && <path d="M0 60 Q150 20 300 60 T600 60 T900 60 T1200 60" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" />}
        </svg>
      ))}
      {/* Bubbles rising through the water */}
      {Array.from({ length: 10 }, (_, i) => (
        <span key={`b${i}`} className="oc-bubble" style={{ left: `${6 + ((i * 37) % 88)}%`, width: 4 + (i % 4) * 3, height: 4 + (i % 4) * 3, animationDelay: `${(i * 0.45) % 4}s`, animationDuration: `${3 + (i % 3)}s` }} />
      ))}
      <div className="absolute inset-x-0 bottom-0 top-[40px] bg-[color:var(--oc-brand)]/60" />
    </div>
  );
}

export function UpdateUI() {
  const u = useUpdates();
  const busy = u.phase === "downloading" || u.phase === "installing" || u.phase === "restarting";
  return (
    <>
      {/* ---- Toast ---- */}
      {u.toast && u.phase === "available" && (
        <div className="oc-update-toast fixed bottom-5 right-5 z-[80] flex items-center gap-3 rounded-full border border-white/[0.1] bg-[var(--oc-surface)] py-2 pl-2 pr-3 shadow-2xl">
          <span className="relative grid size-8 place-items-center rounded-full bg-[color:var(--oc-brand)]/20">
            <span className="absolute inset-0 animate-ping rounded-full bg-[color:var(--oc-brand)]/25" />
            <ArrowDownToLine className="size-4 text-[color:var(--oc-brand-light)]" />
          </span>
          <span className="text-[13px] text-neutral-200">
            Oceanic <b>{u.version}</b> is available
          </span>
          <button type="button" onClick={openUpdateModal} className="cursor-pointer rounded-full bg-[var(--oc-brand)] px-3 py-1 text-[12.5px] font-medium text-white hover:brightness-110">
            See what's new
          </button>
          <button type="button" onClick={dismissToast} title="Later" className="cursor-pointer text-neutral-500 hover:text-neutral-200"><X className="size-4" /></button>
        </div>
      )}

      {/* ---- Update modal ---- */}
      {u.modal && (
        <Modal onClose={busy ? () => {} : closeUpdateModal} className="w-[460px] overflow-hidden p-0">
          <div className="oc-update-hero relative h-48 overflow-hidden">
            <span className="oc-rays" />
            <Waves fill={u.phase === "downloading" ? u.progress : busy ? 1 : 0} />
            {/* The logo floats on the surface and rises with the water */}
            <div
              className="absolute left-1/2 -translate-x-1/2 transition-[bottom] duration-500 ease-out"
              style={{ bottom: `calc(${Math.min(62, 28 + (u.phase === "downloading" ? u.progress : busy ? 1 : 0) * 72)}% - 26px)` }}
            >
              <img src={logoRaw} alt="" className="oc-update-logo size-20 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)]" />
            </div>
            {!busy && (
              <button type="button" onClick={closeUpdateModal} className="absolute right-3 top-3 grid size-7 cursor-pointer place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
            )}
            {u.version && (
              <span className="oc-update-badge oc-shimmer absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/25 bg-black/30 px-3 py-0.5 text-[12px] font-semibold text-white backdrop-blur">
                Version {u.version}
              </span>
            )}
          </div>
          <div className="p-5">
            {u.phase === "checking" && <p className="text-[14px] text-neutral-300">Checking for updates…</p>}
            {u.phase === "uptodate" && <p className="text-[14px] text-neutral-200">You're up to date. 🎉</p>}
            {u.phase === "error" && <p className="text-[13px] text-red-400">Couldn't update: {u.error}</p>}
            {(u.phase === "available" || busy) && (
              <>
                <h2 className="mb-3 text-[17px] font-semibold text-neutral-100">A new Oceanic is here</h2>
                <div className="scrollbar-thin max-h-48 overflow-y-auto pr-1"><Notes text={u.notes} /></div>
              </>
            )}
            {busy && (
              <div className="mt-4">
                <div className="mb-1 flex text-[12px] text-neutral-400">
                  <span className="flex-1">{u.phase === "downloading" ? "Downloading…" : u.phase === "installing" ? "Installing…" : "Restarting…"}</span>
                  <span className="tabular-nums">{Math.round(u.progress * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-[var(--oc-brand)] transition-[width] duration-300" style={{ width: `${u.progress * 100}%` }} />
                </div>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {u.phase === "available" ? (
                <>
                  <ModalButton onClick={closeUpdateModal}>Later</ModalButton>
                  <ModalButton variant="primary" autoFocus onClick={() => void installUpdate()}>Update now</ModalButton>
                </>
              ) : !busy ? (
                <ModalButton onClick={closeUpdateModal}>Close</ModalButton>
              ) : null}
            </div>
          </div>
        </Modal>
      )}

      {/* ---- What's new (once, after updating) ---- */}
      {u.whatsNew && (
        <Modal onClose={closeWhatsNew} className="w-[440px] overflow-hidden p-0">
          <div className="oc-update-hero relative grid h-36 place-items-center overflow-hidden">
            <Waves fill={0} />
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="oc-confetti absolute top-0" style={{ left: `${(i * 7.3) % 100}%`, animationDelay: `${(i % 7) * 120}ms`, background: ["#5aa2e9", "#a78bfa", "#0fb5ba", "#ff7a59", "#fbbf24"][i % 5] }} />
            ))}
            <PartyPopper className="oc-update-logo relative size-12 text-white drop-shadow" />
          </div>
          <div className="p-5">
            <h2 className="mb-1 flex items-center gap-2 text-[17px] font-semibold text-neutral-100"><Sparkles className="size-4 text-amber-300" /> What's new in {u.whatsNew.version}</h2>
            <p className="mb-3 text-[12.5px] text-neutral-500">Oceanic was updated.</p>
            <div className="scrollbar-thin max-h-56 overflow-y-auto pr-1"><Notes text={u.whatsNew.notes} /></div>
            <div className="mt-5 flex justify-end">
              <ModalButton variant="primary" autoFocus onClick={closeWhatsNew}>Got it</ModalButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
