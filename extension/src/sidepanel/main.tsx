import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { incognitoRedirect } from "../lib/legacy-search";

// Incognito: straight to DuckDuckGo before anything renders, reads storage, or reaches the model.
const away = incognitoRedirect(location.search, chrome.extension.inIncognitoContext);
if (away) location.replace(away);
else createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
