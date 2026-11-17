// The setup guide (replaces Home's Get started box): a card in the bottom-right corner of every
// signed-in page in the app frame, with a bar and "Next: …"; it opens into the steps in sections and closes into a pill with
// a ring. src/server.js `guideFor` works out which steps are done; web/guide.js draws it from the data written here.
// Free: 5 steps. Solo: 6, the Monday email one ticked from the start. Open (17 Nov) ticks on the page of something they keep or follow. No Solo step on Free (Solo only where Free hits a wall).
import { esc } from '../../web/table.js';
import { heading } from '../suggest.js';
import { APP_HOME, SEARCH_PATH } from './frame.js';
import { WELCOME_PATH } from './start.js';

// The question to copy into the AI app, about the first thing kept or followed.
const question = f => {
  if (!f) return 'Which obesity drugs read out in the next six months, and who makes them?';
  const name = heading(f.query);
  return f.kind === 'drug' ? `What is the latest on ${name}, and when is its next date?`
    : f.kind === 'company' ? `What does ${name} have in Phase 3, and when do those trials read out?`
      : `Which ${name} drugs read out in the next six months, and who makes them?`;
};
// The Monday after today, as "Monday 23 Nov".
const nextMonday = today => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return `Monday ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
};

// `g`: from guideFor: { paid, done: [ids], fresh: [ids just ticked], finished, ai }. `first`: the first kept or followed item.
export function guideTag(g, { first = null, today = '' } = {}) {
  if (!g) return '';
  const name = first ? esc(heading(first.query)) : '';
  const done = new Set(g.done);
  const step = (id, title, sub, doneSub, act, extra = {}) => ({ id, title, sub, doneSub, act, done: done.has(id), fresh: g.fresh.includes(id), ...extra });
  const pick = g.paid
    ? step('pick', 'Follow your first landscape', 'Any disease, target, drug or company. Up to 5.', name, ['Search', SEARCH_PATH])
    : step('pick', 'Pick your free landscape', 'One disease or target, in full, yours to keep.', `${name}, yours for good`, ['Pick one', WELCOME_PATH]);
  // Open it: picking never shows the landscape (onboarding goes on to Connect your AI), so this step takes them there.
  const what = first?.kind === 'drug' ? 'Its trials, where it stands and what’s coming next.'
    : first?.kind === 'company' ? 'Its drugs, where each stands and what’s coming next.' : 'Every drug, who makes it and what’s coming next.';
  const open = step('open', name ? `Open ${name}` : 'Open your landscape', what, 'Seen', ['Open it', first ? esc(first.href) : ''],
    { after: 'pick', why: g.paid ? 'Once you follow one' : 'Once you’ve picked one' });
  const sections = [
    { title: g.paid ? 'Follow' : 'Your free landscape', steps: [pick, open,
      step('search', 'Search something of your own', g.paid ? 'Any disease, drug or company. Every list opens in full.' : 'Any disease, drug or company. You see the top 10.', 'Done', ['Search', SEARCH_PATH])] },
    { title: 'Your AI assistant', steps: [
      step('connect', 'Connect your AI', 'Add OpenLandscape to Claude or ChatGPT once. Then ask in plain words; every answer links to its source.', g.ai ? `${esc(g.ai)} is connected` : 'Connected', ['Connect your AI', `${APP_HOME}#mcp`]),
      step('ask', name ? `Ask it about ${name}` : 'Ask it a first question', 'Copy this into your AI app:', 'Your first question is answered', ['Copy the question', ''], { after: 'connect', why: 'Once your AI is connected', q: esc(question(first)) })] },
  ];
  if (g.ids.includes('monday')) sections.push({ title: 'Every Monday', steps: [step('monday', 'Your Monday email is on', '', `The first one comes on ${nextMonday(today)}. Turn it off from any email.`, null)] });
  const data = { sections, finished: g.finished, home: !!g.home };
  // JSON inside a script: "<" written as \u003c so no text can close the tag.
  return `<script type="application/json" id="guide-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script type="module" src="/static/guide.js"></script>`;
}
