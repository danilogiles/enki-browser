import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The panel's stylesheet comes FIRST and Home's second, on purpose: Home now mounts the chat in
// place, which needs the panel's colour tokens, while Home keeps its own typography — and in
// Tailwind v4 the last @theme to define a name wins. The only name both define is --font-sans.
import "../sidepanel/index.css";
import "./home.css";
import { Home } from "./Home";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
