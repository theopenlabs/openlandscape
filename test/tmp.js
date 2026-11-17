// A temporary folder for one check, deleted when the check ends (passed or failed), so checks leave nothing behind.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
