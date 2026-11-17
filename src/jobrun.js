// Each step of the hourly job (deploy/hourly.sh) runs through this, so whether it worked is kept (job_run) and the admin hears when one
// breaks. The job itself cannot send email (the email key is only in the website's settings), so the
// website's hourly timer (src/server.js) calls alertJobs: one email when a step starts failing, one when it works again.
//   node src/jobrun.js <name> -- <command> [args...]    exits with the command's own exit code
import './env.js';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getDb } from './db.js';
import { sendAdminMail } from './mail.js';

export const LABEL = { news: 'SEC filings', sec: 'SEC decisions', ema: 'EMA decisions', fda: 'FDA decisions', ctis: 'EU trials (CTIS)',
  fetch: 'ClinicalTrials.gov download', load: 'ClinicalTrials.gov load', compare: 'Changes since the last load' };
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export function record(name, code, startedAt = stamp()) {
  getDb().prepare('INSERT INTO job_run (name, started_at, finished_at, ok, code) VALUES (?,?,?,?,?)').run(name, startedAt, stamp(), code === 0 ? 1 : 0, code);
}
// Runs not yet looked at (mailed IS NULL), oldest first: an email when a step goes from working (or never run) to failing, and when
// it works again. Returns the emails sent, as 'failed:<name>' / 'again:<name>'.
export async function alertJobs() {
  const db = getDb(), sent = [];
  const runs = db.prepare('SELECT * FROM job_run WHERE mailed IS NULL ORDER BY id').all();
  const before = db.prepare('SELECT ok FROM job_run WHERE name=? AND id<? ORDER BY id DESC LIMIT 1').pluck();
  for (const r of runs) {
    const prev = before.get(r.name, r.id), what = LABEL[r.name] || r.name;
    if (!r.ok && prev !== 0) {
      await sendAdminMail({ subject: `Data update failed: ${what}`,
        text: [`The hourly step "${what}" failed at ${r.finished_at} UTC (exit code ${r.code}).`, '',
          'It tries again every hour. The details are in data/hourly.log on the server.',
          'You get this email once when a step starts failing, and another when it works again.'].join('\n') });
      sent.push(`failed:${r.name}`);
    } else if (r.ok && prev === 0) {
      await sendAdminMail({ subject: `Data update works again: ${what}`, text: `The hourly step "${what}" worked again at ${r.finished_at} UTC.` });
      sent.push(`again:${r.name}`);
    }
    db.prepare('UPDATE job_run SET mailed=1 WHERE id=?').run(r.id);   // after sending: a failed send tries again next hour
  }
  return sent;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, sep, cmd, ...args] = process.argv.slice(2);
  if (!name || sep !== '--' || !cmd) { console.error('Usage: node src/jobrun.js <name> -- <command> [args...]'); process.exit(2); }
  const startedAt = stamp();
  let ended = false;   // a command that cannot start emits 'error' and may also emit 'close': keep one run
  const end = code => {
    if (ended) return;
    ended = true;
    try { record(name, code, startedAt); } catch (e) { console.error(`jobrun ${name}: could not record`, e.message); }
    process.exit(code);
  };
  spawn(cmd, args, { stdio: 'inherit' })
    .on('close', code => end(code ?? 1))   // stopped by a signal counts as failed
    .on('error', e => { console.error(`jobrun ${name}:`, e.message); end(127); });
}
