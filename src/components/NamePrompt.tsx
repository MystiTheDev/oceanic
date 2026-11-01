import { useState } from "react";
import { Modal, ModalButton } from "./Modal";

/** First launch: ask what to call the user. Stored locally; editable in Settings. */
export function NamePrompt({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => name.trim() && onSave(name.trim());
  return (
    <Modal className="w-[380px]">
      <div className="flex flex-col items-center gap-3 px-6 pb-5 pt-7 text-center">
        <span className="text-4xl">🌊</span>
        <h2 className="text-[17px] font-semibold text-neutral-100">Welcome to Oceanic</h2>
        <p className="text-[13px] text-neutral-400">What should we call you?</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your name"
          className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-center text-[14px] text-neutral-100 outline-none focus:border-sky-500/60"
        />
        <div className="w-full pt-1 [&>button]:w-full">
          <ModalButton variant="primary" disabled={!name.trim()} onClick={submit}>
            Continue
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}
