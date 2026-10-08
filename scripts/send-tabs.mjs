#!/usr/bin/env node
// Dev sender for Enki's Receive tabs (0.9): pairs an agent with Enki and sends tab bundles through
// the relay, using the same code as the MCP server (extension/src/lib/a2a/). Spark's mcp/ can
// mirror these two commands. No dependencies; Node 20+.
//
//   node scripts/send-tabs.mjs pair ENKI-7K2M-9QXP --name Helm [--relay http://127.0.0.1:8788] [--key-file helm.key] [--yes]
//   node scripts/send-tabs.mjs send --key-file helm.key --title "Pneu de neve" [--summary "…"] --link https://a.example[|rótulo] …
//   node scripts/send-tabs.mjs pneu --key-file helm.key          (the spec's 3 snow-tire links)
//
// The key file holds the agent's private keys: it is written 0600 and never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { normalizePairCode, sealerFromCredential } from "../extension/src/lib/a2a/crypto.js";
import { pairAgent } from "../extension/src/lib/a2a/pairing.js";
import { sealBundle } from "../extension/src/lib/a2a/envelope.js";
import { createBundleValidator, formatErrors, limitsFromSchema } from "../extension/src/lib/a2a/validate-bundle.js";

const schema = JSON.parse(readFileSync(new URL("../protocol/deliver_tabs.schema.json", import.meta.url), "utf8"));
const validate = createBundleValidator(schema);
const limits = limitsFromSchema(schema);

export const PNEU_DE_NEVE = {
  title: "Pneu de neve",
  summary: "Comparativo de pneus de inverno, guia de instalação e uma loja com estoque local.",
  links: [
    { url: "https://pneus.exemplo.com/inverno", label: "Comparativo de pneus" },
    { url: "https://guia-inverno.exemplo.com/", label: "Guia de pneus de neve" },
    { url: "https://loja.exemplo.com/pneu-neve", label: "Loja" },
  ],
};

/** Validates, seals with the agent key and POSTs one envelope. Returns { status, wire }. */
export async function sendTabs({ credential, bundle, fetchImpl = fetch, now = Date.now(), skipValidation = false }) {
  let toSend = bundle;
  if (!skipValidation) {
    const r = validate(bundle);
    if (!r.ok) throw new Error(`bundle refused:\n${formatErrors(r.errors)}`);
    toSend = r.bundle;
  }
  const { sealer, credential: c } = await sealerFromCredential(credential);
  const { wire } = await sealBundle(toSend, { sealer, limits, now });
  const status = await postWire({ relay: c.relay, mailbox: c.mailbox, wire, fetchImpl });
  return { status, wire };
}

export async function postWire({ relay, mailbox, wire, fetchImpl = fetch }) {
  const res = await fetchImpl(`${relay}/v1/mailbox/${encodeURIComponent(mailbox)}`, { method: "POST", headers: { "content-type": "application/json" }, body: wire, redirect: "error", credentials: "omit" });
  await res.arrayBuffer().catch(() => {});
  return res.status;
}

function args(argv) {
  const out = { _: [], link: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const k = a.slice(2);
    if (k === "yes" || k === "force") { out[k] = true; continue; }
    const v = argv[++i];
    if (k === "link") out.link.push(v); else out[k] = v;
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const [cmd, codeArg] = a._;
  if (cmd === "pair") {
    const code = normalizePairCode(codeArg ?? "");
    if (!code) throw new Error("usage: pair ENKI-XXXX-XXXX --name <agent name>");
    if (!a.name) throw new Error("--name is required (what Enki will show, e.g. Helm)");
    const keyFile = a["key-file"] ?? `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.enki-agent-key`;
    if (existsSync(keyFile) && !a.force) throw new Error(`${keyFile} exists; pass --force to replace it`);
    const relay = (a.relay ?? process.env.ENKI_RELAY_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
    const { credential, fingerprint } = await pairAgent({
      relay, code, name: a.name,
      confirm: async (fp) => {
        process.stdout.write(`\nImpressão da chave: ${fp}\nConfira se o Enki mostra exatamente a mesma, inteira.\n`);
        if (a.yes) return true;
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("É igual? Digite s para confirmar: ");
        rl.close();
        return /^s(im)?$/i.test(answer.trim());
      },
    });
    writeFileSync(keyFile, credential + "\n", { mode: 0o600 });
    process.stdout.write(`Pareado (${fingerprint}). Agora clique em Confirmar no Enki.\nChave do agente salva em ${keyFile} (0600). Use ENKI_AGENT_KEY_FILE=${keyFile} no servidor MCP.\n`);
    return;
  }
  if (cmd === "send" || cmd === "pneu") {
    const keyFile = a["key-file"] ?? process.env.ENKI_AGENT_KEY_FILE;
    const credential = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env.ENKI_AGENT_KEY;
    if (!credential) throw new Error("--key-file (or ENKI_AGENT_KEY_FILE / ENKI_AGENT_KEY) is required");
    const bundle = cmd === "pneu" ? PNEU_DE_NEVE : {
      title: a.title,
      ...(a.summary ? { summary: a.summary } : {}),
      links: a.link.map((l) => { const [url, label] = l.split("|"); return label ? { url, label } : { url }; }),
    };
    const { status } = await sendTabs({ credential, bundle });
    process.stdout.write(status === 202 ? "Enviado. Você não vai saber se foi aceito (de propósito).\n" : `O relay recusou (HTTP ${status}).\n`);
    if (status !== 202) process.exitCode = 1;
    return;
  }
  process.stdout.write("usage:\n  send-tabs.mjs pair ENKI-XXXX-XXXX --name Helm [--relay URL] [--key-file F] [--yes]\n  send-tabs.mjs send --key-file F --title T [--summary S] --link URL[|label] …\n  send-tabs.mjs pneu --key-file F\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { process.stderr.write(`send-tabs: ${e.message}\n`); process.exit(1); });
}
