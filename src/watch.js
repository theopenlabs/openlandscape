// The weekly watch email to us: every Monday, what the data limits (src/limits.js) saw in the last seven
// days, so a person can look and decide. The same-day alert (limits.js) names an account the day it crosses 1,500 new drugs
// or 4,000 in 30 days; this email is the week's look back:
// - accounts whose busiest day had 1,000 or more new drugs, and how often they were stopped;
// - computers stopped by the limit on public pages signed out, and how many pages were opened signed out in all (many
//   computers each staying just under the limit shows up as a jump in that total).
// Sent to CONTACT_EMAIL, only when there is something to name; each week once (watch_log). Without RESEND_API_KEY it is printed.
import { getDb } from './db.js';
import { DRUGS, PAGES } from './limits.js';
import { sendAdminMail } from './mail.js';

export const BUSY_DAY = 1000;   // new drugs on one day worth naming
const fmt = n => Number(n).toLocaleString('en-US');
// Accounts with a day of BUSY_DAY or more new drugs since `since` (YYYY-MM-DD): their busiest day, and the days they were stopped.
export function busyAccounts(since) {
  return getDb().prepare(`SELECT u.email, u.plan, max(d.n) AS most,
      (SELECT count(*) FROM usage b WHERE b.user_id=u.id AND b.kind='drugs_stopped' AND b.at >= ?) AS stopped
    FROM (SELECT user_id, first_day, count(*) AS n FROM drug_seen WHERE first_day >= ? GROUP BY user_id, first_day) d
    JOIN user u ON u.id=d.user_id GROUP BY u.id HAVING most >= ? ORDER BY most DESC`).all(since, since, BUSY_DAY);
}
// Signed-out public pages since `since`: pages opened, computers, and the computers stopped by the limit.
export function pageWeek(since) {
  const db = getDb();
  return {
    ...db.prepare('SELECT coalesce(sum(pages),0) AS pages, count(DISTINCT ip) AS computers FROM visitor_day WHERE day >= ?').get(since),
    stopped: db.prepare('SELECT ip, sum(stopped) AS times, sum(pages) AS pages FROM visitor_day WHERE day >= ? AND stopped > 0 GROUP BY ip ORDER BY times DESC LIMIT 20').all(since),
  };
}
export function watchText(rows, pg, since) {
  const out = [`Since ${since}.`, ''];
  if (rows.length) out.push(`Accounts with ${fmt(BUSY_DAY)} or more new drugs on one day (the most is ${fmt(DRUGS.paid.day)} a day and ${fmt(DRUGS.paid.month)} in 30 days on Solo, ${fmt(DRUGS.free.month)} on Free):`,
    ...rows.map(r => `${r.email} (${r.plan}): ${fmt(r.most)} on their busiest day${r.stopped ? `, stopped on ${r.stopped} ${r.stopped === 1 ? 'day' : 'days'}` : ''}`), '');
  out.push(`Public pages opened signed out: ${fmt(pg.pages)} from ${fmt(pg.computers)} computers.`);
  if (pg.stopped.length) out.push(`Stopped by the limit (${PAGES.hour} an hour, ${PAGES.day} a day):`, ...pg.stopped.map(s => `${s.ip}: stopped ${fmt(s.times)} times, ${fmt(s.pages)} pages opened`));
  out.push('', 'A real user rarely gets near these. If one looks like copying, the Terms let us close the account. What each account opened is in the usage and drug_seen tables.');
  return out.join('\n');
}
// Called every hour with the other emails (server.js): Mondays from 12:00 UTC, once a week.
export async function runWatch(now = new Date()) {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 12) return { sent: false };
  const db = getDb(), week = now.toISOString().slice(0, 10);
  db.exec('CREATE TABLE IF NOT EXISTS watch_log (week TEXT PRIMARY KEY, sent_at TEXT DEFAULT (datetime(\'now\')), accounts INTEGER)');
  if (db.prepare('SELECT 1 FROM watch_log WHERE week=?').get(week)) return { sent: false };
  const since = new Date(now - 7 * 864e5).toISOString().slice(0, 10), rows = busyAccounts(since), pg = pageWeek(since);
  const any = rows.length || pg.stopped.length;
  if (any) await sendAdminMail({ subject: `Data limits this week: ${rows.length} busy ${rows.length === 1 ? 'account' : 'accounts'}, ${pg.stopped.length} stopped ${pg.stopped.length === 1 ? 'computer' : 'computers'}`, text: watchText(rows, pg, since) });
  db.prepare('INSERT INTO watch_log (week, accounts) VALUES (?,?)').run(week, rows.length);   // after sending: a failed send tries again next hour
  if (!any) return { sent: false, accounts: 0 };
  return { sent: true, accounts: rows.length, computers: pg.stopped.length };
}
