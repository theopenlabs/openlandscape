// A page that is not there (screen 4): one real 404 page in the frame you are in. Signed in, inside the sidebar with the search
// bar; signed out, under the website's top bar with the ready-made landscapes, which anyone can read. The title says what was
// not found. The admin pages, images, CSV files and the API keep their bare "Not found".
import { layout, footer, BRAND } from './shared.js';
import { searchForm, showcaseBox } from './app.js';
import { today } from '../query.js';
import { esc } from '../../web/table.js';

const WORDS = {
  drug: ['No drug at this address', 'The link may be cut short, or the drug was merged under another name.', 'Search for it by any of its names or codes.'],
  company: ['No company at this address', 'The link may be cut short, or the company is listed under another name.', 'Search for it by any of its names.'],
  target: ['No target at this address', 'The link may be cut short, or the target is listed under another name.', 'Search for it by its name.'],
  disease: ['No disease at this address', 'The link may be cut short, or the disease is listed under another name.', 'Search for it by its name.'],
  landscape: ['No landscape at this address', 'There is no ready-made landscape here, or it moved.', 'Search the disease or target instead.'],
  page: ['Page not found', 'Nothing lives at this address.', 'Search a disease, drug, target or company.'],
  // A drug page past the account's allowance of different drugs (src/limits.js): `title` and `box` (web/table.js limitBox).
  limit: ['', '', ''],
};
// `side`: the signed-in sidebar, or '' for the top bar. `showcase`: the ready-made landscapes (signed out).
// `title` and `box`: a drug past the account's allowance (kind 'limit'): its heading and the grey limit box, then the search.
export function notFoundPage({ kind = 'page', user = null, side = '', showcase = [], title: t = '', box = '' } = {}) {
  const [title0, why, search] = WORDS[kind] || WORDS.page, title = t ? esc(t) : title0;
  if (box) return layout({ title: `${title} | ${BRAND}`, user, side, noindex: true,
    body: `<main class="wrap nf">\n<h1>${title}</h1>\n${box}\n${side ? searchForm('hform') : ''}\n</main>${side ? '<script type="module" src="/static/app.js"></script>' : footer()}` });
  return layout({
    title: `${title} | ${BRAND}`, user, side, noindex: true,
    body: `<main class="wrap nf">
<h1>${title}</h1>
<p class="desc">${why} ${side ? search : 'The ready-made landscapes are free to read.'}</p>
${side ? searchForm('hform') : showcaseBox(showcase, today().slice(0, 4))}
</main>${side ? '<script type="module" src="/static/app.js"></script>' : footer()}`,
  });
}
