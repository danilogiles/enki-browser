#!/usr/bin/env node
// The Enki relay on Node, for development, tests and self-hosting behind your own HTTPS proxy.
// Listens on 127.0.0.1:8788 by default (8787 is the tests' mock model). Logs nothing.
//   ENKI_RELAY_HOST (default 127.0.0.1)   ENKI_RELAY_PORT (default 8788)
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createHandler } from "./src/handler.js";
import { createMemoryStore } from "./src/memory-store.js";

export function startRelay({ host = "127.0.0.1", port = 8788, now } = {}) {
  const store = createMemoryStore();
  const handle = createHandler(store, now ? { now } : {});
  const server = createServer(async (req, res) => {
    try {
      const body = req.method === "GET" || req.method === "HEAD" || req.method === "DELETE" ? undefined : req;
      const request = new Request(`http://${host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  const sweep = setInterval(() => store.sweep(Date.now()), 60_000);
  sweep.unref();
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    server, store, url: `http://${host}:${server.address().port}`,
    close: () => new Promise((r) => { clearInterval(sweep); server.close(() => r()); server.closeAllConnections?.(); }),
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const relay = await startRelay({ host: process.env.ENKI_RELAY_HOST || "127.0.0.1", port: Number(process.env.ENKI_RELAY_PORT || 8788) });
  process.stderr.write(`enki-relay listening on ${relay.url}\n`);
}
