// Shields' per-site choices and its "forget this site" list name sites the user visits, so they are
// stored sealed (AES-256-GCM) rather than as readable host names. The key is a Web Crypto key made
// non-extractable and kept in this extension's own IndexedDB: other extensions and web pages
// cannot reach it, and no code can export it. (The same scheme as Enki's lib/secrets.ts.)

const PREFIX = "enc:v1:";
const DB = "shield-secrets";
const STORE = "keys";
const ID = "aes-gcm-v1";

let keyPromise = null;

function request(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

function openDb() {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

async function key() {
  keyPromise ??= (async () => {
    const db = await openDb();
    const existing = await request(db.transaction(STORE).objectStore(STORE).get(ID));
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // add, not put: if another page of the extension made one at the same moment, keep theirs.
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).add(created, ID)).catch(() => undefined);
    return (await request(db.transaction(STORE).objectStore(STORE).get(ID))) ?? created;
  })();
  return keyPromise;
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const isSealed = (value) => typeof value === "string" && value.startsWith(PREFIX);

/** Any JSON value → "enc:v1:<iv>:<ciphertext>". */
export async function seal(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(value))));
  return `${PREFIX}${b64(iv)}:${b64(data)}`;
}

/** Back to the JSON value; a plain value (stored before sealing) is returned as is. */
export async function unseal(stored, fallback) {
  if (stored === undefined || stored === null) return fallback;
  if (!isSealed(stored)) return stored;
  try {
    const [iv, data] = stored.slice(PREFIX.length).split(":");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return fallback; // key gone (storage cleared) or tampered: start over rather than guess
  }
}
