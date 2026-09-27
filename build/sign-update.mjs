// Writes update.json and its signature next to a release zip.
//
//   UPDATE_SIGNING_KEY="<PEM>" node build/sign-update.mjs out/EnkiBrowser-X-windows-x64.zip <download url>
//
// The launcher accepts an update only if update.json verifies against the public key compiled
// into it, and only installs the zip whose SHA-256 this manifest names. In CI the private key is
// the UPDATE_SIGNING_KEY repository secret and never touches the repository.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [zip, url] = process.argv.slice(2);
if (!zip || !url) throw new Error("usage: sign-update.mjs <zip> <download url>");
const pem = process.env.UPDATE_SIGNING_KEY ?? (process.env.UPDATE_SIGNING_KEY_FILE && readFileSync(process.env.UPDATE_SIGNING_KEY_FILE, "utf8"));
if (!pem) throw new Error("UPDATE_SIGNING_KEY (or UPDATE_SIGNING_KEY_FILE) is not set.");
const key = createPrivateKey(pem);

// The version inside the zip is the one that gets installed, so the manifest takes it from there
// rather than from a tag name or an argument that could disagree.
const version = /EnkiBrowser-(\d+\.\d+\.\d+)-windows-x64\.zip$/.exec(path.basename(zip))?.[1];
if (!version) throw new Error(`Cannot read a version from ${path.basename(zip)}`);
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");

const manifest = Buffer.from(JSON.stringify({ version, url, sha256, published: new Date().toISOString() }, null, 2) + "\n");
const signature = sign("sha256", manifest, key);
// Refuse to publish a signature the paired public key would reject (wrong secret, wrong key file).
const pub = process.env.UPDATE_PUBLIC_KEY_FILE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "update-signing.pub");
if (!verify("sha256", manifest, createPublicKey(readFileSync(pub)), signature)) {
  throw new Error(`The signing key does not match ${pub}; the launcher would reject this update.`);
}
const dir = path.dirname(zip);
writeFileSync(path.join(dir, "update.json"), manifest);
writeFileSync(path.join(dir, "update.json.sig"), signature.toString("base64") + "\n");
console.log(`signed update.json for ${version} (${sha256})`);
