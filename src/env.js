// Load .env if present (keys live there locally; on the server they come from the systemd unit).
// A note after a value ("  # ...") is dropped, as in .env.example; systemd on the server does not do this.
import { readFileSync, existsSync } from 'node:fs';
const envFile = new URL('../.env', import.meta.url).pathname;
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
}
