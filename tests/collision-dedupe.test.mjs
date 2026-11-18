// collision-dedupe.test.mjs — regression test for audit candidate #3:
// collideCarWithWorld must bill crash damage + the crash event AT MOST
// ONCE per (car, other) pair per call, however many of the pair's body
// circles overlap. Push-apart physics and speed damping stay per pair.
//
// Run from the repo root:  node tests/collision-dedupe.test.mjs
// Exit code 0 = all cases pass, 1 = at least one failure.
//
// Headless by design: vehicles.js -> city.js/utils.js/config.js touch no
// DOM at import time, and generateCity() is never called, so
// city.solids stays [] and the world-collision section is a no-op here.

import { makeCar, traffic, collideCarWithWorld } from '../game/src/vehicles.js';
import { city } from '../game/src/city.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
}
function reset() {
  traffic.cars.length = 0;
  traffic.parked.length = 0;
}
function run(car, other, parkOther = false) {
  reset();
  if (parkOther) traffic.parked.push(other); else traffic.cars.push(other);
  traffic.cars.push(car);
  const events = [];
  collideCarWithWorld(car, events, false);
  return events.filter(e => e.kind === 'crash' && e.other === other).length;
}

if (city.solids.length !== 0) {
  console.log('FAIL  harness assumption: city.solids must be empty (generateCity not called)');
  process.exit(1);
}

// (a) Two sport cars side by side (dy=10): 3 of the 4 circle pairs overlap,
// impact 300. Baseline billed the same impact 3x (events=3, car hp loss
// 33.576, other hp loss 26.8608). Fixed: exactly 1 event, one billing at
// the first pair's impact: car -300*0.05 = -15, other -300*0.04 = -12.
{
  const car = makeCar('sport', 1000, 1000, 0); car.speed = 300;
  const other = makeCar('sport', 1000, 1010, 0); other.speed = 0;
  const n = run(car, other);
  check('(a) multi-pair overlap: crash events for the pair', n, 1);
  check('(a) multi-pair overlap: car hp', car.hp, 85);
  check('(a) multi-pair overlap: other hp', other.hp, 88);
}

// (b) Exactly one circle pair overlaps (sedans 40px apart nose-to-tail):
// parity case — 1 event and one billing before and after the fix.
// impact 200 -> car -10, other -8.
{
  const car = makeCar('sedan', 1000, 1000, 0); car.speed = 200;
  const other = makeCar('sedan', 1040, 1000, 0); other.speed = 0;
  const n = run(car, other);
  check('(b) single-pair overlap: crash events for the pair', n, 1);
  check('(b) single-pair overlap: car hp', car.hp, 90);
  check('(b) single-pair overlap: other hp', other.hp, 92);
}

// (c) No overlap at all: no damage, no event.
{
  const car = makeCar('sedan', 1000, 1000, 0); car.speed = 200;
  const other = makeCar('sedan', 1500, 1000, 0); other.speed = 0;
  const n = run(car, other);
  check('(c) no overlap: crash events for the pair', n, 0);
  check('(c) no overlap: car hp', car.hp, 100);
  check('(c) no overlap: other hp', other.hp, 100);
}

// (d) Traffic vs parked is skipped entirely, even fully overlapped at
// impact 300: no damage, no event.
{
  const car = makeCar('sport', 1000, 1000, 0); car.speed = 300; car.driver = 'traffic';
  const other = makeCar('sport', 1000, 1010, 0); other.speed = 0; other.driver = 'parked';
  const n = run(car, other, true);
  check('(d) traffic vs parked: crash events for the pair', n, 0);
  check('(d) traffic vs parked: car hp', car.hp, 100);
  check('(d) traffic vs parked: other hp', other.hp, 100);
}

reset();
if (failures > 0) {
  console.log(`\nRESULT: FAIL (${failures} check(s) failed)`);
  process.exit(1);
}
console.log('\nRESULT: PASS (all checks)');
