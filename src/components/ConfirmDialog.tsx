import { useSyncExternalStore } from "react";
import { AlertTriangle, Info, Trash2 } from "lucide-react";
import { Modal, ModalButton } from "./Modal";

/** Themed replacement for window.confirm / window.alert. `await ask(...)` → true on confirm. */
type Req = {
  title: string;
  body?: string;
  confirm?: string;
  cancel?: string | null;
  tone?: "danger" | "warn" | "info";
  resolve: (ok: boolean) => void;
};
let queue: Req[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function ask(opts: Omit<Req, "resolve">): Promise<boolean> {
  return new Promise((resolve) => ((queue = [...queue, { tone: "danger", ...opts, resolve }]), emit()));
}
/** Message with a single OK button. */
export function tell(title: string, body?: string): Promise<void> {
  return ask({ title, body, confirm: "OK", cancel: null, tone: "info" }).then(() => {});
}

export function ConfirmDialogHost() {
  const req = useSyncExternalStore(subscribe, () => queue[0]);
  if (!req) return null;
  const done = (ok: boolean) => ((queue = queue.slice(1)), emit(), req.resolve(ok));
  const Icon = req.tone === "info" ? Info : req.tone === "warn" ? AlertTriangle : Trash2;
  const ring = { danger: "bg-red-500/15 text-red-400", warn: "bg-amber-500/15 text-amber-300", info: "bg-sky-500/15 text-sky-300" }[req.tone ?? "danger"];
  return (
    <Modal onClose={() => done(false)} className="w-[400px] p-5">
      <div className="flex gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${ring}`}><Icon className="size-4" /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-neutral-100">{req.title}</h2>
          {req.body && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-neutral-400">{req.body}</p>}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {req.cancel !== null && <ModalButton onClick={() => done(false)}>{req.cancel ?? "Cancel"}</ModalButton>}
        <ModalButton autoFocus variant={req.tone === "danger" ? "danger" : "primary"} onClick={() => done(true)}>{req.confirm ?? "OK"}</ModalButton>
      </div>
    </Modal>
  );
}
