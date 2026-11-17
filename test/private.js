// The open-source copy leaves out the checked data and the tools that make it (public-copy/ in the private repo says
// what goes out). A check that needs them calls needsChecked() first: in the open-source copy it says SKIP and stops.
import { existsSync } from 'node:fs';

export const HAS_CHECKED_DATA = existsSync(new URL('../public-copy/', import.meta.url));

export const skip = what => console.log(`SKIP  ${what}: needs the checked data, which is not in the open-source copy`);

export function needsChecked(what) {
  if (HAS_CHECKED_DATA) return;
  console.log(`SKIP  ${what}: needs the checked data, which is not in the open-source copy`);
  process.exit(0);
}
