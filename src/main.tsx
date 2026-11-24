import "./lib/fonts";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { trackKeyboardMode } from "./lib/overlay";

// Browser reload and page keys do nothing useful in a desktop app (kept in dev for reloading).
if (import.meta.env.PROD) {
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "f5" || ((e.ctrlKey || e.metaKey) && (key === "r" || key === "u"))) e.preventDefault();
  });
}

trackKeyboardMode();
// Pen hover: Windows draws a white dot that vanishes on light pages, so swap in our own cursor (see .oc-pen in index.css).
window.addEventListener("pointermove", (e) => document.documentElement.classList.toggle("oc-pen", e.pointerType === "pen"), { passive: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
