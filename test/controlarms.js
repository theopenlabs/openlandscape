// Checks the rule that decides, from a trial's arm labels, whether it uses a drug only as a control (src/owners.js).
import { usedOnlyAsControl } from '../src/owners.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const arm = (type, ...names) => ({ type, names });
const E = 'EXPERIMENTAL', A = 'ACTIVE_COMPARATOR', P = 'PLACEBO_COMPARATOR';

ok(usedOnlyAsControl([arm(E, 'hrs-6209'), arm(A, 'palbociclib')], 'Palbociclib'), 'a drug only in the active comparator arm is a control');
ok(!usedOnlyAsControl([arm(E, 'hrs-6209'), arm(A, 'palbociclib')], 'HRS-6209'), 'the drug in the experimental arm is not');
ok(usedOnlyAsControl([arm(E, 'durvalumab', 'bcg'), arm(A, 'bcg')], 'BCG'), 'in both arms while another drug is only in the experimental arm: background');
ok(!usedOnlyAsControl([arm(E, 'durvalumab', 'bcg'), arm(A, 'bcg')], 'Durvalumab'), 'the added drug is the one tested');
ok(!usedOnlyAsControl([arm(E, 'drug x'), arm(A, 'drug x')], 'Drug X'), 'the same drug in both arms, nothing else tested (a dose comparison): not a control');
ok(!usedOnlyAsControl([arm(E, 'drug x', 'placebo'), arm(P, 'drug x', 'placebo')], 'Drug X'), 'placebo does not count as another tested drug');
ok(!usedOnlyAsControl([arm(A, 'drug a'), arm(A, 'drug b')], 'Drug A'), 'no experimental arm: nothing to go on');
ok(!usedOnlyAsControl([], 'Drug A'), 'no arms: nothing to go on');
ok(!usedOnlyAsControl([arm(E, 'drug b'), arm(A, 'drug c')], 'Drug A'), 'a name the arms do not list: nothing to go on');
