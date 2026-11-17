// Calls the running MCP server over HTTP the way Claude does. Usage: node test/mcp-smoke.js [base-url]
import { getDb } from '../src/db.js';
import { createApiKey } from '../src/auth.js';
const base = process.argv[2] || 'http://localhost:8787';
const db = getDb();
db.prepare('INSERT OR IGNORE INTO user(email) VALUES (?)').run('mcp.test@example.com');
const key = createApiKey(db.prepare('SELECT id FROM user WHERE email=?').pluck().get('mcp.test@example.com'));
let id = 0;
async function rpc(method, params) {
  const r = await fetch(`${base}/mcp/u/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return JSON.parse(t).result;
}
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log('tools:', (await rpc('tools/list', {})).tools.map(t => t.name).join(', '));
for (const [name, args] of [['search', { query: 'LY3305677' }], ['landscape', { area: 'obesity', phase_min: 4, limit: 8 }], ['catalysts', { days_ahead: 21, area: 'obesity' }], ['who_runs_trials', { area: 'obesity', phase: 3, country: 'China' }], ['trials', { drug: 'IBI362', limit: 3 }]]) {
  const r = await rpc('tools/call', { name, arguments: args });
  console.log(`\n===== ${name}(${JSON.stringify(args)})${r.isError ? ' ERROR' : ''}\n` + r.content[0].text.split('\n').slice(0, 16).join('\n'));
}
