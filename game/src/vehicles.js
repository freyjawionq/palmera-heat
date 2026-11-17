// vehicles.js — every car in Palmera: the models, the traffic that drives
// them, parked cars, the one-off Azure GT, and the shared driving physics
// the player and the police both use.

import { ROAD, PITCH, WORLD_W, WORLD_H } from './config.js';
import { makeRng, pick, randRange, clamp, turnToward, angleTo, dist, resolveCircleRect } from './utils.js';
import { city, streetCenterX, streetCenterY, isWater } from './city.js';

export const CAR_TYPES = {
  sedan:  { len: 46, wid: 23, accel: 130, maxSpeed: 215, grip: 3.4, colors: ['#b8bcc4', '#7a4a3d', '#3d5a7a', '#4a7a4f', '#8a8f3d', '#5d4a7a'] },
  taxi:   { len: 46, wid: 23, accel: 130, maxSpeed: 215, grip: 3.4, colors: ['#e8b62a'] },
  sport:  { len: 47, wid: 23, accel: 205, maxSpeed: 330, grip: 4.1, colors: ['#b03a3a', '#2a6ab0', '#e07b28', '#dedede'] },
  muscle: { len: 48, wid: 24, accel: 180, maxSpeed: 295, grip: 3.6, colors: ['#2e2e38', '#6e2a2a', '#2a4a6e'] },
  van:    { len: 54, wid: 27, accel: 100, maxSpeed: 175, grip: 2.9, colors: ['#c9c9c9', '#7a8a99', '#998a7a'] },
  truck:  { len: 60, wid: 29, accel: 85, maxSpeed: 155, grip: 2.7, colors: ['#8a4a2a', '#4a6e4a', '#5d5d6e'] },
};

let nextCarId = 1;

export function makeCar(type, x, y, angle, color) {
  const spec = CAR_TYPES[type];
  return {
    id: nextCarId++, type, spec,
    x, y, angle, speed: 0,
    len: spec.len, wid: spec.wid,
    color: color || '#888888',
    hp: 100, driver: 'traffic', isPolice: false, isAzure: false,
    dirX: Math.round(Math.cos(angle)), dirY: Math.round(Math.sin(angle)),
    target: null, brake: 0, honkAt: 0, dead: false, smokeAt: 0,
  };
}

export const traffic = { cars: [], parked: [] };

export function spawnParkedCars() {
  const rng = makeRng(777);
  traffic.parked.length = 0;
  const types = ['sedan', 'sedan', 'taxi', 'van', 'sport', 'muscle', 'truck'];
  for (let n = 0; n < 90; n++) {
    // Park along a random street edge, facing along the street.
    const vertical = rng() < 0.5;
    const i = Math.floor(rng() * 24), j = Math.floor(rng() * 17);
    let x, y, angle;
    if (vertical) {
      x = streetCenterX(i) + (rng() < 0.5 ? -ROAD / 2 + 4 : ROAD / 2 - 4);
      y = streetCenterY(j) + randRange(rng, 30, PITCH - 30);
      angle = rng() < 0.5 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      x = streetCenterX(i) + randRange(rng, 30, PITCH - 30);
      y = streetCenterY(j) + (rng() < 0.5 ? -ROAD / 2 + 4 : ROAD / 2 - 4);
      angle = rng() < 0.5 ? Math.PI : 0;
    }
    if (isWater(x, y)) continue;
    const car = makeCar(pick(rng, types), x, y, angle, null);
    car.color = pick(rng, car.spec.colors);
    car.driver = 'parked';
    car.speed = 0;
    traffic.parked.push(car);
  }
  // The one-off Azure GT waits on the Azure Motors forecourt.
  const spot = city.landmarks.showroom;
  if (spot) {
    const gt = makeCar('sport', spot.door.x + 26, spot.door.y + 30, Math.PI / 2, '#29b7e8');
    gt.isAzure = true;
    gt.driver = 'parked';
    gt.hp = 100;
    traffic.parked.push(gt);
  }
}

// The waypoint a traffic car steers for: the next intersection in its
// current direction, offset onto the right-hand lane.
function nextTarget(car) {
  const lane = ROAD / 4;
  const cx = car.x + car.dirX * PITCH, cy = car.y + car.dirY * PITCH;
  const ix = Math.round((cx - ROAD / 2) / PITCH), iy = Math.round((cy - ROAD / 2) / PITCH);
  const gx = streetCenterX(clamp(ix, 0, 26)), gy = streetCenterY(clamp(iy, 0, 19));
  // Right-hand traffic: offset perpendicular to travel, to the right.
  const ox = car.dirY * lane, oy = -car.dirX * lane;
  // World edges turn the car around instead of leaving Palmera.
  if ((car.dirX > 0 && gx >= WORLD_W - PITCH) || (car.dirX < 0 && gx <= PITCH) ||
      (car.dirY > 0 && gy >= WORLD_H - PITCH) || (car.dirY < 0 && gy <= PITCH)) {
    car.dirX = -car.dirX; car.dirY = -car.dirY;
    return nextTarget(car);
  }
  car.target = { x: gx + ox, y: gy + oy };
  return car.target;
}

function chooseTurn(car, rng) {
  const r = rng();
  if (r < 0.55) return; // straight on
  const left = { x: car.dirY, y: -car.dirX };
  const right = { x: -car.dirY, y: car.dirX };
  const pickDir = r < 0.78 ? left : right;
  // Do not turn into the bay or off the map edge.
  const nx = car.x + pickDir.x * PITCH * 1.5, ny = car.y + pickDir.y * PITCH * 1.5;
  if (nx < PITCH || ny < PITCH || nx > WORLD_W - PITCH || ny > WORLD_H - PITCH || isWater(nx, ny)) return;
  car.dirX = pickDir.x; car.dirY = pickDir.y;
}

const trafficRng = makeRng(4242);

export function updateTraffic(dt, focus, events) {
  // Keep a living ring of traffic around the focus point.
  const want = 14;
  const near = traffic.cars.filter(c => !c.dead && dist(c.x, c.y, focus.x, focus.y) < 1250);
  traffic.cars = near;
  let guard = 0;
  while (traffic.cars.length < want && guard++ < 30) {
    const a = trafficRng() * Math.PI * 2, r = randRange(trafficRng, 620, 980);
    const x = clamp(focus.x + Math.cos(a) * r, 60, WORLD_W - 60);
    const y = clamp(focus.y + Math.sin(a) * r, 60, WORLD_H - 60);
    if (isWater(x, y)) continue;
    // Snap onto the nearest street, in a lane, facing along it.
    const vertical = trafficRng() < 0.5;
    const dir = trafficRng() < 0.5 ? 1 : -1;
    const car = makeCar(pick(trafficRng, ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sport', 'muscle', 'truck']), x, y, 0, null);
    car.color = pick(trafficRng, car.spec.colors);
    if (vertical) {
      const i = clamp(Math.round((x - ROAD / 2) / PITCH), 0, 26);
      car.x = streetCenterX(i) + dir * (ROAD / 4);
      car.dirX = 0; car.dirY = dir;
    } else {
      const j = clamp(Math.round((y - ROAD / 2) / PITCH), 0, 19);
      car.y = streetCenterY(j) - dir * (ROAD / 4);
      car.dirX = dir; car.dirY = 0;
    }
    car.angle = Math.atan2(car.dirY, car.dirX);
    nextTarget(car);
    traffic.cars.push(car);
  }

  for (const car of traffic.cars) {
    if (car.dead) continue;
    if (!car.target) nextTarget(car);
    const d = dist(car.x, car.y, car.target.x, car.target.y);
    if (d < 42) { chooseTurn(car, trafficRng); nextTarget(car); }
    // Slow for anything solid ahead: another car, the player's car, a wreck.
    let desired = car.spec.maxSpeed * 0.52;
    for (const other of allCars()) {
      if (other === car || other.driver === 'parked') continue;
      const ahead = (other.x - car.x) * Math.cos(car.angle) + (other.y - car.y) * Math.sin(car.angle);
      const side = Math.abs((other.x - car.x) * -Math.sin(car.angle) + (other.y - car.y) * Math.cos(car.angle));
      if (ahead > 0 && ahead < 74 && side < 20) { desired = Math.min(desired, other.speed * 0.9); if (ahead < 40) desired = 0; }
    }
    stepCar(car, { throttle: car.speed < desired ? 0.75 : 0, brake: car.speed > desired + 8, steer: 0 }, dt, true);
    // Steer along the lane toward the waypoint (traffic follows its target).
    const want = angleTo(car.x, car.y, car.target.x, car.target.y);
    car.angle = turnToward(car.angle, want, (1.6 - Math.min(1.1, Math.abs(car.speed) / 320)) * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    collideCarWithWorld(car, events, false);
  }
}

export function allCars() {
  return traffic.cars.concat(traffic.parked);
}

// Shared car physics: throttle/brake/steer in, speed and heading out.
// Position is integrated by the caller where traffic needs its own path,
// or here for the player and police via integrate = true.
export function stepCar(car, input, dt, aiDriven) {
  const spec = car.spec;
  if (input.throttle > 0) car.speed += spec.accel * input.throttle * dt;
  if (input.brake) {
    if (car.speed > 12) car.speed -= 320 * dt;
    else car.speed = Math.max(-spec.maxSpeed * 0.32, car.speed - spec.accel * 0.7 * dt);
  }
  if (!input.throttle && !input.brake) {
    car.speed -= car.speed * 0.55 * dt;
    if (Math.abs(car.speed) < 2) car.speed = 0;
  }
  car.speed = clamp(car.speed, -spec.maxSpeed * 0.35, spec.maxSpeed * (input.boost ? 1.18 : 1));
  if (!aiDriven) {
    const steerPower = clamp(Math.abs(car.speed) / 130, 0, 1) * 2.35;
    car.angle += input.steer * steerPower * dt * (car.speed < 0 ? -1 : 1);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }
  car.x = clamp(car.x, 24, WORLD_W - 24);
  car.y = clamp(car.y, 24, WORLD_H - 24);
}

// Two circles stand in for the car's body in every collision test.
export function carCircles(car) {
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  const off = car.len * 0.26, r = car.wid * 0.62;
  return [
    { x: car.x + c * off, y: car.y + s * off, r },
    { x: car.x - c * off, y: car.y - s * off, r },
  ];
}

export function collideCarWithWorld(car, events, isPlayerCar) {
  for (const circle of carCircles(car)) {
    for (const solid of city.solids) {
      if (Math.abs(solid.x + solid.w / 2 - circle.x) > 130 || Math.abs(solid.y + solid.h / 2 - circle.y) > 130) continue;
      const [nx, ny] = resolveCircleRect(circle.x, circle.y, circle.r, solid);
      if (nx !== circle.x || ny !== circle.y) {
        const dx = nx - circle.x, dy = ny - circle.y;
        car.x += dx; car.y += dy;
        circle.x += dx; circle.y += dy;
        if (Math.abs(car.speed) > 55) {
          car.hp -= Math.abs(car.speed) * 0.055;
          if (events) events.push({ kind: 'crash', hard: Math.abs(car.speed) > 130, car, player: isPlayerCar });
        }
        car.speed *= 0.42;
      }
    }
  }
  // Car-to-car: push apart and trade a little speed and paint. Traffic
  // slides past parked cars at the kerb without shoving them.
  for (const other of allCars()) {
    if (other === car) continue;
    if (car.driver === 'traffic' && other.driver === 'parked') continue;
    for (const a of carCircles(car)) {
      for (const b of carCircles(other)) {
        const d = dist(a.x, a.y, b.x, b.y);
        const min = a.r + b.r;
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const ux = (a.x - b.x) / d, uy = (a.y - b.y) / d;
          car.x += ux * push; car.y += uy * push;
          if (other.driver !== 'parked') { other.x -= ux * push; other.y -= uy * push; }
          const impact = Math.abs(car.speed - other.speed);
          if (impact > 60) {
            car.hp -= impact * 0.05; other.hp -= impact * 0.04;
            if (events) events.push({ kind: 'crash', hard: impact > 130, car, other, player: isPlayerCar });
          }
          car.speed *= 0.72;
        }
      }
    }
  }
  if (car.hp <= 0 && !car.dead) { car.dead = true; car.speed = 0; }
}

export function drawCar(ctx, car, cam, night, timeMs) {
  const x = car.x - cam.x, y = car.y - cam.y;
  if (x < -90 || y < -90 || x > ctx.canvas.width + 90 || y > ctx.canvas.height + 90) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(car.angle);
  const L = car.len, W = car.wid;
  // Shadow, body, cabin, glass.
  ctx.fillStyle = 'rgba(8,8,16,0.35)';
  ctx.fillRect(-L / 2 + 3, -W / 2 + 4, L, W);
  ctx.fillStyle = car.dead ? '#3a3a40' : car.color;
  roundRect(ctx, -L / 2, -W / 2, L, W, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  roundRect(ctx, -L / 2 + 3, -W / 2 + 2, L - 6, 4, 3); ctx.fill();
  ctx.fillStyle = '#1d2733';
  roundRect(ctx, -L * 0.08, -W / 2 + 3, L * 0.3, W - 6, 3); ctx.fill();
  ctx.fillStyle = '#26313f';
  roundRect(ctx, L * 0.26, -W / 2 + 4, L * 0.12, W - 8, 2); ctx.fill();
  // Wheels.
  ctx.fillStyle = '#101014';
  for (const [wx, wy] of [[-L / 2 + 8, -W / 2 - 2], [L / 2 - 10, -W / 2 - 2], [-L / 2 + 8, W / 2 - 3], [L / 2 - 10, W / 2 - 3]]) {
    ctx.fillRect(wx, wy, 9, 5);
  }
  if (car.type === 'taxi') {
    ctx.fillStyle = '#14141c';
    ctx.fillRect(-6, -5, 12, 10);
    ctx.fillStyle = '#ffd23d';
    ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 2.5);
  }
  if (car.isPolice) {
    ctx.fillStyle = '#f2f2f2';
    roundRect(ctx, -L * 0.12, -W / 2 + 3, L * 0.34, W - 6, 3); ctx.fill();
    const flash = Math.floor(timeMs / 280) % 2 === 0;
    ctx.fillStyle = flash ? '#ff4444' : '#4444ff';
    ctx.fillRect(-5, -W / 2 + 2, 10, 4);
    ctx.fillStyle = flash ? '#4444ff' : '#ff4444';
    ctx.fillRect(-5, W / 2 - 6, 10, 4);
  }
  if (car.isAzure) {
    ctx.strokeStyle = 'rgba(140,240,255,0.9)';
    ctx.lineWidth = 1.6;
    roundRect(ctx, -L / 2 + 1, -W / 2 + 1, L - 2, W - 2, 6); ctx.stroke();
  }
  // Headlights after dark.
  if (night > 0.45 && !car.dead) {
    ctx.fillStyle = 'rgba(255,240,190,0.16)';
    ctx.beginPath();
    ctx.moveTo(L / 2, -6); ctx.lineTo(L / 2 + 54, -16); ctx.lineTo(L / 2 + 54, 16); ctx.lineTo(L / 2, 6); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // Damage smoke drifts from a hurt engine.
  if (car.hp < 45 && !car.dead) {
    const puff = Math.sin(timeMs / 160 + car.id * 3) * 4;
    ctx.fillStyle = 'rgba(70,70,80,0.4)';
    ctx.beginPath(); ctx.arc(x + puff, y - 14 - (timeMs / 90 + car.id * 20) % 18, 5 + ((timeMs / 90) % 6), 0, Math.PI * 2); ctx.fill();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
