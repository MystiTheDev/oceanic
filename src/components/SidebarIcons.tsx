/* Sidebar nav icons: duotone, drawn in parts so each one has its own hover motion (see theme.css "oc-ico"). */
const Svg = ({ className = "", children }: { className?: string; children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`oc-ico ${className}`} aria-hidden>
    {children}
  </svg>
);
const tint = { fill: "currentColor", fillOpacity: 0.18 };

export const HomeIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" {...tint} />
    <path className="p door" d="M10 21v-6.5h4V21" />
  </Svg>
);
export const LibraryIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <rect x="3.5" y="4" width="4.5" height="16.5" rx="1" />
    <rect x="9.5" y="4" width="4.5" height="16.5" rx="1" {...tint} />
    <path className="p book" d="m16 6.2 3-.9 3.3 14.4-3 .8z" />
  </Svg>
);
export const TagsIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <g className="p tag">
      <path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1l9 9a1.4 1.4 0 0 1 0 2l-6.1 6.1a1.4 1.4 0 0 1-2 0z" {...tint} />
      <circle cx="8" cy="8" r="1.4" />
    </g>
  </Svg>
);
export const TrashIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M5.5 7.5h13l-1.1 12.6a1 1 0 0 1-1 .9H7.6a1 1 0 0 1-1-.9z" {...tint} />
    <path d="M10 11.5v5.5M14 11.5v5.5" />
    <g className="p lid">
      <path d="M3.5 7.5h17" />
      <path d="M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5" />
    </g>
  </Svg>
);
export const ImportIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M4 14.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5" {...tint} />
    <g className="p arrow">
      <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
    </g>
  </Svg>
);
export const SearchIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <g className="p lens">
      <circle cx="10.5" cy="10.5" r="6.5" {...tint} />
      <path d="m20.5 20.5-5.3-5.3" />
    </g>
  </Svg>
);
