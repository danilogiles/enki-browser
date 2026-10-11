// Runs before anything else on search.html. DuckDuckGo users (and anyone who has not chosen)
// leave here, before React, providers or styles load; only Enki answers load the app.
import { earlyRoute } from "../lib/search";

void earlyRoute({
  href: location.href,
  incognito: !!chrome.extension?.inIncognitoContext,
  storageGet: (keys) => chrome.storage.local.get(keys),
  replace: (url) => location.replace(url),
}).then(async ({ route }) => {
  if (route === "enki") (await import("./app")).mount();
});
