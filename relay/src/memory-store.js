// In-memory store for the Node relay and the tests. Nothing is written to disk.
export function createMemoryStore() {
  const boxes = new Map(); // id → [{ text, expiresAt }]
  const live = (id, now) => {
    const list = (boxes.get(id) ?? []).filter((e) => e.expiresAt > now);
    if (list.length) boxes.set(id, list); else boxes.delete(id);
    return list;
  };
  return {
    async push(id, text, { now, expiresAt, maxPerMailbox }) {
      const list = live(id, now);
      if (list.length >= maxPerMailbox) return false;
      list.push({ text, expiresAt });
      boxes.set(id, list);
      return true;
    },
    async take(id, now) {
      const list = live(id, now);
      boxes.delete(id);
      return list.map((e) => e.text);
    },
    async clear(id) { boxes.delete(id); },
    /** Drops everything expired; the Node server calls it every minute. */
    sweep(now) { for (const id of [...boxes.keys()]) live(id, now); },
    size() { return boxes.size; },
  };
}
