// collision-dedupe.test.mjs — regression test for candidate #3:
// car-to-car crash damage and crash events must be billed at most once
// per unordered car pair per collideCarWithWorld call.
//
// Baseline behaviour (measured headlessly on the pre-fix code): two
// sedans overlapping at an intersection, speeds 300 vs 0, produced 3
// crash events in ONE call and billed damage three times
// (hp 100 -> 66.424 and 100 -> 73.1392). After the fix the same setup
// must produce exactly 1 crash event and the single-hit hp loss
// (100 -> 85 and 100 -> 88).
//
// Run: node --test tests/collision-dedupe.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// generateCity() also paints a minimap onto a canvas; give it the
// smallest possible headless canvas stub. The game modules themselves
// import and run with no DOM at all.
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  }),
};

const { makeCar, collideCarWithWorld, traffic } = await import('../game/src/vehicles.js');
const { city, generateCity, streetCenterX, streetCenterY } = await import('../game/src/city.js');

generateCity();

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

// Two sedans at an open intersection (no building solid overlaps their
// circles), offset by (10, 6) so three of the four circle pairs overlap.
// Car A at speed 300, car B stationary: impact at the first hit is 300,
// so one billing costs A 300 * 0.05 = 15 hp and B 300 * 0.04 = 12 hp.
function setupPair() {
  const x = streetCenterX(5), y = streetCenterY(5);
  const a = makeCar('sedan', x, y, 0, null);
  const b = makeCar('sedan', x + 10, y + 6, 0, null);
  a.speed = 300; b.speed = 0;
  traffic.cars = [a, b];
  traffic.parked = [];
  return { a, b, x, y };
}

function resetPair({ a, b, x, y }) {
  a.x = x; a.y = y; a.speed = 300; a.hp = 100; a.dead = false;
  b.x = x + 10; b.y = y + 6; b.speed = 0; b.hp = 100; b.dead = false;
}

test('one call bills a multi-circle car-to-car contact exactly once', () => {
  const pair = setupPair();
  const events = [];
  collideCarWithWorld(pair.a, events, false);
  const carEvents = events.filter(e => e.other);
  const worldEvents = events.filter(e => !e.other);
  assert.equal(worldEvents.length, 0, 'setup must not touch any building solid');
  assert.equal(carEvents.length, 1, `expected exactly 1 crash event, got ${carEvents.length}`);
  near(pair.a.hp, 85);  // 100 - 300 * 0.05, billed once, not three times
  near(pair.b.hp, 88);  // 100 - 300 * 0.04
});

test('separate calls still bill separately (the dedupe is per call, not permanent)', () => {
  const pair = setupPair();
  collideCarWithWorld(pair.a, [], false);
  resetPair(pair);
  const events = [];
  collideCarWithWorld(pair.a, events, false);
  const carEvents = events.filter(e => e.other);
  assert.equal(carEvents.length, 1, `second call must bill again once, got ${carEvents.length}`);
  near(pair.a.hp, 85);
  near(pair.b.hp, 88);
});

test('non-car world collision behaviour is unchanged', () => {
  // A sedan driven into the first generated building solid at speed 200.
  // Baseline values, measured on the pre-fix code: both body circles
  // resolve against the solid, each bills once (200 * 0.055 = 11, then
  // 84 * 0.055 = 4.62 after the speed loss), no event carries an `other`.
  const s = city.solids[0];
  const car = makeCar('sedan', s.x + s.w / 2, s.y + s.h / 2, 0, null);
  car.speed = 200;
  traffic.cars = [car];
  traffic.parked = [];
  const events = [];
  collideCarWithWorld(car, events, true);
  assert.equal(events.length, 2, `expected 2 world crash events, got ${events.length}`);
  assert.ok(events.every(e => e.kind === 'crash' && !e.other), 'world events must not name another car');
  near(car.hp, 84.38);
  near(car.speed, 14.8176);
});
