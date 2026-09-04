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
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const lastUser = [...messages].reverse().find((m) => m.role === "user" && Array.isArray(m.content));
      const userText = lastUser?.content.find((c) => c.type === "text")?.text ?? "";
      const hasImage = !!lastUser?.content.some((c) => c.type === "image_url");
      console.log(`[mock] model=${model} tools=${toolMsgs.length} image=${hasImage} user=${JSON.stringify(userText.slice(0, 80))}`);

      if (model === "mock-echo") {
        return streamText(res, `Echo: ${userText.replace(/\s+/g, " ").slice(0, 120)} | image=${hasImage}`);
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
