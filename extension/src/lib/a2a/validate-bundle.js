/**
 * Validates a "Receive tabs" bundle (Enki 0.9): the payload an agent sends with the MCP tool
 * `deliver_tabs`. Dependency-free ES module so the extension and the MCP server (mcp/) run the
 * same code, against the same schema file: protocol/deliver_tabs.schema.json.
 *
 * Why a hand-written checker and not a JSON Schema library: the extension keeps dependencies
 * minimal, and this checker interprets only the keywords that schema uses. It throws on any other
 * validation keyword, so a schema change can never be silently ignored here (see the tests).
 *
 * Everything in a bundle is untrusted data from outside the browser:
 * - title, summary and labels are plain text. They are normalized (control characters and bidi
 *   overrides/isolates removed) and returned as strings; nothing here interprets HTML, Markdown or
 *   instructions, and callers must render them with textContent and never feed them to the
 *   assistant as instructions.
 * - links are http/https only, without credentials, control characters or whitespace, at most
 *   2048 characters, deduplicated. Each one carries its ASCII (punycode) hostname for display so
 *   lookalike IDN domains are visible.
 * The validator does not check Enki Shield: the receiving side runs every link through Shield
 * before showing the notice, and one blocked link rejects the whole bundle (threat model §3).
 *
 * Usage:
 *   const validate = createBundleValidator(schema);   // schema = parsed deliver_tabs.schema.json
 *   const { ok, errors, warnings, bundle } = validate(input);
 */

// Keywords that only describe; everything else in the schema must be understood below.
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "x-enki"]);
const KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items",
  "minItems", "maxItems", "minLength", "maxLength", "pattern",
]);

// Bidi embeddings/overrides (U+202A–202E), isolates (U+2066–2069), marks (U+200E, U+200F,
// U+061C): they can reorder what the user reads ("moc.elgoog" shown as "google.com").
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
// Invisible characters that hide or disguise text: zero-width space, word joiner and invisible
// operators, BOM, soft hyphen, interlinear annotation marks. ZWJ/ZWNJ (U+200C/U+200D) stay
// because emoji sequences and some scripts need them.
const INVISIBLE = /[\u200B\u2060-\u2064\uFEFF\u00AD\uFFF9-\uFFFB]/g;
// C0 and C1 controls and DEL, after the allowed line breaks are turned into something else.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const LINE_BREAKS = /\r\n|[\r\u2028\u2029\u0085\u000B\u000C]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// In a URL nothing invisible or reorderable is acceptable: reject instead of cleaning, so the
// link Enki opens is exactly the one that was checked.
const URL_FORBIDDEN = /[\u0000-\u0020\u007F-\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u206F\u3000\uFEFF\uFFF9-\uFFFB\uD800-\uDFFF]/;

const DEFAULT_MAX_URL_LENGTH = 2048;

/** Number of Unicode code points, which is what JSON Schema's minLength/maxLength count. */
export function codePointLength(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Plain-text normalization for title and label (`multiline: false`) and summary (`true`).
 * Removes controls, bidi overrides/isolates and invisible characters; never interprets markup.
 */
export function normalizeText(value, { multiline = false } = {}) {
  let s = String(value).replace(LONE_SURROGATE, "").normalize("NFC");
  s = s.replace(LINE_BREAKS, "\n").replace(/\t/g, " ");
  if (!multiline) s = s.replace(/\n/g, " ");
  s = s.replace(BIDI, "").replace(INVISIBLE, "");
  s = multiline ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "") : s.replace(CONTROL, "");
  if (multiline) {
    s = s.split("\n").map((line) => line.replace(/[ \u00A0]+/g, " ").trimEnd()).join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    s = s.replace(/\s+/g, " ");
  }
  return s.trim();
}

/**
 * Checks one link URL. Returns { ok: true, url, host, idn } with the parsed, normalized href and
 * the ASCII hostname, or { ok: false, code, message }.
 */
export function checkUrl(raw, { maxLength = DEFAULT_MAX_URL_LENGTH } = {}) {
  if (typeof raw !== "string") return fail("type", "must be a string");
  // Only leading/trailing ASCII spaces are forgiven (models add them); anything inside is refused.
  const s = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (!s) return fail("empty", "must not be empty");
  if (s.length > maxLength) return fail("too_long", `must be at most ${maxLength} characters`);
  if (URL_FORBIDDEN.test(s)) return fail("bad_chars", "must not contain spaces, control, invisible or bidi characters");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s);
  if (!scheme) return fail("not_absolute", "must be an absolute http:// or https:// URL");
  const name = scheme[1].toLowerCase();
  if (name !== "http" && name !== "https") return fail("scheme", `scheme "${name}:" is not allowed; only http and https`);
  if (!/^https?:\/\//i.test(s)) return fail("not_absolute", "must start with http:// or https://");
  // Any "@" in the authority is a credential separator, even "https://@host" or "https://:@host",
  // which the URL parser would quietly accept with empty credentials.
  const authority = s.slice(s.indexOf("//") + 2).split(/[/?#\\]/, 1)[0];
  if (authority.includes("@")) return fail("credentials", "must not contain credentials (user:password@)");
  let u;
  try {
    u = new URL(s);
  } catch {
    return fail("invalid", "is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("scheme", "only http and https are allowed");
  if (u.username || u.password) return fail("credentials", "must not contain credentials (user:password@)");
  if (!u.hostname) return fail("no_host", "must have a host name");
  // WHATWG URL already turns IDN hosts into punycode (xn--); that ASCII form is what Enki shows.
  const host = u.hostname.toLowerCase();
  if (u.href.length > maxLength) return fail("too_long", `must be at most ${maxLength} characters once normalized`);
  return { ok: true, url: u.href, host, idn: host.split(".").some((label) => label.startsWith("xn--")) };
}

function fail(code, message) {
  return { ok: false, code, message };
}

/** The limits block (`x-enki`) plus the per-field limits, read from the schema. */
export function limitsFromSchema(schema) {
  const p = schema?.properties;
  const link = p?.links?.items?.properties;
  const x = schema?.["x-enki"];
  if (!p || !link || !x) throw new Error("deliver_tabs schema: missing properties or x-enki block");
  return Object.freeze({
    maxTitle: p.title.maxLength,
    maxSummary: p.summary.maxLength,
    minLinks: p.links.minItems,
    maxLinks: p.links.maxItems,
    maxUrlLength: link.url.maxLength,
    maxLabel: link.label.maxLength,
    maxBundleBytes: x.maxBundleBytes,
    maxBundlesPerHourPerAgent: x.maxBundlesPerHourPerAgent,
    maxPendingNotices: x.maxPendingNotices,
    relayTtlSeconds: x.relayTtlSeconds,
    maxPacketAgeSeconds: x.maxPacketAgeSeconds,
    maxClockSkewSeconds: x.maxClockSkewSeconds,
    maxEnvelopeBytes: x.envelope.maxBytes,
    paddedFrameBytes: x.envelope.paddedFrameBytes,
  });
}

/** Throws if the schema uses a validation keyword this checker does not implement. */
export function assertSupportedSchema(node, path = "#") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) throw new Error(`${path}: schema must be an object`);
  for (const key of Object.keys(node)) {
    if (ANNOTATIONS.has(key)) continue;
    if (!KEYWORDS.has(key)) throw new Error(`${path}: unsupported schema keyword "${key}"`);
  }
  if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
    throw new Error(`${path}: only "additionalProperties": false is supported`);
  }
  for (const [name, sub] of Object.entries(node.properties ?? {})) assertSupportedSchema(sub, `${path}/properties/${name}`);
  if (node.items !== undefined) assertSupportedSchema(node.items, `${path}/items`);
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Structural check of `value` against the schema subset; pushes { path, code, message }. */
function checkNode(node, value, path, errors) {
  const actual = typeOf(value);
  if (node.type && node.type !== actual) {
    errors.push({ path, code: "type", message: `must be ${node.type === "array" ? "an" : "a"} ${node.type}, got ${actual}` });
    return;
  }
  if (actual === "object") {
    const props = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ path: join(path, key), code: "required", message: "is required" });
    }
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) checkNode(props[key], value[key], join(path, key), errors);
      else if (node.additionalProperties === false) errors.push({ path: join(path, key), code: "unknown_field", message: "is not an allowed field" });
    }
  } else if (actual === "array") {
    if (node.minItems !== undefined && value.length < node.minItems) errors.push({ path, code: "min_items", message: `must have at least ${node.minItems} item(s)` });
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push({ path, code: "max_items", message: `must have at most ${node.maxItems} items` });
    // Do not walk an oversized array: a 10 000-link bundle is refused by its count alone.
    if (node.items && (node.maxItems === undefined || value.length <= node.maxItems)) {
      value.forEach((item, i) => checkNode(node.items, item, `${path}[${i}]`, errors));
    }
  } else if (actual === "string") {
    const len = codePointLength(value);
    if (node.minLength !== undefined && len < node.minLength) errors.push({ path, code: "min_length", message: `must be at least ${node.minLength} character(s)` });
    if (node.maxLength !== undefined && len > node.maxLength) errors.push({ path, code: "max_length", message: `must be at most ${node.maxLength} characters` });
    if (node.pattern !== undefined && !new RegExp(node.pattern, "u").test(value)) errors.push({ path, code: "pattern", message: `must match ${node.pattern}` });
  }
}

const join = (path, key) => (path ? `${path}.${key}` : key);

/**
 * Builds the validator for a parsed deliver_tabs.schema.json.
 * The returned function never throws on bad input; it returns
 *   { ok: true,  errors: [], warnings, bundle }  or  { ok: false, errors, warnings, bundle: null }
 * where bundle = { title, summary?, links: [{ url, label?, host, idn }] }, a fresh object that
 * shares nothing with the input.
 */
export function createBundleValidator(schema) {
  assertSupportedSchema(schema);
  const limits = limitsFromSchema(schema);

  return function validateBundle(input) {
    const errors = [];
    const warnings = [];
    checkNode(schema, input, "", errors);
    // URL rules run on every link even when something else is wrong, so all problems come back
    // at once; a URL that failed the schema's pattern gets the more precise reason (scheme,
    // credentials…) instead of "must match ^https?://".
    const urls = urlChecks(input, limits);
    for (const [i, checked] of urls) {
      if (checked.ok) continue;
      const path = `links[${i}].url`;
      const k = errors.findIndex((e) => e.path === path);
      if (k < 0) errors.push({ path, code: checked.code, message: checked.message });
      else if (errors[k].code === "pattern") errors[k] = { path, code: checked.code, message: checked.message };
    }
    if (errors.length) return { ok: false, errors, warnings, bundle: null };

    const title = normalizeText(input.title);
    if (!title) errors.push({ path: "title", code: "empty", message: "is empty once control and invisible characters are removed" });
    const out = { title };
    if (input.summary !== undefined) {
      const summary = normalizeText(input.summary, { multiline: true });
      if (summary) out.summary = summary;
    }
    out.links = [];

    const seen = new Set();
    for (const [i, checked] of urls) {
      if (seen.has(checked.url)) {
        warnings.push({ path: `links[${i}].url`, code: "duplicate", message: "duplicate link dropped" });
        continue;
      }
      seen.add(checked.url);
      const entry = { url: checked.url, host: checked.host, idn: checked.idn };
      const rawLabel = input.links[i].label;
      if (rawLabel !== undefined) {
        const label = normalizeText(rawLabel);
        if (label) entry.label = label;
      }
      out.links.push(entry);
    }

    if (!errors.length) {
      const bytes = new TextEncoder().encode(JSON.stringify(out)).length;
      if (bytes > limits.maxBundleBytes) {
        errors.push({ path: "", code: "too_large", message: `bundle is ${bytes} bytes; at most ${limits.maxBundleBytes} fit in one packet (shorten the summary or the links)` });
      }
    }
    return errors.length ? { ok: false, errors, warnings, bundle: null } : { ok: true, errors, warnings, bundle: out };
  };
}

/** [index, checkUrl result] for each link whose url is a string, when the link count is sane. */
function urlChecks(input, limits) {
  const list = typeOf(input) === "object" ? input.links : undefined;
  if (!Array.isArray(list) || list.length > limits.maxLinks) return [];
  const out = [];
  list.forEach((link, i) => {
    if (typeOf(link) === "object" && typeof link.url === "string") out.push([i, checkUrl(link.url, { maxLength: limits.maxUrlLength })]);
  });
  return out;
}

/** One line per error, for tool results and logs that must not echo the payload itself. */
export function formatErrors(errors) {
  return errors.map((e) => `${e.path || "bundle"}: ${e.message}`).join("\n");
}
