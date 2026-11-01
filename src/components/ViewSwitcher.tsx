import { CalendarDays, FileText, Network } from "lucide-react";

export type AppView = "document" | "canvas" | "calendar";

const VIEWS = [
  { id: "document", label: "Document view", icon: FileText },
  { id: "canvas", label: "Spatial canvas view", icon: Network },
  { id: "calendar", label: "Calendar view", icon: CalendarDays },
] as const;

/** Segmented control under Search: one icon per view, name on hover. */
export function ViewSwitcher({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="flex rounded-lg bg-white/[0.04] p-0.5">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={view === id}
            onClick={() => onChange(id)}
            className={`grid h-7 flex-1 cursor-pointer place-items-center rounded-md transition-colors duration-100 ${
              view === id
                ? "bg-white/[0.1] text-neutral-100 shadow-sm shadow-black/30"
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
