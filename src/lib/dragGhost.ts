/**
 * Notion's drag preview: a compact, slightly translucent pill (icon + title)
 * under the cursor instead of the browser's screenshot of the whole row.
 */
export function setDragGhost(e: React.DragEvent, icon: string, title: string) {
  const ghost = document.createElement("div");
  ghost.className = "oc-drag-ghost";
  const i = document.createElement("span");
  i.textContent = icon;
  const t = document.createElement("span");
  t.textContent = title || "Untitled";
  ghost.append(i, t);
  document.body.appendChild(ghost);
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setDragImage(ghost, 14, 14);
  // The browser snapshots it synchronously; the node can go on the next frame.
  requestAnimationFrame(() => ghost.remove());
}

/** Briefly highlights an element where something was just dropped. */
export function flashLanded(selector: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.classList.remove("oc-landed");
      void el.offsetWidth; // restart the animation
      el.classList.add("oc-landed");
      window.setTimeout(() => el.classList.remove("oc-landed"), 700);
    }),
  );
}
