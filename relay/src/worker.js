/**
 * Cloudflare Workers entry for the Enki relay (see README.md; nothing here is deployed by the
 * repository). One Durable Object per mailbox holds its envelopes in the object's own storage and
 * deletes them on fetch or after 10 minutes (an alarm sweeps expired ones). Durable Objects with
 * SQLite storage are on Cloudflare's free plan; KV would not fit it (its free daily write and list
 * quotas are far below one poll a minute).
 *
 * No console logging anywhere; wrangler.toml turns Workers Logs off.
 */
import { DurableObject } from "cloudflare:workers";
import { createHandler } from "./handler.js";

export class Mailbox extends DurableObject {
  async push(text, { now, expiresAt, maxPerMailbox }) {
    const entries = await this.ctx.storage.list({ prefix: "e:" });
    const expired = [...entries].filter(([, v]) => v.expiresAt <= now).map(([k]) => k);
    if (expired.length) await this.ctx.storage.delete(expired);
    if (entries.size - expired.length >= maxPerMailbox) return false;
    const key = `e:${String(now).padStart(15, "0")}:${crypto.randomUUID()}`;
    await this.ctx.storage.put(key, { text, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
    return true;
  }
  async take(now) {
    const entries = await this.ctx.storage.list({ prefix: "e:" });
    await this.ctx.storage.deleteAll();
    return [...entries.values()].filter((v) => v.expiresAt > now).map((v) => v.text);
  }
  async clear() {
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const now = Date.now();
    const entries = await this.ctx.storage.list({ prefix: "e:" });
    const expired = [...entries].filter(([, v]) => v.expiresAt <= now).map(([k]) => k);
    if (expired.length) await this.ctx.storage.delete(expired);
    const next = [...entries.values()].filter((v) => v.expiresAt > now).map((v) => v.expiresAt);
    if (next.length) await this.ctx.storage.setAlarm(Math.min(...next));
    else await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const stub = (id) => env.MAILBOX.get(env.MAILBOX.idFromName(id));
    const store = {
      push: (id, text, opts) => stub(id).push(text, opts),
      take: (id, now) => stub(id).take(now),
      clear: (id) => stub(id).clear(),
    };
    return createHandler(store)(request);
  },
};
