// pedestrians.js — the people of Palmera: they stroll the sidewalks, chat
// on corners, run from trouble and dive out of the way of bad driving.

import { WORLD_W, WORLD_H, PITCH, ROAD } from './config.js';
import { makeRng, pick, randRange, clamp, dist, angleTo, turnToward, resolveCircleRect } from './utils.js';
import { city, isWater } from './city.js';

const SHIRTS = ['#d96b4f', '#4f83d9', '#e3c04f', '#6fce7a', '#c95fb0', '#e8e3da', '#5fd0c9', '#8a6fe8'];
const PANTS = ['#2c3242', '#4a3b2c', '#31435c', '#5c3143', '#22331f'];

export const peds = { list: [] };
const rng = makeRng(1357);
let nextPedId = 1;

export function makePed(x, y) {
  return {
    id: nextPedId++, x, y, angle: rng() * Math.PI * 2,
    speed: 0, walkSpeed: randRange(rng, 34, 62),
    shirt: pick(rng, SHIRTS), pants: pick(rng, PANTS),
    hp: 100, state: 'walk', timer: randRange(rng, 2, 7),
    target: null, anim: rng() * 6, downAt: 0, isCop: false, isThug: false, name: '',
  };
}

function sidewalkPointNear(focus) {
  for (let tries = 0; tries < 12; tries++) {
    const a = rng() * Math.PI * 2, r = randRange(rng, 380, 760);
    const x = clamp(focus.x + Math.cos(a) * r, 30, WORLD_W - 30);
    const y = clamp(focus.y + Math.sin(a) * r, 30, WORLD_H - 30);
    if (isWater(x, y)) continue;
    // Sidewalks hug the blocks: snap to just inside a block edge.
    const mx = ((x % PITCH) + PITCH) % PITCH, my = ((y % PITCH) + PITCH) % PITCH;
    if (mx >= ROAD && mx <= PITCH - 6 && my >= ROAD && my <= PITCH - 6) return { x, y };
    if (mx < ROAD || my < ROAD) return { x, y }; // on a street corner is fine too
  }
  return null;
}

export function updatePeds(dt, focus, danger, events, timeMs) {
  const want = 24;
  peds.list = peds.list.filter(p => p.state !== 'gone' && dist(p.x, p.y, focus.x, focus.y) < 1150);
  let guard = 0;
  while (peds.list.length < want && guard++ < 20) {
    const spot = sidewalkPointNear(focus);
    if (spot) peds.list.push(makePed(spot.x, spot.y));
  }

  for (const ped of peds.list) {
    if (ped.isCop || ped.isThug) continue; // police and story fighters run elsewhere
    ped.anim += dt * (ped.speed > 4 ? 9 : 2);
    if (ped.state === 'down') {
      if (timeMs - ped.downAt > 9000) { ped.state = 'walk'; ped.hp = 60; }
      continue;
    }
    // Danger makes people run: a fast car close, a crash, a gunshot.
    let fleeFrom = null;
    if (danger) {
      for (const d of danger) {
        if (dist(ped.x, ped.y, d.x, d.y) < d.r) { fleeFrom = d; break; }
      }
    }
    if (fleeFrom) ped.state = 'flee';
    if (ped.state === 'flee') {
      const away = angleTo(fleeFrom ? fleeFrom.x : ped.x, fleeFrom ? fleeFrom.y : ped.y, ped.x, ped.y);
      ped.angle = turnToward(ped.angle, away, 7 * dt);
      ped.speed = 175;
      if (!fleeFrom) { ped.state = 'walk'; ped.timer = 1; }
    } else {
      ped.timer -= dt;
      if (ped.timer <= 0 || !ped.target) {
        ped.timer = randRange(rng, 3, 8);
        const a = rng() * Math.PI * 2, r = randRange(rng, 60, 260);
        ped.target = { x: clamp(ped.x + Math.cos(a) * r, 26, WORLD_W - 26), y: clamp(ped.y + Math.sin(a) * r, 26, WORLD_H - 26) };
      }
      const d = dist(ped.x, ped.y, ped.target.x, ped.target.y);
      if (d < 8) { ped.speed = 0; ped.timer = Math.min(ped.timer, 0.4); }
      else {
        ped.angle = turnToward(ped.angle, angleTo(ped.x, ped.y, ped.target.x, ped.target.y), 5 * dt);
        ped.speed = ped.walkSpeed;
      }
    }
    let nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    let ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
    for (const solid of city.solids) {
      if (Math.abs(solid.x + solid.w / 2 - nx) > 110 || Math.abs(solid.y + solid.h / 2 - ny) > 110) continue;
      [nx, ny] = resolveCircleRect(nx, ny, 9, solid);
    }
    ped.x = clamp(nx, 16, WORLD_W - 16);
    ped.y = clamp(ny, 16, WORLD_H - 16);
  }
}

export function knockDown(ped, timeMs) {
  if (ped.state !== 'down') {
    ped.state = 'down';
    ped.downAt = timeMs;
    ped.hp -= 45;
    if (ped.hp <= 0) ped.state = 'gone';
  }
}

export function drawPed(ctx, ped, cam, timeMs) {
  const x = ped.x - cam.x, y = ped.y - cam.y;
  if (x < -30 || y < -30 || x > ctx.canvas.width + 30 || y > ctx.canvas.height + 30) return;
  ctx.fillStyle = 'rgba(8,8,16,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 8, 8, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  if (ped.state === 'down') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ped.angle + Math.PI / 2);
    ctx.fillStyle = ped.pants;
    ctx.fillRect(-3, -4, 6, 13);
    ctx.fillStyle = ped.shirt;
    ctx.fillRect(-4.5, -12, 9, 9);
    ctx.fillStyle = '#e0b08a';
    ctx.beginPath(); ctx.arc(0, -15, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const bob = Math.sin(ped.anim) * 1.6;
  const legSwing = Math.sin(ped.anim) * 4;
  ctx.strokeStyle = ped.pants;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + Math.cos(ped.angle + Math.PI / 2) * legSwing * 0.4 + Math.cos(ped.angle) * 2, y + 9);
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x - Math.cos(ped.angle + Math.PI / 2) * legSwing * 0.4 + Math.cos(ped.angle) * 2, y + 9);
  ctx.stroke();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath(); ctx.arc(x, y - 1 + bob * 0.3, 6.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e0b08a';
  ctx.beginPath(); ctx.arc(x + Math.cos(ped.angle) * 2.4, y - 8 + bob * 0.3, 3.9, 0, Math.PI * 2); ctx.fill();
  if (ped.isThug) {
    ctx.fillStyle = '#c22e2e';
    ctx.fillRect(x - 5, y - 13 + bob * 0.3, 10, 3.4);
  }
}
