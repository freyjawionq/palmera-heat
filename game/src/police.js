// police.js — Palmera PD: the wanted level, the heat that feeds it, and
// the patrol cars and officers who answer it.

import { HEAT_PER_STAR, HEAT_DECAY, HEAT_DECAY_SEEN, WORLD_W, WORLD_H } from './config.js';
import { clamp, dist, angleTo, turnToward, resolveCircleRect, makeRng } from './utils.js';
import { city } from './city.js';
import { makeCar, stepCar, collideCarWithWorld } from './vehicles.js';
import { streetCenterX, streetCenterY } from './city.js';

export const police = {
  heat: 0,
  stars: 0,
  cars: [],       // patrol cars (vehicle objects with isPolice)
  officers: [],   // officers on foot (ped-shaped objects with isCop)
  spawnCd: 0,
  seen: false,
};

const rng = makeRng(90210);

export function addHeat(amount, wasWitnessed) {
  if (!wasWitnessed || amount <= 0) return;
  police.heat = clamp(police.heat + amount, 0, HEAT_PER_STAR * 5);
}

export function clearHeat() {
  police.heat = 0;
  police.stars = 0;
}

export function witnessedBy(x, y, peds) {
  for (const cop of police.cars) if (dist(x, y, cop.x, cop.y) < 430) return true;
  for (const cop of police.officers) if (dist(x, y, cop.x, cop.y) < 300) return true;
  for (const ped of peds) {
    if (ped.state === 'down' || ped.state === 'gone' || ped.isCop || ped.isThug) continue;
    if (dist(x, y, ped.x, ped.y) < 165) return true;
  }
  return false;
}

function spawnCopCar(player) {
  // Roll in from a street a few blocks away, never on top of the player.
  for (let tries = 0; tries < 10; tries++) {
    const a = rng() * Math.PI * 2, r = 640 + rng() * 260;
    const x = clamp(player.x + Math.cos(a) * r, 50, WORLD_W - 50);
    const y = clamp(player.y + Math.sin(a) * r, 50, WORLD_H - 50);
    const i = clamp(Math.round((x - 27) / 204), 0, 26), j = clamp(Math.round((y - 27) / 204), 0, 19);
    const car = makeCar('sedan', streetCenterX(i), streetCenterY(j), 0, '#20242e');
    car.spec = { len: 46, wid: 23, accel: 165, maxSpeed: 268, grip: 3.8, colors: ['#20242e'] };
    car.isPolice = true;
    car.driver = 'police';
    car.hp = 130;
    police.cars.push(car);
    return;
  }
}

function spawnOfficer(player) {
  const a = rng() * Math.PI * 2, r = 300 + rng() * 140;
  police.officers.push({
    id: 9000 + police.officers.length + Math.floor(rng() * 500),
    x: clamp(player.x + Math.cos(a) * r, 30, WORLD_W - 30),
    y: clamp(player.y + Math.sin(a) * r, 30, WORLD_H - 30),
    angle: 0, speed: 0, walkSpeed: 96, shirt: '#1d2f57', pants: '#141c2e',
    hp: 100, state: 'chase', timer: 0, target: null, anim: rng() * 6, downAt: 0,
    isCop: true, isThug: false, name: 'Officer', shootCd: rand2(0.6, 1.6), r: 10,
  });
}

function rand2(lo, hi) { return lo + rng() * (hi - lo); }

export function updatePolice(dt, player, events, timeMs, bullets) {
  police.stars = Math.floor(police.heat / HEAT_PER_STAR);
  // Are the police watching right now?
  police.seen = false;
  for (const cop of police.cars) if (dist(cop.x, cop.y, player.x, player.y) < 470) police.seen = true;
  for (const cop of police.officers) if (dist(cop.x, cop.y, player.x, player.y) < 320) police.seen = true;
  police.heat = clamp(police.heat - (police.seen ? HEAT_DECAY_SEEN : HEAT_DECAY) * dt, 0, HEAT_PER_STAR * 5);
  if (police.heat <= 0.01 && police.stars > 0) police.heat = 0;

  // Reinforcements scale with the stars.
  const wantCars = police.stars === 0 ? 0 : Math.min(5, 1 + police.stars);
  const wantOfficers = police.stars >= 2 && player.mode === 'foot' ? Math.min(4, police.stars) : 0;
  police.spawnCd -= dt;
  if (police.spawnCd <= 0) {
    if (police.cars.filter(c => !c.dead).length < wantCars) { spawnCopCar(player); police.spawnCd = 2.2; }
    else if (police.officers.filter(o => o.hp > 0).length < wantOfficers) { spawnOfficer(player); police.spawnCd = 1.6; }
  }
  // Units give up and drive off once the heat is gone.
  if (police.stars === 0) {
    police.cars = police.cars.filter(c => dist(c.x, c.y, player.x, player.y) < 1300);
    police.officers = police.officers.filter(o => dist(o.x, o.y, player.x, player.y) < 500);
  }
  police.cars = police.cars.filter(c => dist(c.x, c.y, player.x, player.y) < 1500);
  police.officers = police.officers.filter(o => dist(o.x, o.y, player.x, player.y) < 900 && o.state !== 'gone');

  // Patrol cars hunt the player's position, leading a moving target.
  for (const car of police.cars) {
    if (car.dead) continue;
    const lead = player.mode === 'car' && player.car ? 0.35 : 0.1;
    const tx = player.x + (player.mode === 'car' ? Math.cos(player.car.angle) * player.car.speed * lead : 0);
    const ty = player.y + (player.mode === 'car' ? Math.sin(player.car.angle) * player.car.speed * lead : 0);
    const d = dist(car.x, car.y, tx, ty);
    const want = angleTo(car.x, car.y, tx, ty);
    car.angle = turnToward(car.angle, want, (2.1 - Math.min(1.2, Math.abs(car.speed) / 300)) * dt);
    const throttle = d > 60 ? 1 : 0.25;
    stepCar(car, { throttle, brake: d < 34 && Math.abs(car.speed) > 30, steer: 0 }, dt, true);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    collideCarWithWorld(car, events, false);
  }

  // Officers on foot close in, shoot to wound, and grab to bust.
  for (const cop of police.officers) {
    if (cop.hp <= 0) { cop.state = 'gone'; continue; }
    cop.anim += dt * 9;
    const d = dist(cop.x, cop.y, player.x, player.y);
    if (d > 235) {
      cop.angle = turnToward(cop.angle, angleTo(cop.x, cop.y, player.x, player.y), 6 * dt);
      cop.speed = 138;
    } else {
      cop.speed = d > 60 ? 92 : 0;
      cop.angle = angleTo(cop.x, cop.y, player.x, player.y);
      cop.shootCd -= dt;
      if (cop.shootCd <= 0 && player.mode === 'foot' && police.stars >= 2) {
        cop.shootCd = rand2(0.9, 1.7);
        bullets.push({
          x: cop.x + Math.cos(cop.angle) * 13, y: cop.y + Math.sin(cop.angle) * 13,
          vx: Math.cos(cop.angle + rand2(-0.07, 0.07)) * 860, vy: Math.sin(cop.angle + rand2(-0.07, 0.07)) * 860,
          life: 0.4, from: 'cop',
        });
        events.push({ kind: 'shot', x: cop.x, y: cop.y, byPlayer: false });
      }
    }
    let nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
    let ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
    for (const solid of city.solids) {
      if (Math.abs(solid.x + solid.w / 2 - nx) > 110 || Math.abs(solid.y + solid.h / 2 - ny) > 110) continue;
      [nx, ny] = resolveCircleRect(nx, ny, 10, solid);
    }
    cop.x = clamp(nx, 16, WORLD_W - 16);
    cop.y = clamp(ny, 16, WORLD_H - 16);
  }
}

// Bust pressure: standing still inside a closing net fills the meter.
export function bustPressure(player) {
  let pressure = 0;
  if (player.mode === 'foot') {
    for (const cop of police.officers) if (cop.hp > 0 && dist(cop.x, cop.y, player.x, player.y) < 22) pressure += 1.4;
    for (const car of police.cars) if (!car.dead && dist(car.x, car.y, player.x, player.y) < 52) pressure += 0.5;
  } else if (player.car && Math.abs(player.car.speed) < 14) {
    let near = 0;
    for (const car of police.cars) if (!car.dead && dist(car.x, car.y, player.x, player.y) < 95) near++;
    if (near >= 2) pressure = 0.9;
  }
  return pressure;
}
