# REVIEW C3 — dedupe car-to-car crash damage (audit candidate #3)

Repo: freyjawionq/palmera-heat (PRIVATE)
Baseline: `1b6a46373b06ae4557f67eef486cb91cd3af021d`
Scope: ONLY the car-to-car section of `collideCarWithWorld` in
`game/src/vehicles.js`. Executed under the one-editor lock recorded in the
team Evernote workflow note (Muse/Kaname sole editor, 18:33 WIB).

## Defect (re-verified on the official HEAD before the fix)

`collideCarWithWorld` iterates `allCars()` × `carCircles(car)` (2 circles)
× `carCircles(other)` (2 circles). Whenever a circle pair overlapped and
`impact = |car.speed - other.speed| > 60`, it applied crash damage
(`car.hp -= impact*0.05`, `other.hp -= impact*0.04`) and pushed a
`{kind:'crash'}` event — per circle pair, with no dedupe. One impact
between the same two cars could be billed several times in a single call.

Measured on baseline (probe, two sport cars side by side, dy=10, speeds
300 vs 0 — 3 of the 4 circle pairs overlap):

- crash events for the pair: **3**
- car hp: 100 → 66.424 (loss 33.576 = 15 + 10.8 + 7.776 at impacts 300/216/155.52)
- other hp: 100 → 73.1392 (loss 26.8608)

## Fix

A per-call `pairDamaged` flag inside the `other` loop: damage + crash
event apply only on the first overlapping circle pair of each
(car, other) pair in that call. Unchanged, deliberately:

- push-apart physics and `car.speed *= 0.72` still run per circle pair;
- damage numbers (impact*0.05 / impact*0.04) and the `impact > 60` gate;
- skip rules (`other === car`; traffic vs parked);
- the world-collision section of the same function;
- every other file and every other audit candidate (#1, #2, #4–#8).

Diff: `game/src/vehicles.js` +6/−1, plus this review and the test file.

## Tests

Command (from repo root):

```
node tests/collision-dedupe.test.mjs
```

Headless: the import chain vehicles.js → city.js/utils.js/config.js
touches no DOM at import time; `generateCity()` is never called, so
`city.solids` stays `[]` and the world-collision section is a no-op in
the harness (asserted in the test). Cases: (a) multi-pair overlap,
(b) single-pair overlap (parity), (c) no overlap, (d) traffic-vs-parked
skip. State is reset between cases; cars are built with the real
`makeCar` and registered in the real `traffic` lists so `allCars()`
sees them.

Baseline (clean clone @1b6a463, test file copied in) — exit 1:

```
FAIL  (a) multi-pair overlap: crash events for the pair: got 3, expected 1
FAIL  (a) multi-pair overlap: car hp: got 66.424, expected 85
FAIL  (a) multi-pair overlap: other hp: got 73.1392, expected 88
PASS  (b) single-pair overlap: crash events 1, car hp 90, other hp 92
PASS  (c) no overlap: 0 events, hp 100/100
PASS  (d) traffic vs parked: 0 events, hp 100/100
RESULT: FAIL (3 check(s) failed)
```

Candidate (fixed working tree) — exit 0:

```
PASS  (a) multi-pair overlap: crash events 1, car hp 85, other hp 88
PASS  (b) single-pair overlap: crash events 1, car hp 90, other hp 92
PASS  (c) no overlap: 0 events, hp 100/100
PASS  (d) traffic vs parked: 0 events, hp 100/100
RESULT: PASS (all checks)
```

Smoke: `node --check` on all 12 modules in `game/src/` — all OK.

## Limitations

- Only the car-to-car billing is exercised end-to-end here; the
  world-collision section shares the function but was out of scope and
  is a no-op in this harness (empty `city.solids`).
- The multi-pair case is one deterministic geometry (side-by-side,
  3 of 4 circle pairs overlapping); the dedupe is per pair per call and
  does not depend on that geometry.
- No claim is made about any official score effect; the scored Make.fun
  submission was not touched.
