import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyDensity, applyTheme, loadDensity, loadTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/packs.css";
import "./styles/app-catalog.css";
import "./styles/density.css";

// Apply the saved theme and density before first paint so there is no flash or reflow.
applyTheme(loadTheme());
applyDensity(loadDensity());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
