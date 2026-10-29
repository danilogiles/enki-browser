// AIC-3: connector (MCP + OAuth) endpoint rule. Same loader as unit.cjs; fetch is stubbed.
const ts = require('typescript');
const fs = require('node:fs');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
global.chrome = { runtime: { getManifest: () => ({ version: 'test' }) } };

const { connectorUrlProblem, oauthUrlProblem, assertConnectorEndpoint, ConnectorEndpointError } = require('../src/lib/connectors/endpoint.ts');
const { McpClient } = require('../src/lib/connectors/mcp.ts');
const { discover, refresh } = require('../src/lib/connectors/oauth.ts');
const { PRESETS } = require('../src/lib/connectors/index.ts');
const { evaluateEndpoint } = require('../src/lib/providers/endpoint-policy.ts');

let checks = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

let calls = [];
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
function stub(handler) { calls = []; global.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); }; }

check('connector URL: https anywhere, http only to loopback', () => {
  for (const ok of ['https://mcp.example.com/mcp', 'https://10.0.0.5/mcp', 'http://localhost:3000/mcp', 'http://127.0.0.1:8080/mcp', 'http://[::1]:9000/mcp']) {
    assert.equal(connectorUrlProblem(ok), null, ok);
  }
  for (const bad of ['http://mcp.example.com/mcp', 'http://192.168.1.20:8080/mcp', 'http://10.0.0.5/mcp', 'http://8.8.8.8/mcp', 'http://ollama.local/mcp', 'http://[::ffff:192.168.1.2]/mcp', 'ftp://x.test/', 'javascript:alert(1)', 'not a url', '']) {
    assert.ok(connectorUrlProblem(bad), bad);
  }
  assert.match(connectorUrlProblem('http://192.168.1.20:8080/mcp'), /192\.168\.1\.20:8080.*https:\/\//);
});

check('every preset passes the connector rule (unaffected)', () => {
  for (const p of PRESETS) assert.equal(connectorUrlProblem(p.url), null, p.url);
});

check('BYOM model policy unchanged: private-IP exception and loopback still work for the model', () => {
  assert.equal(evaluateEndpoint('http://192.168.1.20:11434/v1', { hasKey: false, exceptions: ['http://192.168.1.20:11434'] }).allowed, true);
  assert.equal(evaluateEndpoint('http://192.168.1.20:11434/v1', { hasKey: true, exceptions: ['http://192.168.1.20:11434'] }).state, 'key-over-http');
  assert.equal(evaluateEndpoint('http://localhost:11434/v1', { hasKey: true }).allowed, true);
});

check('OAuth URLs: https required; http loopback only when the MCP server is loopback', () => {
  const remote = 'https://mcp.example.com/mcp';
  assert.equal(oauthUrlProblem('https://auth.example.com/token', remote, 'token endpoint'), null);
  assert.ok(oauthUrlProblem('http://auth.example.com/token', remote, 'token endpoint'));
  assert.ok(oauthUrlProblem('http://127.0.0.1:9/token', remote, 'token endpoint'), 'remote server cannot aim the exchange at loopback http');
  assert.ok(oauthUrlProblem('javascript:alert(1)', remote, 'sign-in page'));
  assert.ok(oauthUrlProblem(undefined, remote, 'token endpoint'));
  assert.equal(oauthUrlProblem('http://localhost:8000/token', 'http://localhost:8000/mcp', 'token endpoint'), null);
  assert.ok(oauthUrlProblem('http://192.168.1.2/token', 'http://localhost:8000/mcp', 'token endpoint'));
});

check('assertConnectorEndpoint throws ConnectorEndpointError', () => {
  assert.throws(() => assertConnectorEndpoint('http://intranet.corp/mcp'), (e) => e instanceof ConnectorEndpointError && e.verdict.state === 'hostname');
});

check('MCP client: refused URL never fetched and never asks for the token', async () => {
  stub(() => json({}));
  let asked = 0;
  const c = new McpClient('http://192.168.1.20:8080/mcp', async () => { asked++; return { Authorization: 'Bearer secret' }; });
  await assert.rejects(() => c.initialize(), ConnectorEndpointError);
  assert.equal(calls.length, 0);
  assert.equal(asked, 0);
});

check('MCP client: https request goes out with redirect:"error" and credentials:"omit"', async () => {
  stub((url, init) => {
    const body = JSON.parse(init.body);
    return body.id ? json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }) : new Response(null, { status: 202 });
  });
  const c = new McpClient('https://mcp.example.com/mcp', async () => ({ Authorization: 'Bearer t' }));
  await c.initialize();
  assert.ok(calls.length >= 1);
  for (const { init } of calls) { assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); }
});

check('discover: http resource_metadata skipped; http token_endpoint in metadata refused', async () => {
  stub((url) => {
    if (url.includes('oauth-protected-resource')) return json({ authorization_servers: ['https://auth.example.com'] });
    if (url.includes('oauth-authorization-server')) return json({ authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'http://auth.example.com/token', registration_endpoint: 'https://auth.example.com/register' });
    return new Response('', { status: 404 });
  });
  await assert.rejects(() => discover('https://mcp.example.com/mcp', 'Bearer resource_metadata="http://evil.test/meta"'), /token endpoint.*http:\/\//);
  assert.ok(!calls.some((c) => c.url.startsWith('http://')), 'no plain-http fetch');
  for (const { init } of calls) assert.equal(init.redirect, 'error');
});

check('discover: http authorization server / registration / javascript: sign-in page refused', async () => {
  stub((url) => url.includes('oauth-protected-resource') ? json({ authorization_servers: ['http://auth.example.com'] }) : new Response('', { status: 404 }));
  await assert.rejects(() => discover('https://mcp.example.com/mcp', null), /authorization server/);
  stub((url) => url.includes('oauth-authorization-server') ? json({ authorization_endpoint: 'https://a.test/authorize', token_endpoint: 'https://a.test/token', registration_endpoint: 'http://a.test/register' }) : new Response('', { status: 404 }));
  await assert.rejects(() => discover('https://mcp.example.com/mcp', null), /registration endpoint/);
  stub((url) => url.includes('oauth-authorization-server') ? json({ authorization_endpoint: 'javascript:alert(1)', token_endpoint: 'https://a.test/token' }) : new Response('', { status: 404 }));
  await assert.rejects(() => discover('https://mcp.example.com/mcp', null), /sign-in page/);
});

check('discover: all-https metadata (preset shape) passes', async () => {
  stub((url) => url.endsWith('/.well-known/oauth-authorization-server')
    ? json({ authorization_endpoint: 'https://mcp.example.com/authorize', token_endpoint: 'https://mcp.example.com/token', registration_endpoint: 'https://mcp.example.com/register' })
    : new Response('', { status: 404 }));
  const r = await discover('https://mcp.example.com/mcp', null);
  assert.equal(r.server.token_endpoint, 'https://mcp.example.com/token');
});

check('refresh: a saved http token endpoint (pre-0.8.14) is refused before the refresh token is sent', async () => {
  stub(() => json({ access_token: 'x' }));
  await assert.rejects(() => refresh({ accessToken: 'a', refreshToken: 'r', clientId: 'c', tokenEndpoint: 'http://auth.example.com/token' }, 'https://mcp.example.com/mcp'), ConnectorEndpointError);
  assert.equal(calls.length, 0);
  const ok = await refresh({ accessToken: 'a', refreshToken: 'r', clientId: 'c', tokenEndpoint: 'https://auth.example.com/token' }, 'https://mcp.example.com/mcp');
  assert.equal(ok.accessToken, 'x');
  assert.equal(calls[0].init.redirect, 'error');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); checks++; console.log('PASS', name); }
  console.log(`${checks} connector endpoint checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
