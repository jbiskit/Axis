import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyDensity, applyTheme, loadDensity, loadTheme } from "./lib/theme";
// IBM Plex, bundled so the desktop app works offline; only the weights the tokens use.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
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
