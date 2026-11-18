// The one icon set, used by the server pages and by the browser scripts.
// Rule: 24 grid, line 1.75, round ends, no fill. Two sizes: 20 (sidebar, menus, search field) and 16 (inside buttons and links).
// An icon always sits beside a word; open/close and close on their own get a spoken label from the button that holds them.
const PATHS = {
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  sun: '<circle cx="12" cy="12" r="3.75"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M12 3.5a6 6 0 0 0 8.5 8.5 8.5 8.5 0 1 1-8.5-8.5z"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  landscape: '<path d="M3 18.5 8 12l3 3.5 4.5-7L21 18.5"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5"/><path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5v5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9.5 8 5.5 12l4 4"/><path d="M5.5 12H15"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  updown: '<path d="m8 9.5 4-4 4 4"/><path d="m8 14.5 4 4 4-4"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',     // the setup guide: show every step
  shrink: '<path d="M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6"/>',     // and back to the small card
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chat: '<path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  pill: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.75"/><path d="M4.5 6v12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6M4.5 12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function icon(name, size = 20, cls = '') {
  return `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}
// The logo: a lens on a landscape. A circle with a ridge line inside, drawn as a line so it takes the text colour in light and dark.
export const LOGO_PATH = '<circle cx="12" cy="12" r="10"/><path d="M4.5 16.5 L8.5 11.5 L11 14 L15 8 L19.5 15"/>';
export const logo = (size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${LOGO_PATH}</svg>`;
