// player.js — Rafe Costa: walking, sprinting, stealing and driving cars,
// fists and a pistol, and the bullets the pistol fires.

import { PLAYER_SPEED, PLAYER_RUN_SPEED, PLAYER_RADIUS, PLAYER_MAX_HEALTH, WORLD_W, WORLD_H, HEAT } from './config.js';
import { clamp, dist, angleTo, resolveCircleRect } from './utils.js';
import { city } from './city.js';
import { traffic, allCars, stepCar, collideCarWithWorld } from './vehicles.js';

export const player = {
  x: 0, y: 0, angle: 0, aimAngle: 0,
  health: PLAYER_MAX_HEALTH, money: 240,
  mode: 'foot',           // 'foot' or 'car'
  car: null,              // the car being driven, when mode is 'car'
  weapon: 'pistol',       // 'fists' or 'pistol' (Tab swaps)
  attackCd: 0, reloadCd: 0, anim: 0, moving: false,
  dead: false, bustTimer: 0,
};

export const bullets = [];

export function placePlayer(x, y) {
  player.x = x; player.y = y;
  player.mode = 'foot';
  player.car = null;
  player.dead = false;
  player.health = PLAYER_MAX_HEALTH;
}

export function nearestCar(x, y, maxDist) {
  let best = null, bestD = maxDist;
  for (const car of allCars()) {
    if (car.dead) continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// Witnesses decide whether a crime heats up: any pedestrian close by, or
// any police unit with line of sight range, counts as having seen it.
export function witnessed(x, y, cops) {
  return { seen: true, x, y };
}

export function updatePlayerOnFoot(dt, input, events, timeMs) {
  player.attackCd = Math.max(0, player.attackCd - dt);
  player.reloadCd = Math.max(0, player.reloadCd - dt);
  let mx = 0, my = 0;
  if (input.up) my -= 1;
  if (input.down) my += 1;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  const len = Math.hypot(mx, my);
  player.moving = len > 0;
  if (len > 0) {
    mx /= len; my /= len;
    const speed = input.sprint ? PLAYER_RUN_SPEED : PLAYER_SPEED;
    let nx = player.x + mx * speed * dt;
    let ny = player.y + my * speed * dt;
    for (const solid of city.solids) {
      if (Math.abs(solid.x + solid.w / 2 - nx) > 120 || Math.abs(solid.y + solid.h / 2 - ny) > 120) continue;
      [nx, ny] = resolveCircleRect(nx, ny, PLAYER_RADIUS, solid);
    }
    player.x = clamp(nx, 16, WORLD_W - 30);
    player.y = clamp(ny, 16, WORLD_H - 16);
    player.angle = Math.atan2(my, mx);
    player.anim += dt * (input.sprint ? 13 : 9);
  }
  player.aimAngle = angleTo(player.x, player.y, input.mouse.x, input.mouse.y);

  if (input.attack && player.attackCd <= 0) {
    if (player.weapon === 'pistol') {
      if (player.reloadCd <= 0) {
        player.attackCd = 0.23;
        bullets.push({
          x: player.x + Math.cos(player.aimAngle) * 14, y: player.y + Math.sin(player.aimAngle) * 14,
          vx: Math.cos(player.aimAngle) * 940, vy: Math.sin(player.aimAngle) * 940,
          life: 0.55, from: 'player',
        });
        events.push({ kind: 'shot', x: player.x, y: player.y, byPlayer: true });
      }
    } else {
      player.attackCd = 0.32;
      events.push({ kind: 'punch', x: player.x, y: player.y, angle: player.aimAngle, byPlayer: true });
    }
  }
}

export function updatePlayerDriving(dt, input, events) {
  const car = player.car;
  if (!car) return;
  stepCar(car, {
    throttle: input.up ? 1 : 0,
    brake: !!input.down,
    steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
    boost: !!input.sprint,
  }, dt, false);
  collideCarWithWorld(car, events, true);
  player.x = car.x; player.y = car.y;
  player.angle = car.angle;
  if (Math.abs(car.speed) > 40) player.anim += dt * 4;
}

export function enterCar(car, events) {
  // Pulling a driver out is a theft the street can see. A car taken from
  // the traffic flow leaves that flow: it is parked-list business now.
  const wasTraffic = car.driver === 'traffic';
  const wasParked = car.driver === 'parked';
  const ti = traffic.cars.indexOf(car);
  if (ti >= 0) { traffic.cars.splice(ti, 1); traffic.parked.push(car); }
  car.driver = 'player';
  player.mode = 'car';
  player.car = car;
  player.x = car.x; player.y = car.y;
  events.push({ kind: 'door' });
  if (wasTraffic || wasParked) {
    events.push({ kind: 'crime', crime: 'stealCar', x: car.x, y: car.y, amount: HEAT.stealCar });
  }
  if (car.isAzure) events.push({ kind: 'azureStolen', x: car.x, y: car.y });
}

export function exitCar(events) {
  const car = player.car;
  if (!car) return;
  car.driver = 'parked';
  car.speed = 0;
  // Step out on the left side of the car.
  player.x = car.x + Math.cos(car.angle - Math.PI / 2) * (car.wid + 14);
  player.y = car.y + Math.sin(car.angle - Math.PI / 2) * (car.wid + 14);
  player.mode = 'foot';
  player.car = null;
  events.push({ kind: 'door' });
}

export function updateBullets(dt, targets, events) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let kill = b.life <= 0;
    // Bullets stop at buildings.
    for (const solid of city.solids) {
      if (b.x > solid.x && b.x < solid.x + solid.w && b.y > solid.y && b.y < solid.y + solid.h) { kill = true; break; }
    }
    if (!kill) {
      for (const t of targets) {
        if (t.hp <= 0 || t.state === 'down' || t.state === 'gone') continue;
        if (dist(b.x, b.y, t.x, t.y) < (t.r || 10)) {
          t.hp -= b.from === 'player' ? 42 : 16;
          events.push({ kind: 'hit', target: t, byPlayer: b.from === 'player', x: t.x, y: t.y });
          kill = true;
          break;
        }
      }
    }
    if (!kill) {
      for (const car of allCars()) {
        if (dist(b.x, b.y, car.x, car.y) < car.len * 0.55) {
          car.hp -= 6;
          events.push({ kind: 'carHit', car, byPlayer: b.from === 'player' });
          kill = true;
          break;
        }
      }
    }
    if (kill) bullets.splice(i, 1);
  }
}

export function drawBullets(ctx, cam) {
  ctx.strokeStyle = 'rgba(255,230,150,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const b of bullets) {
    ctx.moveTo(b.x - cam.x, b.y - cam.y);
    ctx.lineTo(b.x - cam.x - b.vx * 0.016, b.y - cam.y - b.vy * 0.016);
  }
  ctx.stroke();
}

export function drawPlayer(ctx, cam, timeMs) {
  if (player.mode === 'car') return;
  const x = player.x - cam.x, y = player.y - cam.y;
  ctx.fillStyle = 'rgba(8,8,16,0.32)';
  ctx.beginPath(); ctx.ellipse(x, y + 9, 9, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  const bob = player.moving ? Math.sin(player.anim) * 1.7 : 0;
  // Legs in dark jeans, then the teal shirt Rafe wears all story long.
  ctx.strokeStyle = '#232a38';
  ctx.lineWidth = 4;
  const legSwing = player.moving ? Math.sin(player.anim) * 5 : 0;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + Math.cos(player.angle + Math.PI / 2) * legSwing * 0.4, y + 10);
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x - Math.cos(player.angle + Math.PI / 2) * legSwing * 0.4, y + 10);
  ctx.stroke();
  ctx.fillStyle = '#1f8a8a';
  ctx.beginPath(); ctx.arc(x, y - 1 + bob * 0.3, 7.2, 0, Math.PI * 2); ctx.fill();
  // Aiming arm toward the mouse.
  ctx.strokeStyle = '#1f8a8a';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(x, y - 1);
  ctx.lineTo(x + Math.cos(player.aimAngle) * 12, y - 1 + Math.sin(player.aimAngle) * 12);
  ctx.stroke();
  if (player.weapon === 'pistol') {
    ctx.strokeStyle = '#15151c';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(player.aimAngle) * 11, y - 1 + Math.sin(player.aimAngle) * 11);
    ctx.lineTo(x + Math.cos(player.aimAngle) * 17, y - 1 + Math.sin(player.aimAngle) * 17);
    ctx.stroke();
  }
  ctx.fillStyle = '#c98d5e';
  ctx.beginPath(); ctx.arc(x + Math.cos(player.angle) * 2.2, y - 9 + bob * 0.3, 4.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1d12';
  ctx.beginPath(); ctx.arc(x + Math.cos(player.angle) * 1.2, y - 10.4 + bob * 0.3, 4.3, Math.PI, Math.PI * 2); ctx.fill();
}
