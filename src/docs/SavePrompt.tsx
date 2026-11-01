import type { JSONContent } from "@tiptap/core";
import { Modal, ModalButton } from "../components/Modal";
import { DEFAULT_PAGE, exportDocx, type PageSetup } from "./docxIO";
import { docTitle, forgetUntitled, pickSavePath, refreshFiles, untitledContent, untitledPage, writeDoc } from "./store";

/** Word's "Save changes?" for an unsaved document; `proceed` runs unless cancelled. */
export function SavePrompt({ path, proceed, onCancel }: { path: string; proceed: () => void; onCancel: () => void }) {
  const save = async () => {
    const target = await pickSavePath(docTitle(path));
    if (!target) return;
    const content = untitledContent(path);
    const doc: JSONContent = typeof content === "object" && content ? (content as JSONContent) : { type: "doc", content: [{ type: "paragraph" }] };
    await writeDoc(target, await exportDocx(doc, (untitledPage(path) as PageSetup | undefined) ?? DEFAULT_PAGE));
    forgetUntitled(path);
    void refreshFiles();
    proceed();
  };
  return (
    <Modal onClose={onCancel} className="w-[420px] p-5">
      <h2 className="text-[15px] font-semibold text-neutral-100">Save changes to “{docTitle(path)}”?</h2>
      <p className="mt-1.5 text-[13px] text-neutral-400">This document hasn't been saved yet. If you don't save, your changes will be lost.</p>
      <div className="mt-5 flex justify-end gap-2">
        <ModalButton onClick={onCancel}>Cancel</ModalButton>
        <ModalButton
          variant="danger"
          onClick={() => {
            forgetUntitled(path);
            proceed();
          }}
        >
          Don't save
        </ModalButton>
        <ModalButton variant="primary" autoFocus onClick={() => void save()}>
          Save
        </ModalButton>
      </div>
    </Modal>
  );
}
