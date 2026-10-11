import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./search.css";
import { SearchPage } from "./SearchPage";

export function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SearchPage />
    </StrictMode>,
  );
}
