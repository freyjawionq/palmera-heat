# Review note — candidate #3: car-to-car crash damage billed once per pair per call

## The bug

In `game/src/vehicles.js`, `collideCarWithWorld` tests every body circle
of one car against every body circle of the other car (2×2 pairs) and
applied crash damage plus a crash event **per overlapping circle pair**,
with no debounce. One physical contact in one call was therefore billed
several times.

## Baseline measurement

Headless, importing the real modules in Node (no DOM; a minimal canvas
stub only so `generateCity()` can paint its minimap):

- Two sedans at the open intersection `streetCenterX(5), streetCenterY(5)`,
  offset by (10, 6) so three of the four circle pairs overlap; car A at
  speed 300, car B stationary; a single `collideCarWithWorld(A, events)`
  call.
- Baseline result: **3 crash events** for the one pair in the one call.
  Damage was billed at impacts 300, 216 and 155.52 (speed is damped
  ×0.72 after each pair): car A hp **100 → 66.424**, car B hp
  **100 → 73.1392**. No world (building) events fired in this setup.

## The fix

`game/src/vehicles.js`, car-to-car section only: a per-call boolean
`pairBilled`, declared fresh for each `other` car inside
`collideCarWithWorld`. The damage branch now runs only when
`impact > 60 && !pairBilled`, and sets `pairBilled = true` as it bills —
so crash damage and the crash event are charged at most once per
unordered car pair per call. Push-apart separation and the per-pair
speed damping (×0.72) are untouched, as are the world-collision branch,
physics, speeds and every other file.

## Test evidence

`tests/collision-dedupe.test.mjs` (`node --test`), 3 tests, all passing:

1. **Once per pair per call** — the baseline setup above now yields
   exactly **1 crash event**, car A hp **100 → 85** (300 × 0.05) and
   car B hp **100 → 88** (300 × 0.04): the single-hit amount.
2. **Per call, not permanent** — after resetting the same pair, a second
   call bills again, exactly once (1 event, hp 85 / 88 again).
3. **World collision unchanged** — a sedan at speed 200 into the first
   generated building solid still produces the baseline result: 2 world
   crash events (one per body circle, none naming another car),
   hp **100 → 84.38**, final speed **14.8176**.

Also verified: `node --check` clean on all 12 modules under
`game/src/`, and the test setup itself asserts zero world events in the
car-to-car scenario so the two branches cannot mask each other.
