/** Decorative, slow background motifs for the app homes (purely visual). */
export function HomeMotif({ kind }: { kind: "sketch" | "docs" | "mindmap" }) {
  if (kind === "sketch") {
    const splashes = [
      ["#ff7a59", 8, 22, 70], ["#fff200", 84, 18, 46], ["#00a2e8", 90, 70, 60], ["#a349a4", 12, 78, 52], ["#22b14c", 70, 88, 38],
    ] as const;
    return (
      <div className="oc-motif" aria-hidden>
        {splashes.map(([c, x, y, s], i) => (
          <svg key={i} viewBox="0 0 100 100" className="oc-splash" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${i * 0.7}s` }}>
            <path d="M50 8c10 0 12 14 22 12s16 8 10 18 10 16 0 24-4 22-16 18-14 12-22 4-20 2-22-10S8 58 14 48 6 30 18 26s22-18 32-18z" fill={c} opacity=".35" />
          </svg>
        ))}
        {/* Paint droplets rising */}
        {["#ff7a59", "#00a2e8", "#fff200", "#22b14c", "#a349a4", "#ff7a59", "#ffaec9"].map((c, i) => (
          <span key={`d${i}`} className="oc-droplet" style={{ left: `${10 + i * 13}%`, background: c, animationDelay: `${i * 1.3}s`, animationDuration: `${9 + (i % 3) * 3}s` }} />
        ))}
        <svg viewBox="0 0 1000 200" className="oc-stroke oc-stroke-2" preserveAspectRatio="none">
          <path d="M0 60 C 200 140, 420 10, 620 90 S 900 160, 1000 70" fill="none" stroke="#00a2e8" strokeWidth="6" strokeLinecap="round" opacity=".12" />
        </svg>
        <svg viewBox="0 0 1000 200" className="oc-stroke" preserveAspectRatio="none">
          <path d="M20 150 C 220 40, 380 190, 560 90 S 880 60, 980 120" fill="none" stroke="var(--oc-sketch)" strokeWidth="10" strokeLinecap="round" opacity=".18" />
        </svg>
      </div>
    );
  }
  if (kind === "docs") {
    return (
      <div className="oc-motif" aria-hidden>
        {[8, 22, 78, 90, 55].map((x, i) => (
          <svg key={i} viewBox="0 0 30 40" className="oc-floatpage" style={{ left: `${x}%`, animationDelay: `${i * 2.4}s`, animationDuration: `${16 + i * 3}s` }}>
            <rect x="1" y="1" width="28" height="38" rx="2" fill="#fff" opacity=".1" stroke="var(--oc-docs)" strokeOpacity=".35" />
            {[8, 13, 18, 23, 28].map((y) => <rect key={y} x="5" y={y} width={y === 8 ? 14 : 20} height="1.6" rx=".8" fill="var(--oc-docs-light)" opacity=".35" />)}
          </svg>
        ))}
      </div>
    );
  }
  // Percent coordinates on an unstretched SVG: dots stay round, lines stay thin.
  const nodes = [[8, 18], [20, 9], [17, 34], [6, 52], [86, 14], [94, 32], [80, 58], [91, 76], [74, 88], [12, 84], [26, 70]] as const;
  const links = [[0, 1], [0, 2], [2, 3], [4, 5], [5, 6], [6, 7], [7, 8], [9, 10], [3, 9]];
  return (
    <svg className="oc-motif oc-netmotif" aria-hidden>
      {links.map(([a, b], i) => (
        <line key={i} x1={`${nodes[a][0]}%`} y1={`${nodes[a][1]}%`} x2={`${nodes[b][0]}%`} y2={`${nodes[b][1]}%`} style={{ animationDelay: `${i * 0.5}s` }} />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={`${x}%`} cy={`${y}%`} r={i % 3 === 0 ? 4 : 3} style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
    </svg>
  );
}
