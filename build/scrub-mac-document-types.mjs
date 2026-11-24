// Drops image and SVG document types from a macOS Info.plist object (the JSON form `plutil
// -convert json` produces). Chromium's stock app-Info.plist (156, and earlier) lists Enki as a
// Viewer for GIF, JPEG, PNG, SVG, WebP and AVIF; that is what made Finder show Enki's icon on
// SVG files. Linux already claims only HTML and http(s). The Windows counterpart is
// launcher/DefaultBrowser.cs.
//
// Used by build/build-mac.mjs before signing, and by test/mac-document-types.mjs on any OS.
// UTImportedTypeDeclarations (type catalogs, not handler claims) and CFBundleURLTypes (http,
// https, file) are left alone. PDF, HTML, XHTML, MHTML and the other non-image document types
// stay.

/** UTIs Chromium 156 claims as image document types, plus public.image as a catch-all. */
export const IMAGE_UTIS = new Set([
  "public.svg-image",
  "public.png",
  "public.jpeg",
  "com.compuserve.gif",
  "org.webmproject.webp",
  "public.avif",
  "public.image",
  "public.heic",
  "public.heif",
  "public.tiff",
  "com.microsoft.bmp",
  "com.microsoft.ico",
]);

export const IMAGE_EXTENSIONS = new Set([
  "svg", "svgz", "webp", "png", "gif", "jpg", "jpeg", "jpe", "bmp", "ico", "avif", "heic", "heif", "tif", "tiff",
]);

const list = (value) => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const normExt = (value) => String(value).replace(/^\./, "").toLowerCase();

export function isImageDocumentType(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (list(entry.LSItemContentTypes).some((t) => IMAGE_UTIS.has(String(t)))) return true;
  if (list(entry.CFBundleTypeExtensions).some((e) => IMAGE_EXTENSIONS.has(normExt(e)))) return true;
  if (list(entry.CFBundleTypeMIMETypes).some((m) => /^image\//i.test(String(m)))) return true;
  return false;
}

export function documentTypeContentTypes(entry) {
  return list(entry?.LSItemContentTypes).map(String);
}

/** Mutates `plist` and returns { removed, kept, droppedTypes }. */
export function scrubMacInfoPlist(plist) {
  const types = Array.isArray(plist?.CFBundleDocumentTypes) ? plist.CFBundleDocumentTypes : [];
  const droppedTypes = [];
  const kept = [];
  let removed = 0;
  for (const entry of types) {
    if (isImageDocumentType(entry)) {
      removed++;
      const names = documentTypeContentTypes(entry);
      droppedTypes.push(...(names.length ? names : list(entry.CFBundleTypeExtensions).map(String)));
    } else kept.push(entry);
  }
  if (Array.isArray(plist?.CFBundleDocumentTypes)) plist.CFBundleDocumentTypes = kept;
  return { removed, kept: kept.length, droppedTypes };
}

export function claimedImageDocumentTypes(plist) {
  const types = Array.isArray(plist?.CFBundleDocumentTypes) ? plist.CFBundleDocumentTypes : [];
  return types.filter(isImageDocumentType).flatMap(documentTypeContentTypes);
}

export function hasWebDocumentClaims(plist) {
  const claimed = new Set(
    (Array.isArray(plist?.CFBundleDocumentTypes) ? plist.CFBundleDocumentTypes : []).flatMap(documentTypeContentTypes),
  );
  const schemes = new Set(
    (Array.isArray(plist?.CFBundleURLTypes) ? plist.CFBundleURLTypes : []).flatMap((e) => list(e?.CFBundleURLSchemes).map(String)),
  );
  return claimed.has("public.html") && claimed.has("public.xhtml") && claimed.has("com.adobe.pdf")
    && schemes.has("http") && schemes.has("https");
}
