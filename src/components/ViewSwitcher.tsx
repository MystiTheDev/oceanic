import { CalendarDays, FileText, Network } from "lucide-react";

export type AppView = "document" | "atlas" | "calendar";

const VIEWS = [
  { id: "document", label: "Document view", icon: FileText },
  { id: "atlas", label: "Atlas", icon: Network },
  { id: "calendar", label: "Calendar view", icon: CalendarDays },
] as const;

/** Segmented control under Search: one icon per view, name on hover. */
export function ViewSwitcher({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="relative flex rounded-lg bg-white/[0.04] p-0.5">
        <span aria-hidden className="oc-view-pill absolute inset-y-0.5 left-0.5 rounded-md" style={{ width: `calc((100% - 4px) / ${VIEWS.length})`, transform: `translateX(${Math.max(0, VIEWS.findIndex((v) => v.id === view)) * 100}%)` }} />
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={view === id}
            onClick={() => onChange(id)}
            className={`relative grid h-8 flex-1 cursor-pointer place-items-center rounded-md transition-colors duration-150 ${
              view === id
                ? "text-neutral-100"
                : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
