// The schema and the validation/framing code live once in the repository and are shared with the
// extension; this server runs from a checkout of enki-browser and imports them in place.
import { readFileSync } from "node:fs";
import { createBundleValidator, limitsFromSchema } from "../../extension/src/lib/a2a/validate-bundle.js";

export const SCHEMA_PATH = new URL("../../protocol/deliver_tabs.schema.json", import.meta.url);
export const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
export const validateBundle = createBundleValidator(schema);
export const limits = limitsFromSchema(schema);

/**
 * The schema as an MCP tool inputSchema: Enki-internal limits (x-enki) and the schema's own
 * identifiers removed, because some MCP clients forward the schema to model providers that reject
 * unknown keywords.
 */
export function toolInputSchema() {
  const copy = structuredClone(schema);
  for (const key of ["$schema", "$id", "title", "x-enki"]) delete copy[key];
  return copy;
}

export { formatErrors } from "../../extension/src/lib/a2a/validate-bundle.js";
export { sealBundle } from "../../extension/src/lib/a2a/envelope.js";
export { decodeCredential, sealerFromCredential, TABS_ALG } from "../../extension/src/lib/a2a/crypto.js";
