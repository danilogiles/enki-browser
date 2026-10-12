// The stop between a tracking redirect and the page it points to (rules/debounce.json).
//
// Links such as google.com/url?q=… or l.facebook.com/l.php?u=… send the visit through the
// tracker before the real page. Enki Shield's rules send them here instead, with the destination
// as ?u=, so the tracker is never contacted. Declarative rules cannot decode the destination
// (it arrives percent-encoded), so this page does, and goes on only to an http(s) address.
const u = new URLSearchParams(location.search).get("u");
let target = null;
try {
  const url = new URL(u ?? "");
  if (url.protocol === "https:" || url.protocol === "http:") target = url.href;
} catch { /* not an address */ }
if (target) location.replace(target);
else document.getElementById("note").textContent = "This link's destination could not be read, so it was not opened.";
