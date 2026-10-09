#!/usr/bin/env node
// Entry point: an MCP server on stdin/stdout. stdout carries only JSON-RPC; everything else goes
// to stderr. No telemetry; the only network request is the POST to the configured relay.
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig();
for (const w of config.warnings) process.stderr.write(`enki-deliver-tabs: WARNING: ${w}\n`);
if (!config.ok) process.stderr.write(`enki-deliver-tabs: ${config.error}\n`);

// Debug output is metadata only (counts, sizes, status codes); bundle content is never logged.
const log = config.debug ? (event, data) => process.stderr.write(`enki-deliver-tabs: ${event} ${JSON.stringify(data)}\n`) : () => {};

const server = createServer({ config, log });
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = Promise.resolve();
rl.on("line", (line) => {
  // Answer in arrival order; tool calls are short and the client may pipeline requests.
  pending = pending.then(async () => {
    const out = await server.handleLine(line);
    if (out) process.stdout.write(out + "\n");
  });
});
rl.on("close", () => {
  pending.then(() => process.exit(0));
});
