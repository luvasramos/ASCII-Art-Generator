import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";

export const mountApp = () => {
  console.info("main.tsx loaded");

  const root = document.getElementById("root");

  if (!root) {
    const fallback = document.createElement("main");
    fallback.style.cssText =
      "min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f4f1e8;font:16px system-ui;padding:24px;";
    fallback.textContent = "ASCII Rendering Studio could not find #root in index.html.";
    document.body.appendChild(fallback);
    return;
  }

  console.info("React mounting");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  document.body.dataset.appMounted = "true";
};
