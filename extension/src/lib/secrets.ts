/**
 * API keys and app tokens are stored encrypted (AES-256-GCM), never as plain text.
 *
 * chrome.storage.local is a LevelDB folder in the browser profile, readable by anything that can
 * read the user's files; credential stealers grep such folders for "sk-…" and "nvapi-…". Here the
 * stored value is "enc:v1:<iv>:<ciphertext>", and the AES key is a Web Crypto key created
 * non-extractable and kept in this extension's IndexedDB: page scripts and other extensions
 * cannot reach it, and no code, ours included, can export it.
 *
 * What this does not stop: malware already running as the user with the whole profile in hand
 * can still recover the key, because Chromium keeps IndexedDB on disk too. Only the operating
 * system's keychain resists that, and extensions have no access to it (the browser's own saved
 * passwords use it). Reading a stored secret still needs this extension's own code.
 */

const PREFIX = "enc:v1:";
const DB = "enki-secrets";
const STORE = "keys";
const ID = "aes-gcm-v1";

let keyPromise: Promise<CryptoKey> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const db = await openDb();
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(ID);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await new Promise<void>((resolve, reject) => {
      // add, not put: if another page of the extension created one at the same moment, keep theirs.
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).add(created, ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }).catch(() => undefined);
    const stored = await new Promise<CryptoKey | undefined>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(ID);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => resolve(undefined);
    });
    return stored ?? created;
  })();
  return keyPromise;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const isEncrypted = (value: unknown): boolean => typeof value === "string" && value.startsWith(PREFIX);

export async function encrypt(plain: string): Promise<string> {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return `${PREFIX}${b64(iv)}:${b64(data)}`;
}

/** Plain text (written before encryption existed) is returned as is, to be re-saved encrypted. */
export async function decrypt(stored: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  const [iv, data] = stored.slice(PREFIX.length).split(":");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(data));
    return new TextDecoder().decode(plain);
  } catch {
    // The key is gone (the extension's storage was cleared) or the value was tampered with: the
    // user enters the key again rather than Enki sending garbage to the provider.
    return "";
  }
}
