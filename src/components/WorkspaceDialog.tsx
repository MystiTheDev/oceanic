import { useState } from "react";
import { Check } from "lucide-react";
import { COLOR_IDS, COLORS, type ColorId } from "../lib/colors";
import { Modal, ModalButton } from "./Modal";

const EMOJI = ["📁", "⚛️", "🧪", "📐", "💻", "🧬", "🌍", "📚", "🎨", "🎵", "🧠", "📊", "🔭", "⚙️", "📝", "🌊"];

export type WorkspaceDraft = { name: string; icon: string; color: string };

/** Create or edit a workspace: name, emoji icon and color. */
export function WorkspaceDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: WorkspaceDraft;
  onSave: (draft: WorkspaceDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "📁");
  const [color, setColor] = useState<string>(initial?.color ?? "blue");
  const valid = name.trim().length > 0;
  const submit = () => valid && onSave({ name: name.trim(), icon, color });

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-[15px] font-semibold text-neutral-100">
          {initial ? "Edit workspace" : "New workspace"}
        </h2>

        <div className="flex items-center gap-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg text-lg"
            style={{ backgroundColor: COLORS[color as ColorId]?.bg }}
          >
            {icon}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Physics"
            className="h-9 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[14px] text-neutral-100 outline-none transition-colors focus:border-sky-500/60"
          />
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-neutral-500">Icon</p>
          <div className="grid grid-cols-8 gap-1">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setIcon(e)}
                className={`grid h-8 cursor-pointer place-items-center rounded-md text-lg transition-colors ${
                  icon === e ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-neutral-500">Color</p>
          <div className="flex gap-1.5">
            {COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                title={COLORS[id].label}
                onClick={() => setColor(id)}
                className="grid size-6 cursor-pointer place-items-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: COLORS[id].solid }}
              >
                {color === id && <Check className="size-3.5 text-[#fff]" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" disabled={!valid} onClick={submit}>
            {initial ? "Save" : "Create"}
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}
