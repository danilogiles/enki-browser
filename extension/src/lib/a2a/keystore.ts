/**
 * Receive tabs (0.9): where the browser's keys live. IndexedDB, because it stores CryptoKey
 * objects as they are: the private keys are generated non-extractable and no code can read their
 * bytes, not even Enki's own. One record per paired agent (its own fresh browser keys) plus at most
 * one pairing in progress. Unpairing deletes that agent's record only.
 */
const DB = "enki-a2a";
const STORE = "keys";

export type BrowserKeys = {
  edPrivate: CryptoKey;
  xPrivate: CryptoKey;
  edPub: Uint8Array;
  xPub: Uint8Array;
};

export type PairingRecord = BrowserKeys & {
  id: "pairing";
  code: string;
  exp: number;
  nB: Uint8Array;
  boxes: { browser: string; agent: string };
  step: "waiting" | "offered" | "confirm" | "failed";
  commitment?: Uint8Array;
  candidate?: { name: string; fingerprint: string; agentId: string; agentEdPub: Uint8Array; agentXPub: Uint8Array };
  error?: string;
};

export type AgentKeysRecord = BrowserKeys & { id: string };

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const getPairing = () => run<PairingRecord | undefined>("readonly", (s) => s.get("pairing"));
export const putPairing = (r: PairingRecord) => run<void>("readwrite", (s) => s.put(r));
export const deletePairing = () => run<void>("readwrite", (s) => s.delete("pairing"));
export const getAgentKeys = (id: string) => run<AgentKeysRecord | undefined>("readonly", (s) => s.get(id));
export const putAgentKeys = (r: AgentKeysRecord) => run<void>("readwrite", (s) => s.put(r));
export const deleteAgentKeys = (id: string) => run<void>("readwrite", (s) => s.delete(id));
export const allKeyIds = () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
