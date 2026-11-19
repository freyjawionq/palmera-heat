# Review note — candidate #3: car-to-car crash damage billed once per pair per call

## Bug

In `game/src/vehicles.js`, `collideCarWithWorld` tested every body circle
of one car against every body circle of the other (2×2 pairs) and applied
crash damage plus a crash event **per overlapping circle pair**, with no
debounce — one physical contact in one call was billed several times.

## Baseline measurement

Headless in Node against the real modules (minimal canvas stub only so
`generateCity()` can paint its minimap): two sedans at the open
intersection `streetCenterX(5), streetCenterY(5)`, offset (10, 6) so
three of the four circle pairs overlap; car A at speed 300, car B at 0;
one `collideCarWithWorld(A, events)` call.

Baseline: **3 crash events** for the one pair in the one call, damage
billed at impacts 300, 216 and 155.52 (speed damped ×0.72 after each
pair) — car A hp **100 → 66.424**, car B hp **100 → 73.1392**. No world
(building) events fired in this setup.

## Fix

Car-to-car section of `collideCarWithWorld` only: a per-call boolean
`billed`, declared fresh for each `other` car. The damage branch runs
only when `impact > 60 && !billed` and sets `billed = true` as it bills,
so crash damage and the crash event are charged at most once per
unordered car pair per call. Push-apart separation and the per-pair
speed damping (×0.72) are untouched, as are the world-collision branch,
physics, speeds and every other file.

## Test evidence

`tests/collision-dedupe.test.mjs` (`node --test`) — 3 tests, all passing:

1. **Once per pair per call** — the baseline setup now yields exactly
   **1 crash event**; car A hp **100 → 85** (300 × 0.05), car B hp
   **100 → 88** (300 × 0.04), the single-hit amounts.
2. **Per call, not permanent** — after resetting the pair, a second call
   bills again exactly once (1 event, hp 85 / 88 again).
3. **World collision unchanged** — a sedan at speed 200 into the first
   generated building solid reproduces the baseline exactly: 2 world
   crash events (none naming another car), hp **100 → 84.38**, final
   speed **14.8176**.

Also verified: `node --check` clean on all 12 modules under `game/src/`,
and the car-to-car setup asserts zero world events so the two collision
branches cannot mask each other.
