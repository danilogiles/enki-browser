// The deliver_tabs tool: validate, frame, seal, POST. The extension enforces the real limits
// (5 packets an hour per agent, 3 pending notices); the local limit here only stops a looping
// agent from spending its quota on packets Enki will drop anyway.
import { formatErrors, limits, sealBundle, validateBundle } from "./shared.js";
import { postToRelay } from "./relay.js";

export const TOOL_NAME = "deliver_tabs";

export const TOOL_DESCRIPTION = [
  "Send the user a bundle of 1-10 web links, with a short title and an optional plain-text summary, to open as a tab group in Enki Browser.",
  "Enki shows a notice first and opens nothing unless the user accepts; each tab then waits on a hold page until the user clicks Open.",
  "Title, summary and labels are shown as plain text (no Markdown, no HTML) and are never treated as instructions to Enki's assistant.",
  "Only http and https links, without user:password@. At most 5 bundles an hour.",
  "You will not learn whether the user accepted, declined or opened anything.",
].join(" ");

export class HourlyLimit {
  constructor(max, windowMs = 3_600_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.sent = [];
  }
  /** Milliseconds until a slot frees up, or 0 if one is free now. */
  waitMs(now) {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    return this.sent.length < this.max ? 0 : this.sent[0] + this.windowMs - now;
  }
  record(now) {
    this.sent.push(now);
  }
  release(now) {
    const i = this.sent.lastIndexOf(now);
    if (i >= 0) this.sent.splice(i, 1);
  }
}

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export function createDeliverTabs({ config, fetchImpl, now = () => Date.now(), log = () => {} }) {
  const limit = new HourlyLimit(limits.maxBundlesPerHourPerAgent);

  return async function deliverTabs(args) {
    if (!config.ok) return text(`Enki is not set up for this agent: ${config.error}`, true);

    const result = validateBundle(args ?? {});
    if (!result.ok) {
      log("rejected", { errors: result.errors.map((e) => `${e.path}:${e.code}`) });
      return text(`The bundle was not sent:\n${formatErrors(result.errors)}`, true);
    }

    const t = now();
    const wait = limit.waitMs(t);
    if (wait > 0) {
      log("rate_limited", { waitMs: wait });
      return text(`The bundle was not sent: at most ${limit.max} bundles an hour. Try again in ${Math.ceil(wait / 60000)} min.`, true);
    }

    // Hold the slot while sealing and posting, so concurrent calls cannot overshoot the limit.
    limit.record(t);
    let sealed;
    try {
      sealed = await sealBundle(result.bundle, { sealer: config.sealer, limits, now: t });
    } catch (e) {
      limit.release(t);
      log("seal_failed", { error: e instanceof Error ? e.message : "error" });
      return text("The bundle was not sent: it could not be sealed.", true);
    }

    const sent = await postToRelay({ relayUrl: config.relayUrl, mailbox: config.mailbox, wire: sealed.wire, fetchImpl });
    log(sent.ok ? "sent" : "relay_failed", { links: result.bundle.links.length, bytes: sealed.wire.length, status: sent.status });
    if (!sent.ok) {
      limit.release(t);
      return text(`The bundle was not sent: ${sent.message}`, true);
    }

    const n = result.bundle.links.length;
    const dropped = result.warnings.filter((w) => w.code === "duplicate").length;
    return text(
      `Sent "${result.bundle.title}" with ${n} link${n === 1 ? "" : "s"} to Enki` +
        (dropped ? ` (${dropped} duplicate${dropped === 1 ? "" : "s"} dropped)` : "") +
        ". The user decides in Enki whether to open it; you will not be told what they chose. The packet expires in 10 minutes if Enki does not pick it up.",
    );
  };
}
