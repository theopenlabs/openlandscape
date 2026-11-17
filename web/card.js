// The card inside Claude and ChatGPT (MCP Apps). src/cards.js puts this script in the card page after the official helper
// (as McpApp) and the icons (ICONS). It draws a tool's `structuredContent` (built in src/cards.js) with the website's own
// classes, so it looks like the website.
// In the chat the card stays a card (Claude's and ChatGPT's card rules: no pages or "back" inside a
// card): a tap on a row opens a short peek under it, in place, and closes it again; "See all" unfolds the list in place.
// Peeks use only what the card already holds, so they cost no lookup. The website's pages show only in the bigger view the
// person opens (the app's expand icon, or ours where the app draws none); there a click that needs data calls our tool,
// so it counts as one lookup, the same as asking. Links open through the app.
const root = document.getElementById('root');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => Number(n || 0).toLocaleString('en-US');
const app = new McpApp({ name: 'OpenLandscape', version: '1.0.0' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });
let base = null;      // the answer the AI asked for
let stack = [];       // the pages opened in the bigger view, last on top
let mode = 'inline';  // 'inline' = the card in the chat, 'page' = the bigger view
let big = false;      // opened bigger by the person (the app's panel or full screen), never by a tap
let peek = '';        // the row opened in place: 'd:<drug name>' or 'p:<part number>'
let more = false;     // the card's list unfolded in place

// ---------- small parts, as on the website ----------
const meter = n => `<div class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'f' + i : ''}"></i>`).join('')}</div>`;
const a = (url, label) => (url ? `<a href="${esc(url)}">${label}</a>` : label);
const btn = (label, act, attrs = '', primary = false) => `<button class="btn sm${primary ? ' primary' : ''}" type="button" data-act="${act}" ${attrs}>${label}</button>`;
const openBtn = url => (url ? `<button class="btn sm" type="button" data-act="link" data-url="${esc(url)}">${ICONS.logo16}<span>Open<span class="lg"> on OpenLandscape</span> ↗</span></button>` : '');
const head = (icon, title, count, right = '') => `<div class="boxhead">${icon ? ICONS[icon] : ''}<h2>${esc(title)}${count != null ? `<span class="count">${num(count)}</span>` : ''}</h2>${right ? `<span class="right">${esc(right)}</span>` : ''}</div>`;
// The card's last line: only the date of the data. The "Open on OpenLandscape" button is the link; the
// full "Source: OpenLandscape, <address>, <date>" line stays in the text the AI gets.
const asOf = v => { const d = String(v.source || '').match(/(\d{1,2} [A-Z][a-z]{2} \d{4})$/); return d ? `Data as of ${d[1]}` : ''; };
const lookups = v => (v.lookups ? `${num(v.lookups.left)} of ${num(v.lookups.of)} lookups left this month` : '');
const foot = (v, buttons) => {
  const note = lookups(v) || asOf(v);
  return buttons || note ? `<div class="foot">${buttons || ''}${note ? `<span class="src">${esc(note)}</span>` : ''}</div>` : '';
};
const meterBox = m => (m ? `<div class="meterbox" role="status"><div class="mrow"><span>${esc(m.label)}</span><b>${num(m.used)} of ${num(m.of)}</b></div>
<div class="mbar"><i style="width:${Math.min(100, Math.round((m.used / Math.max(1, m.of)) * 1000) / 10)}%"></i></div>${m.say || m.act ? `<div class="msay"><p>${esc(m.say)}</p>${m.act === 'talk' ? `<button class="btn sm" type="button" data-act="link" data-url="${esc(talkUrl())}">Write to us ↗</button>` : ''}</div>` : ''}</div>` : '');
const talkUrl = () => String(base?.link || 'https://openlandscape.app').replace(/^(https?:\/\/[^/]+).*$/, '$1') + '/talk';
const stageCell = r => `<td class="ph">${meter(r.level)}<span class="st">${a(r.stage_url, esc(r.stage))}${r.where ? `<span class="wh"> ${esc(r.where)}</span>` : ''}</span></td>`;
const nextCell = n => `<td class="cat"><span class="d">${n ? `${a(n.url, esc(n.label))}${n.soon ? '<span class="tag soon">soon</span>' : ''}` : '—'}</span><span class="sub">${n ? esc(n.what) : ''}</span></td>`;
const title = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const phaseWords = p => (p ? `Phase ${p} and later` : 'Every phase');

// ---------- peeks: a row opened in place ----------
const UNFOLD = 25;    // "See all" unfolds the list in place up to this many; the rest is on the website
const seeAll = n => (n > UNFOLD ? `See top ${UNFOLD}` : `See all ${num(n)}`);
const countWords = (n, what) => `${num(n)} ${what}${n === 1 ? '' : 's'}`;
const stageWords = s => (/^Phase/.test(s) ? `in ${s}` : s.toLowerCase());
// A box head with its title and, under it, one plain line saying what the numbers are.
const chead = (icon, t, sub) => `<div class="boxhead">${icon ? ICONS[icon] : ''}<h2>${esc(t)}</h2>${sub ? `<p class="hsub">${esc(sub)}</p>` : ''}</div>`;
const origin = () => String(base?.link || 'https://openlandscape.app').replace(/^(https?:\/\/[^/]+).*$/, '$1');
const drugUrl = id => (id ? `${origin()}/drugs/${encodeURIComponent(id)}` : '');
const ask = (label, text, primary = false) => btn(esc(label), 'ask', `data-text="${esc(text)}"`, primary);
const ASK = {
  drug: v => `Tell me more about ${v.title || v.name}: what matters in its stage, dates and trials?`,
  landscape: v => `Give me the picture of ${v.title}: who leads and what comes next?`,
  trials: v => `What do the trials for ${v.title} tell us?`,
  catalysts: v => `Which of the upcoming dates in ${v.area || 'every area'} matter most, and why?`,
  who: v => `Who runs the most ${v.area} trials, and what does that tell us?`,
  changes: () => 'What changed, and what matters most?',
};
const dl = rows => `<dl>${rows.filter(r => r[1]).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const nextLine = n => (n ? `<b>${esc(n.label)}</b> · ${esc(n.what)}` : '');
const dated = (rows, text) => `<div class="dates">${rows.map(r => `<span>${esc(r.label)}</span><span>${text(r)}</span>`).join('')}</div>`;
const peekBox = (body, buttons) => `<div class="peek">${body}${buttons ? `<div class="pb">${buttons}</div>` : ''}</div>`;
const peekRow = html => `<li class="peekrow">${html}</li>`;
const left4 = (n, what) => (n > 4 ? `<div class="pmore">${countWords(n - 4, 'more ' + what)}</div>` : '');
const PEEK = {
  row: r => peekBox(dl([['How it works', esc(r.how)], ['Next', nextLine(r.next)]]), ask(`Ask about ${r.name}`, ASK.drug(r)) + openBtn(drugUrl(r.id))),
  found: d => peekBox(dl([['How it works', esc(d.how)], ['Made by', esc(d.company)], ['Trials', num(d.trials)]]), ask(`Ask about ${d.name}`, ASK.drug(d))),
  drug: v => peekBox(dl([['Made by', esc(v.companies.join(', '))], ['Trials', `${num(v.active)} active of ${num(v.total)}`], ['Next', nextLine(v.next)], ['What it does', esc(v.plain || v.how)]]), ask(`Ask about ${v.title}`, ASK.drug(v)) + openBtn(v.link)),
  landscape: v => peekBox(dl([['Drugs', `${num(v.total)}${v.phase_min ? ` in Phase ${v.phase_min} or later` : ''}`], ['Furthest along', v.rows[0] ? `${esc(v.rows[0].name)} · ${esc(v.rows[0].stage)}` : ''], ['Next', v.next ? `<b>${esc(v.next.label)}</b> · ${esc(v.next.drug)} · ${esc(v.next.what)}` : '']]), ask('Ask about this', ASK.landscape(v)) + openBtn(v.link)),
  trials: v => peekBox(dated(v.rows.slice(0, 4).map(x => ({ ...x, label: x.completes || '—' })), x => `${esc(x.phase)} · ${esc(x.title)}`) + left4(v.rows.length, 'trial'), ask('Ask about these trials', ASK.trials(v)) + openBtn(v.link)),
  catalysts: v => peekBox(dated(v.rows.slice(0, 4), r => `${esc(r.drug)} · ${esc(r.what)}${r.soon ? ' <span class="tag soon">soon</span>' : ''}`) + left4(v.count, 'date'), ask('Ask about these dates', ASK.catalysts(v)) + openBtn(v.link)),
  who: v => peekBox(dl(v.sponsors.slice(0, 3).map(s => [`${num(s.active)} trials`, esc(s.name)])), ask('Ask about these sponsors', ASK.who(v)) + openBtn(v.link)),
  changes: v => (v.free ? peekBox(`<p>${esc(v.text)}</p>`, openBtn(v.link)) : peekBox(dated(v.groups.flatMap(g => g.rows).slice(0, 4), r => `${esc(r.drug)} · ${esc(r.text)}`), ask('Ask what changed', ASK.changes()) + openBtn(v.link))),
  search: v => peekBox(dl(v.drugs.slice(0, 3).map(d => [d.name, esc(d.how || d.company)])), ''),
  note: v => peekBox(`<p>${esc(v.text)}</p>`, openBtn(v.link)),
};
// Past the first rows of an unfolded list: the rest is on the website. Before unfolding: "N more", which unfolds.
const unfold = (v, left, what) => (left > 0 ? `<div class="more"${more ? ` data-act="link" data-url="${esc(v.link)}">${countWords(left, 'more ' + what)} on OpenLandscape ↗` : ` data-act="more">${countWords(left, 'more ' + what)}`}</div>` : '');

// ---------- in the chat ----------
const SHORT = {
  welcome(v) {
    const stats = v.paid
      ? [['Plan', v.plan, 'Every list in full'], ['Lookups', '300 a day', ''], ['Following', v.follows.length ? num(v.follows.length) : 'Nothing yet', v.follows.slice(0, 2).map(title).join(', ') || 'Up to 5']]
      : [['Plan', 'Free', 'Top 10 of each list'], ['Lookups', `${num(v.lookups.left)} of ${num(v.lookups.of)}`, 'left this month'], ['Free landscape', v.free_landscape || 'Not picked', v.free_landscape ? 'In full' : 'Any one, in full']];
    return `<section class="box card">${head('logo', 'OpenLandscape', null, v.email)}
<div class="stats">${stats.map(([k, val, s]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(val)}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>
<div class="hint">Ask in plain words, for example:</div>
<div class="chips">${v.asks.map(q => `<button class="chip" type="button" data-act="ask" data-text="${esc(q)}">${esc(q)}</button>`).join('')}</div></section>`;
  },
  // Compact in the chat: one line per drug. The top line says in words what it
  // counts ("1 Filed · 5 Phase 3 · 2 Phase 2" alone was not clear). A tap on a drug opens its peek in place.
  landscape(v) {
    const n = more ? UNFOLD : v.top || 5, rows = v.rows.slice(0, n);
    const richer = name => (v.rich || []).find(p => p.view === 'drug' && p.title === name);
    const left = v.rows.length - rows.length;
    return `<section class="box card">${chead('pill', v.title, `${countWords(v.total, 'drug')}${v.phase_min ? ` in Phase ${v.phase_min} or later` : ''}${v.by_phase.length ? ': ' + v.by_phase.map(b => `${num(b.count)} ${stageWords(b.name)}`).join(', ') : ''}`)}
${rows.length ? `<ul class="drows">${rows.map(r => { const key = 'd:' + r.name, open = peek === key;
    return `<li data-act="drug" data-name="${esc(r.name)}" aria-expanded="${open}"${open ? ' class="open"' : ''}><span class="dn"><b>${esc(r.name)}</b><span class="co">${esc(r.company)}${r.more ? ` +${r.more}` : ''}</span></span><span class="ds">${meter(r.level)}${esc(r.stage)}${r.where ? `<span class="wh"> ${esc(r.where)}</span>` : ''}</span><span class="dd">${r.next ? `${esc(r.next.label)}${r.next.soon ? '<span class="tag soon">soon</span>' : ''}` : '—'}</span></li>${open ? peekRow(richer(r.name) ? PEEK.drug(richer(r.name)) : PEEK.row(r)) : ''}`; }).join('')}
${left > 0 ? (more ? `<li class="more" data-act="link" data-url="${esc(v.link)}">${num(left)} more on OpenLandscape ↗</li>` : `<li class="more" data-act="more">${num(left)} more ${left === 1 ? 'drug' : 'drugs'} ${ICONS.chevron}</li>`) : ''}</ul>` : '<div class="empty">No drugs here yet.</div>'}
${meterBox(v.cut || v.limit)}
${foot(v, (left > 0 && !more ? btn(seeAll(v.rows.length), 'more', '', true) : '') + openBtn(v.link))}</section>`;
  },
  drug(v) {
    return `<section class="box card">${head('pill', v.title, null, v.aliases.slice(0, 3).join(' · '))}
<div class="facts"><span>${meter(v.level)}<b>${a(v.stage_url, esc(v.stage))}</b>${v.where ? ` ${esc(v.where)}` : ''}</span><span>Next <b>${v.next ? a(v.next.url, esc(v.next.label)) : '—'}</b>${v.next?.what ? ` · ${esc(v.next.what)}` : ''}</span><span><b>${num(v.active)}</b> active trials of ${num(v.total)}</span></div>
<div class="about"><div class="co">${esc(v.companies.join(' · '))}${v.how ? ` · ${esc(v.how)}` : ''}</div>${v.plain ? `<p>${esc(v.plain)}</p>` : ''}</div>
${foot(v, ask('Ask about this', ASK.drug(v), true) + openBtn(v.link))}</section>`;
  },
  trials(v) {
    const rows = v.rows.slice(0, more ? UNFOLD : v.top || 5), left = v.rows.length - rows.length;
    return `<section class="box card">${chead('pill', `Trials · ${v.title}`, countWords(v.count, 'trial'))}
${trialsTable(rows, true)}${unfold(v, left, 'trial')}
${foot(v, (left > 0 && !more ? btn(seeAll(v.rows.length), 'more', '', true) : '') + openBtn(v.link))}</section>`;
  },
  catalysts(v) {
    const rows = v.rows.slice(0, more ? UNFOLD : v.top || 6), left = v.rows.length - rows.length;
    return `<section class="box card">${chead('calendar', `Coming up · ${v.title}`, `${countWords(v.count, 'date')} in the next ${monthsWords(v.days)} · Phase 2 and later`)}
${dateFeed(rows)}${unfold(v, left, 'date')}${foot(v, (left > 0 && !more ? btn(seeAll(v.rows.length), 'more', '', true) : '') + openBtn(v.link))}</section>`;
  },
  who(v) {
    const list = v.sponsors.slice(0, more ? 15 : 6);
    return `<section class="box card">${chead('pill', `Who runs ${v.area} trials`, `${countWords(v.active, 'active trial')} · ${[phaseWords(v.phase), v.country].filter(Boolean).join(' · ')}`)}
${bars(list)}${foot(v, (v.sponsors.length > list.length && !more ? btn('More sponsors', 'more', '', true) : '') + openBtn(v.link))}</section>`;
  },
  changes(v) {
    if (v.free) return `<section class="box card">${chead('pulse', 'What changed', v.free.area ? `${countWords(v.free.count, 'change')} in the last ${v.days} days · ${title(v.free.area)}` : '')}<div class="say">${esc(v.text)}</div>${foot(v, openBtn(v.link))}</section>`;
    const all = v.groups.flatMap(g => g.rows.map(r => ({ ...r }))), rows = all.slice(0, more ? UNFOLD : 5), n = v.groups.reduce((s, g) => s + g.count, 0);
    return `<section class="box card">${chead('pulse', 'What changed', `${countWords(n, 'change')} in the last ${v.days} days · ${v.groups.map(g => g.title).join(', ')}`)}
${rows.length ? changeFeed(rows) : '<div class="empty">Nothing changed in this time.</div>'}
${foot(v, (all.length > rows.length && !more ? btn(seeAll(all.length), 'more', '', true) : '') + openBtn(v.link))}</section>`;
  },
  search(v) {
    return `<section class="box card">${head('search', `Search ${v.title}`, null)}
${v.drugs.length ? `<table class="land"><thead class="dh"><tr><th>Drug</th><th>How it works</th><th>Trials</th></tr></thead><tbody>${v.drugs.slice(0, 6).map(d => { const open = peek === 'd:' + d.name;
      return `<tr data-act="drug" data-name="${esc(d.name)}" aria-expanded="${open}"${open ? ' class="open"' : ''}><td><div class="drug">${esc(d.name)}</div><div class="co">${esc(d.company)}</div></td><td><div class="mech">${esc(d.how || '—')}</div></td><td class="n">${num(d.trials)}</td></tr>${open ? `<tr class="peekrow"><td colspan="3">${PEEK.found(d)}</td></tr>` : ''}`; }).join('')}</tbody></table>` : ''}
${v.companies.length || v.conditions.length ? `<ul class="feed efeed small">${v.companies.slice(0, 3).map(c => `<li><span class="when">Sponsor</span><span class="ev">${esc(c.name)}<span class="src"> · ${num(c.active)} active trials</span></span></li>`).join('')}${v.conditions.slice(0, 3).map(c => `<li><span class="when">Disease</span><span class="ev">${esc(c.name)}<span class="src"> · ${num(c.trials)} trials</span></span></li>`).join('')}</ul>` : ''}
${!v.drugs.length && !v.companies.length && !v.conditions.length ? '<div class="empty">Nothing found under that name.</div>' : ''}
${meterBox(v.limit)}${foot(v, '')}</section>`;
  },
  // One card per answer: the main thing as its own short card, the other parts of the answer as one row
  // each inside it (at most 4). A row opens its peek in place. A drug already in the main list gets no row of its own: its
  // peek in the list uses the part's fuller data.
  show(v) {
    const inList = name => v.main.view === 'landscape' && v.main.rows.slice(0, more ? UNFOLD : 3).some(r => r.name === name);
    const parts = v.parts.map((p, i) => [p, i]).filter(([p]) => !(p.view === 'drug' && inList(p.title))).slice(0, 4);
    const main = SHORT[v.main.view]({ ...v.main, lookups: v.lookups, top: v.parts.length ? 3 : 0, rich: v.parts });
    if (!parts.length) return main;
    const rows = `<div class="parts"><div class="phint">Also in this answer</div><ul>${parts.map(([p, i]) => { const [ic, name, sub, soon] = partLine(p), open = peek === 'p:' + i;
      return `<li data-act="part" data-i="${i}" tabindex="0" role="button" aria-expanded="${open}"${open ? ' class="open"' : ''}>${ICONS[ic] || ''}<span class="pt"><b>${esc(name)}${soon ? '<span class="tag soon">soon</span>' : ''}</b><span class="ps">${sub}</span></span><span class="go">${ICONS.chevron}</span></li>${open ? peekRow((PEEK[p.view] || PEEK.note)(p)) : ''}`; }).join('')}</ul></div>`;
    const at = main.lastIndexOf('<div class="foot">');
    return at >= 0 ? main.slice(0, at) + rows + main.slice(at) : main.replace(/<\/section>\s*$/, rows + '</section>');
  },
  limit(v) { return `<section class="box card">${v.title ? head('', v.title, null) : ''}${meterBox(v.meter)}</section>`; },
  note(v) { return `<section class="box card">${v.title ? head('info', v.title, null) : ''}<div class="say">${esc(v.text)}</div>${foot(v, openBtn(v.link))}</section>`; },
};
// A part of the answer in one row: icon, name, what it says (already escaped).
const n3 = v => v.by_phase.filter(b => /Approved|Filed|Phase 3|market/i.test(b.name)).reduce((s, b) => s + b.count, 0);
const partLine = v => {
  switch (v.view) {
    case 'landscape': return ['pill', v.title, esc(`${num(v.total)} drugs · ${num(n3(v))} in Phase 3 or later`)];
    case 'drug': return ['pill', v.title, `${meter(v.level)}${esc(v.stage)}${v.where ? ' ' + esc(v.where) : ''}${v.next ? esc(` · next date ${v.next.label}`) : ''}`];
    case 'trials': return ['pill', `Trials · ${v.title}`, esc(`${num(v.count)} trials`)];
    case 'catalysts': return ['calendar', `Coming up · ${v.title}`, esc(`${num(v.count)} dates in the next ${monthsWords(v.days)}${v.rows[0] ? ` · next ${v.rows[0].label}, ${v.rows[0].drug}` : ''}`), !!v.rows[0]?.soon];
    case 'who': return ['pill', `Who runs ${v.area} trials`, esc(`${num(v.active)} active trials${v.sponsors[0] ? ` · ${v.sponsors[0].name} runs ${num(v.sponsors[0].active)}` : ''}`)];
    case 'changes': { const n = v.free ? v.free.count : v.groups.reduce((s, g) => s + g.count, 0); return ['pulse', 'What changed', esc(`${num(n)} ${n === 1 ? 'change' : 'changes'} in the last ${v.days} days${v.free?.area ? ` · ${title(v.free.area)}` : v.groups.length ? ` · ${v.groups.map(g => g.title).join(', ')}` : ''}`)]; }
    case 'search': return ['search', `Search ${v.title}`, esc(`${num(v.drugs.length)} drugs · ${num(v.companies.length)} sponsors · ${num(v.conditions.length)} diseases`)];
    default: return ['info', v.title || 'Note', esc(v.text || '')];
  }
};
// 180 or 182 days both read "6 months" (the AI picks its own number).
const monthsWords = d => (d >= 56 && Math.abs(d / 30.4 - Math.round(d / 30.4)) < 0.15 ? `${Math.round(d / 30.4)} months` : `${d} days`);
const trialsTable = (rows, short) => `<table class="trials"><thead><tr><th>Trial</th><th>Phase</th><th>Completes</th>${short ? '' : '<th>What it tests</th>'}</tr></thead><tbody>${rows.map(x => `<tr><td class="tn"><div>${a(x.url, `<span class="mono">${esc(x.nct)}</span>`)}</div>${short ? `<div class="tw">${esc(x.title)}</div>` : ''}</td><td class="tp">${esc(x.phase)}<span class="sub">${esc(x.status)}</span></td><td class="tc">${esc(x.completes || '—')}</td>${short ? '' : `<td class="tw" title="${esc(x.title)}">${esc(x.title)}</td>`}</tr>`).join('')}</tbody></table>`;
const dateFeed = rows => `<ul class="feed efeed">${rows.map(r => `<li><span class="when">${esc(r.label)}</span><span class="ev">${a(r.url, `${esc(r.drug)} · ${esc(r.what)}`)}${r.soon ? '<span class="tag soon">soon</span>' : ''}<span class="src">${r.sponsor ? ' · ' + esc(r.sponsor) : ''}${r.news ? ' · press release' : ''}</span></span></li>`).join('')}</ul>`;
const changeFeed = rows => `<ul class="feed efeed">${rows.map(r => `<li><span class="when">${esc(r.label)}</span><span class="ev">${a(r.url, `${esc(r.drug)} · ${esc(r.text)}`)}</span></li>`).join('')}</ul>`;
const bars = list => {
  const top = Math.max(1, ...list.map(s => s.active));
  return `<div class="bars">${list.map(s => `<div class="r"><span>${esc(s.name)}</span><i style="width:${Math.max(4, Math.round((s.active / top) * 100))}%"></i><span class="n">${num(s.active)}</span></div>`).join('')}</div>`;
};

// ---------- a page opened inside the card ----------
// The bar on top of every page: back one page, or back to the card.
const back = () => `<div class="topbar"><button class="btn sm" type="button" data-act="back">‹ ${stack.length > 1 ? esc(stack[stack.length - 2].title || 'Back') : 'Back'}</button></div>`;
// Long lists show 25 first, then all of them on a tap, so the card does not run on down the chat.
const FIRST = 25;
const firstOf = (v, list) => (v.all ? list : list.slice(0, FIRST));
const allBtn = (v, list) => (!v.all && list.length > FIRST ? `<div class="foot">${btn(`Show all ${num(list.length)}`, 'all')}</div>` : '');
const page = (h1, desc, body, acts = '') => `<div class="full">${back()}<div class="phead"><h1>${esc(h1)}</h1>${desc ? `<p class="desc">${desc}</p>` : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}${body}</div>`;
const statsFour = list => `<div class="stats four">${list.map(([k, v, s]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="s">${esc(s || ' ')}</div></div>`).join('')}</div>`;
const FULL = {
  landscape(v) {
    const top = v.rows[0];
    return page(v.title, `${num(v.total)} drugs in ${num(v.trials)} active trials · ${esc(phaseWords(v.phase_min))}`,
      statsFour([['Drugs', num(v.total), `${num(v.companies)} companies`], ['Furthest along', top ? `${meter(top.level)}${esc(top.stage)}` : '—', top ? `${top.name}${top.where ? ', ' + top.where : ''}` : ''],
        ['Phase 3 or later', num(v.by_phase.filter(b => /Approved|Filed|Phase 3|market/i.test(b.name)).reduce((s, b) => s + b.count, 0)), `of ${num(v.total)}`],
        ['Next date', v.next ? `${esc(v.next.label)}${v.next.soon ? ' <span class="tag soon">soon</span>' : ''}` : '—', v.next ? `${v.next.drug} · ${v.next.what}` : '']])
      + meterBox(v.cut || v.limit)
      + `<section class="box tablebox">${head('pill', 'Drugs', v.rows.length)}<table class="land"><thead class="dh"><tr><th>Drug</th><th>How it works</th><th>Company</th><th>Stage</th><th>Next date</th><th></th></tr></thead><tbody>${firstOf(v, v.rows).map((r, i) => `<tr data-i="${i}" data-act="drug" data-name="${esc(r.name)}"><td><div class="drug">${esc(r.name)}</div></td><td><div class="mech">${esc(r.how || '—')}</div></td><td><div class="co">${esc(r.company)}${r.more ? ` <span class="plus">+${r.more}</span>` : ''}</div></td>${stageCell(r)}${nextCell(r.next)}<td class="end"><span class="rowbtn">${ICONS.arrow}</span></td></tr>`).join('')}</tbody></table>${allBtn(v, v.rows)}${v.total > v.rows.length && (v.all || v.rows.length <= FIRST) ? `<div class="foot"><span class="muted small">The first ${num(v.rows.length)} here, all ${num(v.total)} on OpenLandscape.</span>${openBtn(v.link)}</div>` : ''}</section>`
      + srcLine(v),
      btn('Upcoming dates', 'tool', `data-tool="catalysts" data-args="${esc(JSON.stringify({ area: v.area, days_ahead: 180 }))}"`) + btn('Who runs the trials', 'tool', `data-tool="who_runs_trials" data-args="${esc(JSON.stringify({ area: v.area, phase: Math.max(1, v.phase_min || 1) }))}"`) + openBtn(v.link));
  },
  drug(v) {
    return page(v.title, esc([...v.companies, ...v.aliases].join(' · ')),
      statsFour([['Stage', `${meter(v.level)}${a(v.stage_url, esc(v.stage))}`, [v.where, v.news ? 'press release' : ''].filter(Boolean).join(' · ')],
        ['Next date', v.next ? a(v.next.url, esc(v.next.label)) : '—', v.next?.what], ['Trials', `${num(v.active)} active`, `${num(v.total)} in total`], ['Targets', esc(v.targets.join(' · ') || '—'), '']])
      + `<div class="duo"><section class="box">${head('calendar', 'Coming up', v.coming.length)}${v.coming.length ? `<ul class="feed efeed">${v.coming.map(c => `<li><span class="when">${esc(c.label)}</span><span class="ev">${a(c.url, esc(c.what))}<span class="src"> · ${esc(c.src)}</span></span></li>`).join('')}</ul>` : '<div class="empty">No dates in the registry.</div>'}</section>
<section class="box">${head('info', 'How it works', null)}<div class="pad">${v.plain ? esc(v.plain) : esc(v.how || 'Not classified yet.')}${v.how && v.plain ? `<div class="muted small">${esc(v.how)}</div>` : ''}${v.tested_for.length ? `<div class="muted small tested">Tested for ${esc(v.tested_for.slice(0, 4).map(t => t.name).join(', '))}${v.tested_for.length + v.tested_more > 4 ? ` and ${num(v.tested_for.length + v.tested_more - 4)} more` : ''}.</div>` : ''}</div></section></div>`
      + `<section class="box">${head('pill', 'Active trials', v.active)}${v.trials.length ? trialsTable(v.trials, false) : '<div class="empty">No active trials.</div>'}${v.total > v.trials.length ? `<div class="foot">${btn(`All ${num(v.total)} trials`, 'tool', `data-tool="trials" data-args="${esc(JSON.stringify({ drug: v.title, status: 'all', limit: 200 }))}"`)}</div>` : ''}</section>`
      + srcLine(v),
      btn('Ask about this', 'ask', `data-text="${esc(`Tell me more about ${v.title}: what matters in its stage, dates and trials?`)}"`) + openBtn(v.link));
  },
  trials(v) { return page(`Trials · ${v.title}`, `${num(v.count)} trials${v.count > v.rows.length ? `, showing ${num(v.rows.length)}` : ''}`, `<section class="box">${trialsTable(firstOf(v, v.rows), false)}${allBtn(v, v.rows)}</section>` + srcLine(v), openBtn(v.link)); },
  catalysts(v) { return page(`Coming up · ${v.title}`, `${num(v.count)} dates in the next ${monthsWords(v.days)} · “Completes” is the planned primary completion; results usually come later.`, `<section class="box">${dateFeed(firstOf(v, v.rows))}${allBtn(v, v.rows)}</section>` + srcLine(v), openBtn(v.link)); },
  who(v) {
    return page(`Who runs ${v.area} trials`, `${num(v.active)} active trials · ${esc([phaseWords(v.phase), v.country].filter(Boolean).join(' · '))}`,
      `<div class="duo"><section class="box">${head('pill', 'Sponsors', v.sponsors.length)}${bars(v.sponsors)}</section>
<section class="box">${head('info', 'Sites', v.sites.length)}<ul class="feed efeed sites">${v.sites.map(s => `<li><span class="when">${num(s.active)}</span><span class="ev">${esc(s.name)}<span class="src"> · ${esc([s.city, s.country].filter(Boolean).join(', '))}</span></span></li>`).join('')}</ul></section></div>` + srcLine(v), openBtn(v.link));
  },
  changes(v) {
    if (v.free) return SHORT.changes(v);
    return page('What changed', `Last ${v.days} days`, v.groups.map(g => `<section class="box">${head('pulse', g.title, g.count)}${g.rows.length ? changeFeed(g.rows) : '<div class="empty">Nothing changed in this time.</div>'}</section>`).join('') + srcLine(v), openBtn(v.link));
  },
  search(v) { return SHORT.search(v); },
  show(v) { return (FULL[v.main.view] || SHORT[v.main.view])(v.main); },
};
const srcLine = v => (asOf(v) ? `<p class="srcline">${esc(asOf(v))}</p>` : '');

// ---------- drawing and clicks ----------
function draw() {
  const v = mode === 'page' && stack.length ? stack[stack.length - 1] : base;
  if (!v) { root.innerHTML = ''; return; }
  const f = (mode === 'page' ? FULL[v.view] : null) || SHORT[v.view];
  root.className = mode === 'page' ? 'is-full' : 'is-inline';
  root.classList.toggle('big', big);
  root.innerHTML = f ? f(v) : '';
  root.scrollTop = 0;
  // Our own "open bigger" icon where the app draws none of its own (Claude has one above the card).
  if (mode === 'inline' && ownBig()) root.querySelector('.boxhead')?.insertAdjacentHTML('beforeend', `<button class="bigbtn" type="button" data-act="big" aria-label="Open bigger" title="Open bigger">${ICONS.expand}</button>`);
}
const ownBig = () => (app.getHostContext()?.availableDisplayModes || []).includes('fullscreen') && !/claude/i.test(app.getHostVersion()?.name || '');
function theme(ctx) {
  if (ctx?.theme) document.documentElement.dataset.theme = ctx.theme === 'dark' ? 'dark' : 'light';
  // The person chose the bigger view (Claude's own expand icon, or ours): the page fills it; back to the chat, the card.
  const full = ctx?.displayMode === 'fullscreen';
  if (full !== big) { big = full; if (big) { if (mode !== 'page') { stack = [base]; mode = 'page'; } draw(); } else toCard(); }
}
// In the bigger view, a click opens the next page on top; "‹ Back" returns to the one before.
function openPage(v) {
  if (mode !== 'page') stack = [];
  stack.push(v || base);
  mode = 'page';
  draw();
}
function toCard() {
  if (big) { big = false; app.requestDisplayMode({ mode: 'inline' }).catch(() => {}); }
  mode = 'inline'; stack = base ? [base] : []; draw();
}
async function goBig() {
  try { const r = await app.requestDisplayMode({ mode: 'fullscreen' }); if (r?.mode === 'fullscreen') { big = true; if (mode !== 'page') { stack = [base]; mode = 'page'; } draw(); } } catch { /* stays in the chat */ }
}
async function callTool(name, args, el) {
  if (el) { el.setAttribute('aria-busy', 'true'); el.classList.add('busy'); }
  try {
    const r = await app.callServerTool({ name, arguments: args });
    const v = r?.structuredContent;
    if (v) openPage(v);
  } catch { /* nothing new to show */ } finally { if (el) { el.removeAttribute('aria-busy'); el.classList.remove('busy'); } }
}
root.addEventListener('click', e => {
  const link = e.target.closest('a[href]:not([data-act])');
  if (link) { e.preventDefault(); const href = link.getAttribute('href'); if (/^https?:/.test(href)) app.openLink({ url: href }).catch(() => {}); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  const act = el.dataset.act;
  if (act === 'big') goBig();
  else if (act === 'back') { if (stack.length > 1) { stack.pop(); draw(); } else toCard(); }
  else if (act === 'all') { stack[stack.length - 1].all = true; const y = root.scrollTop; draw(); root.scrollTop = y; }
  else if (act === 'link') app.openLink({ url: el.dataset.url }).catch(() => {});
  else if (act === 'ask') {   // the question goes into the chat; the card goes back to how it was
    // ChatGPT's own way scrolls the chat down to the question; the standard one leaves it out of view there.
    // Claude has no window.openai and keeps the standard one.
    const gpt = globalThis.openai?.sendFollowUpMessage;
    (gpt ? Promise.resolve(gpt.call(globalThis.openai, { prompt: el.dataset.text, scrollToBottom: true }))
      : app.sendMessage({ role: 'user', content: [{ type: 'text', text: el.dataset.text }] })).catch(() => {});
    peek = '';
    toCard();
  }
  // In the chat: a row opens its peek in place, a second tap closes it; one peek at a time. "See all" unfolds the list.
  else if (act === 'more') { more = true; draw(); }
  else if (act === 'part') { const k = 'p:' + el.dataset.i; peek = peek === k ? '' : k; draw(); }
  else if (act === 'drug' && mode === 'inline') { const k = 'd:' + el.dataset.name; peek = peek === k ? '' : k; draw(); }
  else if (act === 'drug') callTool('drug', { name: el.dataset.name }, el);
  else if (act === 'tool') callTool(el.dataset.tool, JSON.parse(el.dataset.args || '{}'), el);
});

app.ontoolresult = r => { base = r?.structuredContent || null; mode = 'inline'; stack = base ? [base] : []; peek = ''; more = false; draw(); };
app.onhostcontextchanged = ctx => theme({ ...app.getHostContext(), ...ctx });
app.connect().then(() => theme(app.getHostContext())).catch(() => {});
