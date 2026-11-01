import { HomeMotif } from "../components/HomeMotif";
import type { ReactNode } from "react";
import { Copy, ExternalLink, FilePlus, FileText, FolderOpen, FolderSearch, X } from "lucide-react";
import type { JSONContent } from "@tiptap/core";
import docsLogo from "../assets/docs-logo.png";
import { openContextMenu, type MenuItem } from "../components/ContextMenu";
import { docTitle, duplicateDoc, newUntitled, pickDocx, pickFolder, refreshFiles, replaceRecent, revealDoc, useDocs } from "./store";

const h = (level: number, text: string): JSONContent => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text = ""): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : undefined });
/** Preview lines: "t" title, "h" heading, "l" text line, "s" short line, "g" gap. */
const TEMPLATES: { name: string; desc: string; tint: string; preview: string; doc: JSONContent[] }[] = [
  { name: "Blank", desc: "Start from scratch", tint: "#0fb5ba", preview: "", doc: [p()] },
  { name: "Essay", desc: "Intro, body, conclusion", tint: "#60a5fa", preview: "tsghlllhlllhll", doc: [h(1, "Essay title"), p("Your name · Class · Date"), h(2, "Introduction"), p(), h(2, "Body"), p(), h(2, "Conclusion"), p()] },
  { name: "Report", desc: "Summary and findings", tint: "#f59e0b", preview: "tsghllhlllhll", doc: [h(1, "Report title"), p("Prepared by · Date"), h(2, "Summary"), p(), h(2, "Findings"), p(), h(2, "Recommendations"), p()] },
  { name: "Letter", desc: "Formal letter layout", tint: "#a78bfa", preview: "ssgsgllllgss", doc: [p("Your address"), p("Date"), p(), p("Dear …,"), p(), p("Yours sincerely,"), p("Your name")] },
  { name: "Resume", desc: "Experience and skills", tint: "#f472b6", preview: "tshllhllhs", doc: [h(1, "Your Name"), p("email · phone · city"), h(2, "Experience"), p(), h(2, "Education"), p(), h(2, "Skills"), p()] },
];

/** Oceanic Docs' Home: animated brand, templates, folder + recent documents. */
export function DocsHome({ onOpen }: { onOpen: (path: string) => void }) {
  const { folder, files, recent } = useDocs();
  // Like Word: opens unsaved; the first save asks where to put it.
  const create = (t: (typeof TEMPLATES)[number]) => onOpen(newUntitled(t.name === "Blank" ? undefined : t.name, { type: "doc", content: t.doc }));
  const recentElsewhere = recent.filter((r) => !files.some((f) => f.path === r)).slice(0, 6);

  /** Right-click on a document card: Open / Show in File Explorer, plus
      Remove from list for recents opened elsewhere (duplicate for folder files). */
  const cardMenu = (e: React.MouseEvent, path: string, fromRecents: boolean) => {
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: "Open", icon: <FileText className="size-4" />, onSelect: () => onOpen(path) },
      { label: "Show in File Explorer", icon: <ExternalLink className="size-4" />, onSelect: () => void revealDoc(path).catch(() => {}) },
      "divider",
      fromRecents
        ? { label: "Remove from list", icon: <X className="size-4" />, danger: true, onSelect: () => replaceRecent(path, null) }
        : {
            label: "Duplicate",
            icon: <Copy className="size-4" />,
            onSelect: async () => {
              try {
                await duplicateDoc(path);
                await refreshFiles();
              } catch {}
            },
          },
    ];
    openContextMenu(e, items);
  };

  return (
    <div className="oc-app-home oc-docs-home-in scrollbar-thin relative h-full overflow-y-auto" style={{ "--home-tone": "var(--oc-docs)" } as React.CSSProperties}>
      <HomeMotif kind="docs" />
      <div className="oc-stagger relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-8 pb-24 pt-[10vh]">
        {/* ---- Brand: logo lifts in, the wordmark writes itself in ink ---- */}
        <div className="flex flex-col items-center gap-2 text-center">
          <img src={docsLogo} alt="Oceanic Docs" className="oc-docs-logo size-24" />
          <svg viewBox="0 0 640 90" className="oc-ink-word h-[72px] w-auto" aria-label="Oceanic Docs">
            <defs>
              <linearGradient id="oc-docs-ink" x1="0" x2="1">
                <stop offset="0" stopColor="var(--oc-text-strong)" />
                <stop offset="1" stopColor="var(--oc-docs-light)" />
              </linearGradient>
            </defs>
            <text x="50%" y="70" textAnchor="middle" fontSize="72" fontWeight="800" letterSpacing="-2" stroke="url(#oc-docs-ink)" fill="url(#oc-docs-ink)">
              Oceanic Docs
            </text>
          </svg>
          <p className="oc-fade-in text-[14px] text-neutral-400 [animation-delay:1.6s] [animation-fill-mode:backwards]">Write, format and print real Word documents.</p>
        </div>

        {/* ---- Start a new document ---- */}
        <section>
          <SectionTitle>Start a new document</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {TEMPLATES.map((t) => (
              <TemplateCard key={t.name} t={t} onClick={() => create(t)} />
            ))}
          </div>
        </section>

        {/* ---- Your documents ---- */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <SectionTitle>{folder ? docTitle(folder) || folder : "Your documents"}</SectionTitle>
            <span className="flex-1" />
            <ToolBtn icon={<FolderSearch className="size-4" />} label={folder ? "Change folder" : "Choose folder"} onClick={pickFolder} />
            <ToolBtn
              icon={<FolderOpen className="size-4" />}
              label="Open…"
              onClick={async () => {
                const f = await pickDocx();
                if (f) onOpen(f);
              }}
            />
          </div>
          {!folder ? (
            <p className="oc-glass p-6 text-center text-[14px] text-neutral-400">Choose a folder for your documents. Oceanic Docs saves real .docx files there.</p>
          ) : !files.length ? (
            <p className="oc-glass p-6 text-center text-[14px] text-neutral-400">No .docx files in this folder yet. Start one above.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {files.map((f) => (
                <DocCard key={f.path} path={f.path} sub={new Date(f.modified).toLocaleDateString(undefined, { month: "short", day: "numeric" })} onOpen={onOpen} onMenu={(e) => cardMenu(e, f.path, false)} />
              ))}
            </div>
          )}
          {recentElsewhere.length > 0 && (
            <>
              <p className="mb-2 mt-6 text-[12px] font-medium text-neutral-500">Opened from elsewhere</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                {recentElsewhere.map((r) => (
                  <DocCard key={r} path={r} sub={r} onOpen={onOpen} onMenu={(e) => cardMenu(e, r, true)} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Tinted glass card holding a mini page preview of the template. */
function TemplateCard({ t, onClick }: { t: (typeof TEMPLATES)[number]; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ "--tone": t.tint } as React.CSSProperties}
      className="oc-template group flex cursor-pointer flex-col gap-3 rounded-xl border p-3 text-left"
    >
      <span className="relative mx-auto block aspect-[210/297] w-[92px] rounded-[3px] bg-white px-2.5 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.35)] transition-transform duration-200 group-hover:-translate-y-1 group-hover:rotate-[-1.5deg]">
        {t.preview ? (
          [...t.preview].map((k, i) =>
            k === "g" ? (
              <span key={i} className="block h-1.5" />
            ) : (
              <span
                key={i}
                className="mb-[3px] block rounded-full"
                style={{
                  height: k === "t" ? 5 : k === "h" ? 3 : 2,
                  width: k === "t" ? "70%" : k === "h" ? "45%" : k === "s" ? "40%" : `${80 + ((i * 13) % 20)}%`,
                  background: k === "t" || k === "h" ? t.tint : "#d4d4d4",
                }}
              />
            ),
          )
        ) : (
          <FilePlus className="absolute inset-0 m-auto size-7" style={{ color: t.tint }} />
        )}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-neutral-100">{t.name}</span>
        <span className="block truncate text-[11px] text-neutral-400">{t.desc}</span>
      </span>
    </button>
  );
}

function DocCard({ path, sub, onOpen, onMenu }: { path: string; sub: string; onOpen: (p: string) => void; onMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" onClick={() => onOpen(path)} onContextMenu={onMenu} title={path} className="group flex cursor-pointer flex-col gap-2 text-left">
      {/* Page-shaped thumbnail */}
      <span className="relative block aspect-[210/297] w-full overflow-hidden rounded-md border border-white/[0.08] bg-white p-3 shadow-md transition-all group-hover:-translate-y-1 group-hover:border-[color:var(--oc-docs)]">
        <span className="mb-2 block h-2 w-2/3 rounded bg-neutral-300" />
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="mb-1.5 block h-1 rounded bg-neutral-200" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
        ))}
        <FileText className="absolute bottom-2 right-2 size-4 text-[color:var(--oc-docs)]" />
      </span>
      <span className="truncate text-[13px] font-medium text-neutral-200">{docTitle(path)}</span>
      <span className="-mt-1.5 truncate text-[11px] text-neutral-500">{sub}</span>
    </button>
  );
}

const SectionTitle = ({ children }: { children: ReactNode }) => <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">{children}</h2>;
function ToolBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-mt-3 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200">
      {icon}
      {label}
    </button>
  );
}
