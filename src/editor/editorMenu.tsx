import { spellMenuItems } from "../lib/spell/plugin";
/* ---------------------------------------------------------------------------
 * Right-click menu inside the document editor: clipboard, inline styles for
 * a selection, and block actions (Turn into / Duplicate / Delete).
 * ------------------------------------------------------------------------ */
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { copyImageToClipboard } from "../lib/clipboard";
import { AllSelection, TextSelection } from "prosemirror-state";
import {
  Bold,
  ClipboardPaste,
  Code,
  Copy,
  CopyPlus,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  Quote,
  Repeat2,
  Scissors,
  SquareCode,
  Strikethrough,
  TextSelect,
  Trash2,
  Type,
  Underline,
} from "lucide-react";
import type { MenuItem } from "../components/ContextMenu";
import { copySelection, cutSelection, readClipboardText } from "../lib/clipboard";
import { isTextField } from "../lib/menus";
import type { OceanicEditor } from "./schema";

/** "Turn into" targets, in Notion's order. */
const TURN_INTO: { label: string; icon: React.ReactNode; type: string; props?: Record<string, unknown> }[] = [
  { label: "Text", icon: <Type className="size-4" />, type: "paragraph" },
  { label: "Heading 1", icon: <Heading1 className="size-4" />, type: "heading", props: { level: 1 } },
  { label: "Heading 2", icon: <Heading2 className="size-4" />, type: "heading", props: { level: 2 } },
  { label: "Heading 3", icon: <Heading3 className="size-4" />, type: "heading", props: { level: 3 } },
  { label: "Bulleted list", icon: <List className="size-4" />, type: "bulletListItem" },
  { label: "Numbered list", icon: <ListOrdered className="size-4" />, type: "numberedListItem" },
  { label: "To-do list", icon: <ListChecks className="size-4" />, type: "checkListItem" },
  { label: "Toggle list", icon: <ListCollapse className="size-4" />, type: "toggleListItem" },
  { label: "Quote", icon: <Quote className="size-4" />, type: "quote" },
  { label: "Code", icon: <SquareCode className="size-4" />, type: "codeBlock" },
];

/** Same shortcuts BlockNote / Tiptap bind, so the hints are real. */
const STYLES = [
  { key: "bold", label: "Bold", icon: <Bold className="size-4" />, hint: "Ctrl+B" },
  { key: "italic", label: "Italic", icon: <Italic className="size-4" />, hint: "Ctrl+I" },
  { key: "underline", label: "Underline", icon: <Underline className="size-4" />, hint: "Ctrl+U" },
  { key: "strike", label: "Strikethrough", icon: <Strikethrough className="size-4" />, hint: "Ctrl+Shift+S" },
  { key: "code", label: "Code", icon: <Code className="size-4" />, hint: "Ctrl+E" },
] as const;

function withoutIds(block: PartialBlock): PartialBlock {
  const { id: _id, children, ...rest } = block as PartialBlock & { id?: string };
  return { ...rest, children: children?.map(withoutIds) } as PartialBlock;
}

/**
 * Builds the menu for a right-click at `e`, or null when the click isn't on a
 * block (the global menu then takes over).
 */
export function editorContextMenu(editor: OceanicEditor, e: ReactMouseEvent): MenuItem[] | null {
  // Inputs inside blocks (e.g. the TeX editor) get the plain text-field menu.
  if (isTextField(e.target)) return null;
  const blockEl = (e.target as Element).closest("[data-node-type='blockContainer']");
  const id = blockEl?.getAttribute("data-id");
  const block = id ? (editor.getBlock(id) as Block | undefined) : undefined;
  if (!block) return null;

  const view = editor.prosemirrorView;
  // A misspelled word: its fixes come first (read before the caret moves).
  const spell = spellMenuItems(view, e) as MenuItem[];
  // Like a native menu: right-clicking outside the selection moves the caret there.
  const { from, to } = view.state.selection;
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (at && (at.pos < from || at.pos > to)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
  }
  view.focus();

  const hasText = block.content !== undefined;
  const selection = view.state.selection;
  const hasSelection = !selection.empty;
  const active = editor.getActiveStyles() as Record<string, unknown>;
  const level = (block.props as { level?: number }).level;

  const media = ["image", "video", "file"].includes(block.type);
  return [
    ...spell,
    ...(media
      ? ([
          {
            label: (block.props as { caption?: string }).caption ? "Edit caption…" : "Add caption…",
            icon: <Type className="size-4" />,
            onSelect: () => {
              const caption = window.prompt("Caption", (block.props as { caption?: string }).caption ?? "");
              if (caption !== null) editor.updateBlock(block, { props: { caption } } as never);
            },
          },
          ...(block.type === "image" && (block.props as { url?: string }).url
            ? [
                {
                  label: "Copy image",
                  icon: <Copy className="size-4" />,
                  onSelect: () => void copyImageToClipboard((block.props as { url: string }).url).catch(() => {}),
                },
                {
                  label: "Annotate…",
                  icon: <Type className="size-4" />,
                  onSelect: () => window.dispatchEvent(new CustomEvent("oc-annotate", { detail: { id: block.id, url: (block.props as { url: string }).url } })),
                },
              ]
            : []),
          "divider",
        ] as MenuItem[])
      : []),
    {
      label: "Cut",
      icon: <Scissors className="size-4" />,
      hint: "Ctrl+X",
      disabled: !hasSelection,
      onSelect: () => {
        editor.focus();
        cutSelection();
      },
    },
    {
      label: "Copy",
      icon: <Copy className="size-4" />,
      hint: "Ctrl+C",
      disabled: !hasSelection,
      onSelect: () => {
        editor.focus();
        copySelection();
      },
    },
    {
      label: "Paste",
      icon: <ClipboardPaste className="size-4" />,
      hint: "Ctrl+V",
      disabled: !hasText,
      onSelect: async () => {
        const text = await readClipboardText();
        editor.focus();
        if (text) editor.pasteText(text);
      },
    },
    {
      label: "Select all",
      icon: <TextSelect className="size-4" />,
      hint: "Ctrl+A",
      onSelect: () => {
        editor.focus();
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      },
    },
    ...(hasText && hasSelection
      ? (["divider", ...STYLES.map(
          (s): MenuItem => ({
            label: s.label,
            icon: s.icon,
            hint: s.hint,
            checked: !!active[s.key],
            onSelect: () => {
              editor.focus();
              editor.toggleStyles({ [s.key]: true } as never);
            },
          }),
        )] as MenuItem[])
      : []),
    "divider",
    ...(hasText
      ? [
          {
            label: "Turn into",
            icon: <Repeat2 className="size-4" />,
            children: TURN_INTO.map(
              (t): MenuItem => ({
                label: t.label,
                icon: t.icon,
                checked: block.type === t.type && (t.props?.level === undefined || t.props.level === level),
                onSelect: () => editor.updateBlock(block, { type: t.type, props: t.props ?? {} } as never),
              }),
            ),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: "Duplicate",
      icon: <CopyPlus className="size-4" />,
      onSelect: () => editor.insertBlocks([withoutIds(block as PartialBlock)] as never, block, "after"),
    },
    {
      label: "Delete",
      icon: <Trash2 className="size-4" />,
      danger: true,
      onSelect: () => editor.removeBlocks([block]),
    },
  ];
}
