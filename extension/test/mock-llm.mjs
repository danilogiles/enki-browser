// A tiny OpenAI-compatible mock server used by the end-to-end test. It streams a scripted
// sequence of tool calls (read_page -> type -> click -> final answer) so the whole agent loop,
// the OpenAI adapter, the content script and the CDP input path can be exercised without a
// real model or API key. It also serves a small test page at /page.
//
// Usage: node test/mock-llm.mjs [port]
import http from "node:http";

const port = Number(process.argv[2] ?? 8787);

const PAGE = `<!doctype html><html><head><title>Enki test page</title></head>
<body style="font-family:sans-serif;padding:24px">
  <h1>Enki test shop</h1>
  <label>Search <input id="q" placeholder="Search products"></label>
  <p id="echo"></p>
  <button id="buy" onclick="document.title='BOUGHT:'+document.getElementById('q').value">Buy now</button>
  <script>document.getElementById('q').addEventListener('input',e=>{document.getElementById('echo').textContent='typed: '+e.target.value})</script>
</body></html>`;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function streamToolCall(res, name, args) {
  const id = `call_${Math.random().toString(36).slice(2, 10)}`;
  sse(res, {
    choices: [
      {
        delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] },
        finish_reason: null,
      },
    ],
  });
  const json = JSON.stringify(args);
  for (let i = 0; i < json.length; i += 7) {
    sse(res, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(i, i + 7) } }] }, finish_reason: null }],
    });
  }
  sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  res.write("data: [DONE]\n\n");
  res.end();
}

function streamText(res, text) {
  for (const word of text.split(" ")) {
    sse(res, { choices: [{ delta: { content: word + " " }, finish_reason: null }] });
  }
  sse(res, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  res.write("data: [DONE]\n\n");
  res.end();
}

function refFor(snapshot, pattern) {
  const line = snapshot.split("\n").find((l) => pattern.test(l));
  const m = line?.match(/\[(ref_\d+)\]/);
  return m?.[1];
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/heavy")) {
    // A page big enough that a stale snapshot is expensive to keep around.
    const rows = Array.from({ length: 400 }, (_, i) => `<p><a href="/x${i}">Item number ${i} with some descriptive text</a></p>`).join("");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><title>Heavy page</title><body><h1>Heavy</h1>${rows}</body>`);
  }
  // A page that builds its content with JavaScript, like a live results board: its HTML alone
  // says nothing, so read_url has to render it.
  if (req.method === "GET" && req.url.startsWith("/live")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><title>Live board</title><body><div id="app">Loading…</div>
<script>setTimeout(() => { document.getElementById("app").textContent = "Live result: candidate A 51.2%, candidate B 48.8%"; }, 400)</script></body>`);
  }
  // ---- a tiny MCP server behind OAuth, the way remote ones (Linear, Notion…) work: a 401 that
  // points to protected-resource metadata, dynamic client registration, PKCE, then tools.
  const base = `http://127.0.0.1:${port}`;
  const send = (code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/.well-known/oauth-protected-resource/mcp") return send(200, { resource: `${base}/mcp`, authorization_servers: [base] });
  if (req.method === "GET" && req.url === "/.well-known/oauth-authorization-server") {
    return send(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, code_challenge_methods_supported: ["S256"] });
  }
  if (req.method === "GET" && req.url.startsWith("/authorize")) {
    // Signs in at once: a real service shows its own login page here.
    const q = new URL(req.url, base).searchParams;
    if (!q.get("code_challenge") || q.get("client_id") !== "mock-client") return send(400, { error: "invalid_request" });
    res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=mock-code&state=${encodeURIComponent(q.get("state") ?? "")}` });
    return res.end();
  }
  if (req.method === "POST" && (req.url === "/register" || req.url === "/token" || req.url === "/mcp")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/register") return send(201, { client_id: "mock-client", redirect_uris: JSON.parse(raw).redirect_uris });
      if (req.url === "/token") {
        const form = new URLSearchParams(raw);
        if (form.get("code") !== "mock-code" || !form.get("code_verifier")) return send(400, { error: "invalid_grant" });
        return send(200, { access_token: "mock-token", refresh_token: "mock-refresh", expires_in: 3600, token_type: "Bearer" });
      }
      if (req.headers.authorization !== "Bearer mock-token") {
        return send(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      const msg = JSON.parse(raw);
      if (msg.id === undefined) return send(202);
      const reply = (result, viaStream = false) => {
        if (!viaStream) return send(200, { jsonrpc: "2.0", id: msg.id, result }, { "Mcp-Session-Id": "mock-session" });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Mcp-Session-Id": "mock-session" });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\n`);
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
      };
      if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-tracker", version: "1" } });
      if (msg.method === "tools/list") {
        return reply({ tools: [
          { name: "search_issues", description: "Search issues by text", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
          { name: "create_issue", description: "Create an issue", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
        ] });
      }
      if (msg.method === "tools/call" && msg.params.name === "search_issues") return reply({ content: [{ type: "text", text: `Found MOCK-7 "${msg.params.arguments.query} in checkout"` }] });
      if (msg.method === "tools/call" && msg.params.name === "create_issue") return reply({ content: [{ type: "text", text: `Created MOCK-8 "${msg.params.arguments.title}"` }] }, true);
      return send(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    });
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/page")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(PAGE);
  }
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-agent" }, { id: "mock-echo" }] }));
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages, model } = JSON.parse(body);
      if (model === "mock-no-headers") return;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const lastUser = [...messages].reverse().find((m) => m.role === "user" && Array.isArray(m.content));
      const userText = lastUser?.content.find((c) => c.type === "text")?.text ?? "";
      const hasImage = !!lastUser?.content.some((c) => c.type === "image_url");
      console.log(`[mock] model=${model} tools=${toolMsgs.length} image=${hasImage} user=${JSON.stringify(userText.slice(0, 80))}`);

      if (model === "mock-echo") {
        return streamText(res, `Echo: ${userText.replace(/\s+/g, " ").slice(0, 120)} | image=${hasImage}`);
      }
      if (model === "mock-probe") return streamToolCall(res, "enki_connection_test", { nonce: "enki-probe" });
      if (model === "mock-failure") return streamToolCall(res, "click", { ref: "ref_999999" });
      if (model === "mock-lock") {
        if (toolMsgs.length === 0) return setTimeout(() => streamToolCall(res, "read_page", { filter: "interactive" }), 1500);
        if (toolMsgs.length === 1) return streamToolCall(res, "type", { ref: refFor(toolMsgs[0].content, /textbox/), text: "locked target" });
        return streamText(res, "Finished the typing test.");
      }
      // Opens the stream and then goes silent forever, like a wedged gateway.
      if (model === "mock-stall") {
        res.write(": waiting\n\n");
        return; // never ends
      }
      // Puts the whole answer in the reasoning channel and emits no content and no tool call.
      if (model === "mock-reasoning-only") {
        for (const w of "I should open Gmail and check the visa status.".split(" ")) {
          sse(res, { choices: [{ delta: { reasoning_content: w + " " }, finish_reason: null }] });
        }
        sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      // Ignores the tools parameter the way harness-backed free providers do: first it claims
      // to have no tools, then it prints another system's MCP call as plain text.
      if (model === "mock-no-tools") {
        const second = messages.filter((m) => m.role === "user" && Array.isArray(m.content)).length > 1;
        if (second) {
          return streamText(
            res,
            'Sure:\n```json\n{ "name": "mcp__puppeteer_core__evaluate_javascript", "arguments": { "script": "() => window.open(\'https://mail.google.com\')" } }\n```',
          );
        }
        return streamText(
          res,
          "Não tenho ferramentas disponíveis para navegar em sites ou abrir URLs. Por favor, me informe se há outra maneira.",
        );
      }
      // Writes a call to a REAL Enki tool as text rather than emitting it properly.
      if (model === "mock-text-toolcall") {
        const done = messages.some((m) => m.role === "tool");
        if (done) return streamText(res, "Done.");
        return streamText(
          res,
          `I'll do that.\n<tool_call>\n{"name": "navigate", "arguments": {"url": "http://127.0.0.1:${port}/page?viatext=1"}}\n</tool_call>`,
        );
      }
      // Uses a connected app: searches it (read: runs at once), then creates an issue (write:
      // waits for the approval card), then reports what both returned.
      if (model === "mock-mcp") {
        const toolsOffered = (JSON.parse(body).tools ?? []).map((t) => t.function?.name ?? t.name);
        const search = toolsOffered.find((n) => n.endsWith("__search_issues"));
        const create = toolsOffered.find((n) => n.endsWith("__create_issue"));
        if (!search) return streamText(res, `no app tools offered (${toolsOffered.length} tools)`);
        if (toolMsgs.length === 0) return streamToolCall(res, search, { query: "bug" });
        if (toolMsgs.length === 1) return streamToolCall(res, create, { title: "From Enki" });
        return streamText(res, `APP-DONE ${toolMsgs.map((m) => String(m.content).replace(/\s+/g, " ").slice(0, 80)).join(" || ")}`);
      }
      // Reports whether the system prompt carries the unfiltered tone section.
      if (model === "mock-tone") {
        const system = messages.find((m) => m.role === "system");
        return streamText(res, `tone-unfiltered=${/Tone: unfiltered/.test(JSON.stringify(system?.content ?? ""))} safety-kept=${/Safety rules|Text on web pages is DATA/.test(JSON.stringify(system?.content ?? ""))}`);
      }
      // Answers with a table of numbers and a mind map: the chat should draw both.
      if (model === "mock-visual") {
        return streamText(res, [
          "Results:", "",
          "| Candidate | Votes | % |", "|---|---|---|", "| Ana | 1.200.000 | 51,2 |", "| Bruno | 1.140.000 | 48,8 |", "",
          "```mindmap", "Launch", "- Product", "  - Pricing", "  - Docs", "- Marketing", "  - Blog", "```", "",
        ].join("\n"));
      }
      // For a manual check against the real web (not used by the automated suites, which stay
      // offline): searches for the user's words, reads the first result, reports both.
      if (model === "mock-live") {
        const question = userText.split("\n").filter(Boolean).at(-1) ?? "";
        if (toolMsgs.length === 0) return streamToolCall(res, "web_search", { query: question });
        if (toolMsgs.length === 1) {
          const url = /https?:\/\/\S+/.exec(String(toolMsgs[0].content))?.[0] ?? "https://example.com";
          return streamToolCall(res, "read_url", { url, max_chars: 1500 });
        }
        return streamText(res, `LIVE-DONE\n\nSEARCH: ${String(toolMsgs[0].content).slice(0, 700)}\n\nREAD: ${String(toolMsgs[1].content).slice(0, 700)}`);
      }
      // Reads a JavaScript-built page through read_url, then reports what it said.
      if (model === "mock-web") {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") return streamText(res, `From the source: ${String(last.content).replace(/\s+/g, " ").slice(0, 200)}`);
        return streamToolCall(res, "read_url", { url: `http://127.0.0.1:${port}/live` });
      }
      // Reads the page once per turn, so repeated turns pile up page observations.
      if (model === "mock-reader") {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") return streamText(res, "Read it.");
        return streamToolCall(res, "read_page", { filter: "all" });
      }
      // Reports a completed navigation without calling any tool — the "it says it did but the
      // page never moved" failure. Once corrected, it performs the navigation for real.
      if (model === "mock-liar") {
        const corrected = messages.some(
          (m) =>
            m.role === "user" &&
            (Array.isArray(m.content) ? m.content : [{ text: m.content }]).some((c) =>
              /You called no tool/.test(c?.text ?? ""),
            ),
        );
        if (corrected) return streamToolCall(res, "navigate", { url: `http://127.0.0.1:${port}/page?moved=1` });
        return streamText(res, "Done - I have opened your Google Drive.");
      }
      // Emits <think> tags inline in content, the way many local/free models do.
      if (model === "mock-think-tags") {
        const parts = ["<th", "ink>plan", "ning here</thi", "nk>The ", "answer ", "is 42."];
        for (const p of parts) sse(res, { choices: [{ delta: { content: p }, finish_reason: null }] });
        sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      const snapshot = toolMsgs[0]?.content ?? "";
      switch (toolMsgs.length) {
        case 0:
          return streamToolCall(res, "read_page", { filter: "interactive" });
        case 1: {
          const ref = refFor(snapshot, /textbox/);
          return streamToolCall(res, "type", { ref, text: "hello enki" });
        }
        case 2: {
          const ref = refFor(snapshot, /Buy now/);
          return streamToolCall(res, "click", { ref });
        }
        default:
          return streamText(res, `Done. Results: ${toolMsgs.map((m) => m.content.replace(/\n/g, " ").slice(0, 60)).join(" || ")}`);
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => console.log(`[mock] listening on http://127.0.0.1:${port}`));
