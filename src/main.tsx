import "./lib/fonts";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Browser reload and page keys do nothing useful in a desktop app (kept in dev for reloading).
if (import.meta.env.PROD) {
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "f5" || ((e.ctrlKey || e.metaKey) && (key === "r" || key === "u"))) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
