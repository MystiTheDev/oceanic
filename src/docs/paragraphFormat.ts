import { Extension } from "@tiptap/core";

/** Word paragraph spacing and indents (points) on paragraphs and headings. */
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addGlobalAttributes() {
    const pt = (name: string, css: string) => ({
      [name]: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.style.getPropertyValue(css) ? parseFloat(el.style.getPropertyValue(css)) : null),
        renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { style: `${css}: ${attrs[name]}pt` }),
      },
    });
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          ...pt("spaceBefore", "margin-top"),
          ...pt("spaceAfter", "margin-bottom"),
          ...pt("indentLeft", "margin-left"),
          ...pt("indentRight", "margin-right"),
          ...pt("indentFirst", "text-indent"),
          ...pt("tabStop", "tab-size"),
        },
      },
      {
        // Float left/right with text wrapping beside it (Word's Square/Tight wrap).
        types: ["image"],
        attributes: {
          float: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-float"),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.float ? { "data-float": attrs.float } : {}),
          },
        },
      },
    ];
  },
});
