// Test fixture: a complete pairing done in process, both sides, without a relay. Returns what
// each side keeps: the agent's credential string, and the browser's opener for that agent.
import { readFileSync } from "node:fs";
import { createOpener, mailboxIdFor, newEd25519, newPairCode, newX25519, randomBytes, rawPublic, sealerFromCredential } from "../src/lib/a2a/crypto.js";
import { agentAnswerOffer, agentCredential, agentStart, browserOffer, browserReadCommit, browserReadReveal } from "../src/lib/a2a/pairing.js";
import { createBundleValidator, limitsFromSchema } from "../src/lib/a2a/validate-bundle.js";

export const schema = JSON.parse(readFileSync(new URL("../../protocol/deliver_tabs.schema.json", import.meta.url), "utf8"));
export const validate = createBundleValidator(schema);
export const limits = limitsFromSchema(schema);

export async function pairInProcess({ relay = "http://127.0.0.1:8788", name = "Helm", code = newPairCode() } = {}) {
  const bEd = await newEd25519(false);
  const bX = await newX25519(false);
  const browser = { edPrivate: bEd.privateKey, xPrivate: bX.privateKey, edPub: await rawPublic(bEd.publicKey), xPub: await rawPublic(bX.publicKey), nB: randomBytes(32) };
  const agent = await agentStart();
  const commitment = browserReadCommit(agent.commit);
  const offer = browserOffer({ browserEdPub: browser.edPub, browserXPub: browser.xPub, nB: browser.nB });
  const answer = await agentAnswerOffer(agent, offer, { code, name });
  const seen = await browserReadReveal(answer.reveal, { browserXPrivate: browser.xPrivate, browserEdPub: browser.edPub, browserXPub: browser.xPub, nB: browser.nB, code, commitment });
  const credential = await agentCredential(agent, answer, { relay, name });
  const mailbox = await mailboxIdFor(browser.edPub);
  const opener = createOpener({ mailbox, browser, agent: { edPub: seen.agentEdPub, xPub: seen.agentXPub }, expectedFrameBytes: limits.paddedFrameBytes });
  const { sealer } = await sealerFromCredential(credential);
  return { code, browser, agent, answer, seen, credential, mailbox, opener, sealer };
}
