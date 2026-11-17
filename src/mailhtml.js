// The look of every email (spec 17 parts 6 and 7): tables and inline styles, 560 wide inside a 600 frame, system fonts on
// 12, 13, 15, 18, 24 and 32. A small dark set the mail app picks up on its own (spec 19 part 6); the welcome band stays
// dark in both. Two images, both on our own site: the logo on every email and the ridge on the welcome. No web fonts,
// no tracking. Also the words of each row: the drug, then what happened, in one sentence, and one grey line.
import { esc, shortDate, milestonePlain } from '../web/table.js';
import { eventWords } from './pages/app.js';
import { WHO } from './legal.js';

export const PUBLIC = (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '');
export const BRAND = process.env.BRAND || 'OpenLandscape';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const C = { bg: '#FFFFFF', ink: '#1C1A17', mut: '#77736D', soon: '#B25E14', band: '#1C1A17', bandMut: '#A19D96', line: '#E6E3DE' };
// Dark set (spec 19 part 6). [data-ogsc] is Outlook.com's dark mode.
const DARK = '.e-bg{background-color:#171614!important}.e-ink{color:#EEECE8!important}.e-mut{color:#A19D96!important}.e-soon{color:#E9A866!important}.e-btn{background-color:#EEECE8!important}.e-btnt{color:#171614!important}.e-line{border-color:#2E2C29!important}';
const darkCss = `@media (prefers-color-scheme:dark){${DARK}}${DARK.replace(/(^|\})\./g, '$1[data-ogsc] .')}`;

export const abs = u => (!u ? '' : /^https?:/.test(u) ? u : PUBLIC + (u.startsWith('/') ? u : '/' + u));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayLine = d => { const t = new Date(d + 'T12:00:00Z'); return `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
export const capFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
// "Heart failure" in a sentence is "heart failure"; "GLP-1" and "PD-1/VEGF" stay as they are.
export const inSentence = name => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);
export const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- the words of a row ----------
// Ranks for the headline and the subject: the biggest news wins, then the newest.
const RANK = { approval: 10, rejection: 9, opinion: 8, withdrawal: 7, delay: 6, regulatory_filing: 5, new_trial: 4, deal: 3, catalyst: 3, phase: 3, status: 2, date: 2 };
export const rank = i => (RANK[i.kind] || 1) - (/new use/.test(i.text) ? 1 : 0) + (i.stopped ? 3 : 0) + (i.kind === 'new_trial' && /Phase 3/.test(i.text) ? 1 : 0);
const lowerFirst = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
// What happened, after the drug's name ("approved by the FDA for a new use"), and the grey source ("Keytruda").
// Regulator names and numbers leave the sentence; the SEC delay stops at its headline.
export function changeWords(i) {
  const w = eventWords(i);
  let what = w.what, src = w.src;
  if (/^FDA did not approve/.test(what)) { what = 'not approved by the FDA'; src = 'complete response letter'; }
  else if (what === 'FDA approved a new use') what = 'approved by the FDA for a new use';
  else if (i.kind === 'delay') what = what.replace(/^(\S+) extended its review.*$/, '$1 review extended');
  else if (['new_trial', 'status', 'phase', 'date'].includes(i.kind)) {
    what = what.replace(/ \((terminated|suspended)\)$/, '').replace(/ \((\d+) later, (\d+) earlier\)$/, ', $1 later and $2 earlier');
    src = 'ClinicalTrials.gov';
  }
  return { what: lowerFirst(what), src, bad: !!w.bad };
}
// A date ahead: "Phase 2 trial completes"; "US FDA decision (PDUFA date) on the BLA for X" -> "FDA decision on X";
// a closing "(company guidance, ...)" moves to the grey line.
export function comingWords(c) {
  let what = milestonePlain(c.what).replace(/^US FDA/, 'FDA').replace(/ \(PDUFA date\)/, '').replace(/ on the s?(BLA|NDA|MAA) for /, ' on ');
  let src = '';
  const m = what.match(/\s*\(([^)]*)\)\s*$/);
  if (m && /company|press|guidance/i.test(m[1])) { what = what.slice(0, m.index); src = m[1].split(',')[0].trim(); }
  return { what, src };
}
export const isRegulatorDate = c => c.kind === 'news' && /\b(FDA|EMA|CHMP|PDUFA|European Commission)\b/.test(c.what);

// ---------- pieces ----------
const td = (cls, style, html, attrs = '') => `<td class="${cls}"${attrs} style="${style}">${html}</td>`;
export function logoRow(date) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%"><tr>`
    + `<td width="28" valign="middle" style="width:28px;padding:0 8px 0 0"><img src="${PUBLIC}/img/mail-logo.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px"></td>`
    + td('e-ink', `padding:0;font-size:15px;line-height:22px;font-weight:600;color:${C.ink}`, BRAND, ' valign="middle"')
    + (date ? td('e-mut', `padding:0;font-size:13px;line-height:20px;color:${C.mut};white-space:nowrap`, esc(date), ' align="right" valign="middle"') : '')
    + '</tr></table>';
}
export const h1 = t => `<h1 class="e-ink" style="margin:36px 0 0;font-size:24px;line-height:32px;font-weight:600;color:${C.ink}">${esc(t)}</h1>`;
export const sub = t => `<p class="e-mut" style="margin:12px 0 0;font-size:15px;line-height:22px;color:${C.mut}">${esc(t)}</p>`;
export const h2 = (t, top = 44) => `<h2 class="e-ink" style="margin:${top}px 0 8px;font-size:18px;line-height:24px;font-weight:600;color:${C.ink}">${esc(t)}</h2>`;
export const para = (t, top = 28) => `<p class="e-ink" style="margin:${top}px 0 0;font-size:15px;line-height:24px;color:${C.ink}">${t}</p>`;
export const small = t => `<p class="e-mut" style="margin:12px 0 0;font-size:13px;line-height:20px;color:${C.mut}">${t}</p>`;
export const button = (label, href, top = 32) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${top}px 0 0"><tr><td class="e-btn" bgcolor="${C.ink}" style="background-color:${C.ink};border-radius:8px"><a class="e-btnt" href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-size:15px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none">${esc(label)}</a></td></tr></table>`;
// Who sends it (step 10: a sender's name and postal address belong in every email that is not a sign-in link).
// The footer sits apart under a thin line, each part on its own line with room around it.
export const SENDER = `${BRAND} · ${WHO.name}, ${WHO.address}`;
const fp = (html, top) => `<p class="e-mut" style="margin:${top}px 0 0;font-size:12px;line-height:20px;color:${C.mut}">${html}</p>`;
export const footer = (words, unsub) => `<div class="e-line" style="margin:48px 0 0;border-top:1px solid ${C.line};padding-top:24px">`
  + (words ? fp(esc(words), 0) : '')
  + fp(`<a class="e-mut" href="${esc(unsub)}" style="color:${C.mut};text-decoration:underline">Unsubscribe</a>`, words ? 12 : 0)
  + fp(`${esc(`${BRAND} · ${WHO.name}`)}<br>${esc(WHO.address)}`, 20) + '</div>';
export const footerText = (words, unsub) => [...(words ? [words] : []), `Unsubscribe: ${unsub}`, SENDER];
// One row: date (with "soon" under it), the drug in bold and one sentence, linked to the source; one grey line under it.
// `r`: { date, soon, name, what, url, grey: [..] }
export function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">${list.map(r => '<tr>'
    + td('e-mut', `width:64px;padding:12px 8px 12px 0;font-size:13px;line-height:22px;color:${C.mut};white-space:nowrap`, esc(r.date) + (r.soon ? `<br><span class="e-soon" style="font-size:12px;line-height:18px;color:${C.soon}">soon</span>` : ''), ' width="64" valign="top"')
    + td('e-ink', `padding:12px 0;font-size:15px;line-height:22px;color:${C.ink}`, (r.url ? `<a class="e-ink" href="${esc(abs(r.url))}" style="color:${C.ink};text-decoration:none">` : '')
      + `<b style="font-weight:600">${esc(r.name)}</b> ${esc(r.what)}${r.url ? '</a>' : ''}`
      + (r.grey.length ? `<br><span class="e-mut" style="font-size:13px;line-height:20px;color:${C.mut}">${esc(r.grey.join(' · '))}</span>` : ''), ' valign="top"')
    + '</tr>').join('')}</table>`;
}
export const textRows = list => list.map(r => `${r.date}  ${r.name} ${r.what}${r.grey.length ? `\n        ${r.grey.join(' · ')}` : ''}${r.url ? `\n        ${abs(r.url)}` : ''}`).join('\n');

// The whole email. `band`: optional HTML drawn full width above the white part (the welcome's dark band).
export function page({ subject, preheader = '', body, band = '' }) {
  const white = `<table class="e-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background-color:${C.bg}"><tr><td class="e-bg" align="center" style="padding:${band ? '28px' : '40px'} 24px 40px;background-color:${C.bg}">`
    + `<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><div style="max-width:560px;margin:0 auto;text-align:left;font-family:${FONT};color:${C.ink}">${body}</div><!--[if mso]></td></tr></table><![endif]--></td></tr></table>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title><style>:root{color-scheme:light dark}${darkCss}</style></head>
<body class="e-bg" style="margin:0;padding:0;background-color:${C.bg}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table class="e-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background-color:${C.bg}"><tr><td align="center" style="padding:0">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><div style="max-width:600px;margin:0 auto">${band}${white}</div><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

// The welcome's dark band: logo, the 32 headline, the counts line, the ridge and the count under each peak. It keeps its
// colours in dark mode (no e- classes). Text and numbers stay readable when images are blocked.
export function welcomeBand({ headline, line, ridgeUrl, ridgeAlt, stages }) {
  const cell = s => `<td width="${Math.floor(100 / stages.length)}%" align="center" style="width:${Math.floor(100 / stages.length)}%;padding:0 0 28px;color:#FFFFFF"><div style="font-size:24px;line-height:32px;font-weight:600;color:#FFFFFF">${s.count}</div><div style="font-size:13px;line-height:20px;color:${C.bandMut}">${esc(s.name)}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background-color:${C.band}"><tr><td bgcolor="${C.band}" style="background-color:${C.band};padding:0">`
    + `<div style="padding:28px 28px 0;font-family:${FONT}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" style="width:28px;padding:0 8px 0 0"><img src="${PUBLIC}/img/mail-logo.png" width="28" height="28" alt="" style="display:block;border:0"></td><td style="font-size:15px;line-height:22px;font-weight:600;color:#FFFFFF">${BRAND}</td></tr></table>`
    + `<h1 style="margin:44px 0 0;font-size:32px;line-height:40px;font-weight:600;color:#FFFFFF">${esc(headline)}</h1><p style="margin:12px 0 28px;font-size:15px;line-height:22px;color:${C.bandMut}">${esc(line)}</p></div>`
    + (ridgeUrl ? `<img src="${esc(ridgeUrl)}" width="600" alt="${esc(ridgeAlt)}" style="display:block;width:100%;height:auto;border:0">` : '')
    + (stages.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-family:${FONT}"><tr>${stages.map(cell).join('')}</tr></table>` : '')
    + '</td></tr></table>';
}

export const rowDate = (d, year) => shortDate(d, year);
