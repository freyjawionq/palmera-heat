// main.js — Palmera Heat's conductor: the loop, the states (title, playing,
// paused, busted, wasted), input, the camera, the day cycle, and the wiring
// that turns raw events from every other system into heat, sound and story.

import { VIEW_W, VIEW_H, WORLD_W, WORLD_H, DAY_LENGTH_SEC, START_MINUTES, HEAT, HEAT_PER_STAR } from './config.js';
import { clamp, dist, lerp } from './utils.js';
import { generateCity, drawGround, drawBuildings, drawProps, city } from './city.js';
import { SoundBank } from './audio.js';
import { traffic, spawnParkedCars, updateTraffic, drawCar, makeCar } from './vehicles.js';
import { peds, updatePeds, drawPed, knockDown } from './pedestrians.js';
import { player, placePlayer, nearestCar, updatePlayerOnFoot, updatePlayerDriving, enterCar, exitCar, bullets, updateBullets, drawBullets, drawPlayer } from './player.js';
import { police, addHeat, clearHeat, witnessedBy, updatePolice, bustPressure } from './police.js';
import { runner, tryStartMission, updateMissions, thugTargets, saveState, loadState, objectiveTarget } from './missions.js';
import { hud, showBanner, showTalk, drawHUD } from './hud.js';
import { saveGame, loadGame, wipeSave } from './save.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const sound = new SoundBank();
let state = 'title';            // title | playing | paused | busted | wasted
let stateTimer = 0;
let minutes = START_MINUTES;    // the city clock, in minutes since midnight
let cam = { x: 0, y: 0 };
let lastSave = 0;
let hasSave = false;

const input = {
  up: false, down: false, left: false, right: false, sprint: false,
  attack: false, mouse: { x: VIEW_W / 2, y: VIEW_H / 2 }, interactPressed: false,
};

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};

addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyF') input.interactPressed = true;
  if (e.code === 'Tab') { e.preventDefault(); if (state === 'playing') player.weapon = player.weapon === 'pistol' ? 'fists' : 'pistol'; }
  if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  if (e.code === 'Escape' && state === 'playing') state = 'paused';
  else if (e.code === 'Escape' && state === 'paused') state = 'playing';
  if (e.code === 'Enter' && state === 'title') startGame(false);
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  input.mouse.x = (e.clientX - r.left) * (VIEW_W / r.width);
  input.mouse.y = (e.clientY - r.top) * (VIEW_H / r.height);
});
canvas.addEventListener('mousedown', (e) => {
  sound.ensure();
  if (state === 'title') { handleTitleClick(e); return; }
  if (state === 'playing') input.attack = true;
});
addEventListener('mouseup', () => { input.attack = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- Boot -------------------------------------------------------------------

generateCity();
spawnParkedCars();
const saved = loadGame();
hasSave = !!saved;
if (saved) {
  loadState(saved.missions);
  player.money = saved.money ?? player.money;
  minutes = saved.minutes ?? START_MINUTES;
  const wh = city.landmarks.warehouse.door;
  placePlayer(saved.x ?? wh.x, saved.y ?? wh.y);
} else {
  runner.index = 0;
  const wh = city.landmarks.warehouse.door;
  placePlayer(wh.x - 30, wh.y + 16);
}
snapCamera();

function startGame(fresh) {
  sound.ensure();
  if (fresh) {
    wipeSave();
    runner.index = 0; runner.done = false; runner.active = false; runner.step = 0;
    player.money = 240;
    minutes = START_MINUTES;
    const wh = city.landmarks.warehouse.door;
    placePlayer(wh.x - 30, wh.y + 16);
    clearHeat();
  }
  state = 'playing';
  showBanner('PALMERA HEAT', 'Marisol Vega is waiting at her warehouse — follow the gold marker', performance.now(), 4.5);
}

function handleTitleClick(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (VIEW_W / r.width);
  const y = (e.clientY - r.top) * (VIEW_H / r.height);
  if (x > VIEW_W / 2 - 130 && x < VIEW_W / 2 + 130) {
    if (hasSave && y > 470 && y < 516) startGame(false);
    else if (y > (hasSave ? 528 : 470) && y < (hasSave ? 574 : 516)) startGame(true);
  }
}

function snapCamera() {
  cam.x = clamp(player.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  cam.y = clamp(player.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
}

// ---- The mission API ---------------------------------------------------------

const api = {
  player,
  rng: Math.random,
  stars: () => police.stars,
  setStars: (n) => { police.heat = Math.max(police.heat, n * HEAT_PER_STAR + 2); },
  giveMoney: (n) => { player.money += n; },
  banner: (t, s) => showBanner(t, s, performance.now()),
  sound: (name) => sound.sfx(name),
  spawnCar: (type, x, y, angle, color) => {
    const car = makeCar(type, x, y, angle, color);
    car.driver = 'parked';
    traffic.parked.push(car);
    return car;
  },
  findAzure: () => traffic.parked.find(c => c.isAzure) || null,
  addPed: (p) => { peds.list.push(p); },
  pedNear: (x, y) => peds.list.find(p => !p.isCop && !p.isThug && p.state !== 'gone' && dist(p.x, p.y, x, y) < 220) || null,
  hurtPlayer: (amount) => {
    if (player.mode !== 'foot') return;
    player.health -= amount;
    sound.sfx('hurt');
  },
};

// ---- Events: crimes, sounds, consequences -------------------------------------

function processEvents(events, now) {
  const danger = [];
  if (player.mode === 'car' && player.car && Math.abs(player.car.speed) > 130) {
    danger.push({ x: player.x, y: player.y, r: 110 });
  }
  for (const ev of events) {
    switch (ev.kind) {
      case 'shot':
        sound.sfx('shot');
        danger.push({ x: ev.x, y: ev.y, r: 280 });
        if (ev.byPlayer) addHeat(HEAT.shot, witnessedBy(ev.x, ev.y, peds.list));
        break;
      case 'punch': {
        sound.sfx('punch');
        if (!ev.byPlayer) break;
        const targets = [...peds.list, ...police.officers];
        for (const t of targets) {
          if (t.hp <= 0 || t.state === 'down' || t.state === 'gone') continue;
          if (dist(player.x, player.y, t.x, t.y) < 36) {
            const ang = Math.atan2(t.y - player.y, t.x - player.x);
            let da = Math.abs(ang - player.aimAngle) % (Math.PI * 2);
            if (da > Math.PI) da = Math.PI * 2 - da;
            if (da < 1.25) {
              t.hp -= 34;
              t.x += Math.cos(ang) * 7; t.y += Math.sin(ang) * 7;
              if (t.isCop) addHeat(HEAT.punch + 14, true);
              else if (t.isThug) { if (t.hp <= 0) { t.state = 'down'; t.downAt = now; } }
              else { knockDown(t, now); addHeat(HEAT.punch, witnessedBy(t.x, t.y, peds.list)); }
              if (t.hp <= 0 && !t.isThug) {
                if (t.isCop) addHeat(HEAT.copDown, true);
                else t.state = 'gone';
              }
            }
          }
        }
        break;
      }
      case 'hit':
        if (ev.byPlayer) {
          const t = ev.target;
          if (t.isCop) { if (t.hp <= 0) addHeat(HEAT.copDown, true); else addHeat(10, true); }
          else if (t.isThug) { if (t.hp <= 0) { t.state = 'down'; t.downAt = now; } }
          else if (t.isPlayer) { /* cannot happen */ }
          else { knockDown(t, now); addHeat(HEAT.hitPed, witnessedBy(t.x, t.y, peds.list)); if (t.hp <= 0) t.state = 'gone'; }
        } else if (ev.target.isPlayer) {
          sound.sfx('hurt');
        }
        break;
      case 'carHit':
        if (ev.byPlayer) addHeat(HEAT.hitCar * 0.5, witnessedBy(player.x, player.y, peds.list));
        break;
      case 'crash':
        sound.sfx('hitCar');
        danger.push({ x: player.x, y: player.y, r: 170 });
        if (ev.player && ev.hard) addHeat(HEAT.hitCar, witnessedBy(player.x, player.y, peds.list));
        break;
      case 'crime':
        addHeat(ev.amount, witnessedBy(ev.x, ev.y, peds.list));
        break;
      case 'door':
        sound.sfx('door');
        break;
    }
  }
  return danger;
}

// Cars versus people: a fast car meeting a pedestrian never ends well.
function carVersusPeople(events, now) {
  const runners = [...traffic.cars];
  if (player.mode === 'car' && player.car) runners.push(player.car);
  for (const copCar of police.cars) runners.push(copCar);
  for (const car of runners) {
    if (Math.abs(car.speed) < 55 || car.dead) continue;
    for (const ped of [...peds.list, ...police.officers]) {
      if (ped.hp <= 0 || ped.state === 'down' || ped.state === 'gone') continue;
      if (dist(car.x, car.y, ped.x, ped.y) < car.len * 0.52 + 8) {
        if (ped.isCop) {
          ped.hp -= 55;
          addHeat(HEAT.copDown, true);
          sound.sfx('hitCar');
        } else if (ped.isThug) {
          ped.hp -= 60;
        } else {
          knockDown(ped, now);
          if (car === player.car) addHeat(HEAT.hitPed, witnessedBy(ped.x, ped.y, peds.list));
          sound.sfx('hitCar');
        }
      }
    }
    // And versus the player, when a patrol car gets ideas.
    if (car !== player.car && player.mode === 'foot' && dist(car.x, car.y, player.x, player.y) < car.len * 0.52 + 8) {
      player.health -= 16;
      player.x += Math.cos(car.angle) * 16;
      player.y += Math.sin(car.angle) * 16;
      sound.sfx('hurt');
    }
  }
}

// ---- Consequences ---------------------------------------------------------------

function busted(now) {
  state = 'busted';
  stateTimer = 2.6;
  const fine = Math.min(player.money, 90 + police.stars * 55);
  player.money -= fine;
  showBanner('BUSTED', 'Palmera PD fines you $' + fine, now, 2.4);
  sound.sfx('fail');
  sound.engine(false, 0);
}

function wasted(now) {
  state = 'wasted';
  stateTimer = 2.6;
  const fine = Math.min(player.money, 120);
  player.money -= fine;
  showBanner('WASTED', 'St. Solana patches you up for $' + fine, now, 2.4);
  sound.sfx('fail');
  sound.engine(false, 0);
}

function respawn() {
  if (player.mode === 'car') exitCar([]);
  if (state === 'busted') {
    const hq = city.landmarks.police.door;
    placePlayer(hq.x, hq.y + 20);
  } else {
    const hosp = city.landmarks.hospital.door;
    placePlayer(hosp.x, hosp.y + 20);
  }
  clearHeat();
  player.bustTimer = 0;
  snapCamera();
  state = 'playing';
}

// ---- Day and light -----------------------------------------------------------------

function nightFactor() {
  const h = minutes / 60;
  if (h < 5.2 || h > 19.6) return 1;
  if (h < 6.8) return 1 - (h - 5.2) / 1.6;
  if (h > 18.2) return (h - 18.2) / 1.4;
  return 0;
}

function duskFactor() {
  const h = minutes / 60;
  if (h > 17.4 && h < 19.8) return 1 - Math.abs(h - 18.6) / 1.2;
  if (h > 5.4 && h < 7.2) return 1 - Math.abs(h - 6.3) / 0.9;
  return 0;
}

function clockText() {
  const hh = Math.floor(minutes / 60), mm = Math.floor(minutes % 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ---- The loop -------------------------------------------------------------------------

let last = performance.now();

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (nowMs - last) / 1000 || 0.016);
  last = nowMs;
  const now = nowMs;

  if (state === 'playing') {
    minutes = (minutes + dt * (1440 / DAY_LENGTH_SEC)) % 1440;
    const events = [];

    // Drain talk lines queued by missions.
    while (runner.bannerQueue.length) {
      const item = runner.bannerQueue.shift();
      if (item.kind === 'talk') showTalk(item.text, now);
    }

    const mouseWorld = { x: input.mouse.x + cam.x, y: input.mouse.y + cam.y };
    if (player.mode === 'foot') updatePlayerOnFoot(dt, { ...input, mouse: mouseWorld }, events, now);
    else updatePlayerDriving(dt, input, events);

    // Interact: start a job, steal a car, or climb out of one.
    hud.prompt = '';
    if (player.mode === 'car') {
      hud.prompt = 'F — get out';
      if (input.interactPressed) exitCar(events);
    } else {
      const wh = city.landmarks.warehouse.door;
      const mission = runner.index < 6 && !runner.done && !runner.active ? runner : null;
      const carNear = nearestCar(player.x, player.y, 52);
      if (mission && dist(player.x, player.y, wh.x, wh.y) < 58) {
        hud.prompt = 'F — talk to Marisol Vega';
        if (input.interactPressed) tryStartMission(api);
      } else if (carNear) {
        hud.prompt = carNear.driver === 'parked' ? 'F — steal car' : 'F — pull the driver out';
        if (input.interactPressed) enterCar(carNear, events);
      }
    }
    input.interactPressed = false;

    updateTraffic(dt, player, events);
    updatePolice(dt, player, events, now, bullets);

    // Bullets fly at everyone: civilians, thugs, officers — and at Rafe.
    const playerProxy = { x: player.x, y: player.y, r: 11, hp: player.mode === 'foot' ? player.health : -1, isPlayer: true, state: 'walk' };
    const targets = [...peds.list, ...police.officers, ...thugTargets()];
    if (player.mode === 'foot') targets.push(playerProxy);
    updateBullets(dt, targets, events);
    if (player.mode === 'foot' && playerProxy.hp !== player.health && playerProxy.hp >= 0) player.health = playerProxy.hp;

    const danger = processEvents(events, now);
    carVersusPeople(events, now);
    updatePeds(dt, player, danger, events, now);
    updateMissions(dt, api);

    // Busted and wasted bookkeeping.
    const pressure = bustPressure(player);
    if (pressure > 0) player.bustTimer += pressure * dt;
    else player.bustTimer = Math.max(0, player.bustTimer - dt * 1.4);
    if (player.bustTimer >= 1.6) busted(now);
    if (player.health <= 0 && state === 'playing') wasted(now);

    // Sound of the street.
    if (player.mode === 'car' && player.car) sound.engine(true, Math.abs(player.car.speed) / player.car.spec.maxSpeed);
    else sound.engine(false, 0);
    sound.siren(police.stars > 0 && police.cars.some(c => !c.dead && dist(c.x, c.y, player.x, player.y) < 620) ? police.stars : 0);
    sound.music(dt, true);

    // Camera eases after the player.
    cam.x = clamp(lerp(cam.x, player.x - VIEW_W / 2, 1 - Math.pow(0.0015, dt)), 0, WORLD_W - VIEW_W);
    cam.y = clamp(lerp(cam.y, player.y - VIEW_H / 2, 1 - Math.pow(0.0015, dt)), 0, WORLD_H - VIEW_H);

    // Autosave every few seconds.
    if (now - lastSave > 5000) {
      lastSave = now;
      saveGame({ money: player.money, minutes, x: Math.round(player.x), y: Math.round(player.y), missions: saveState() });
    }
  } else if (state === 'busted' || state === 'wasted') {
    stateTimer -= dt;
    if (stateTimer <= 0) respawn();
  }

  draw(now);
}

function draw(now) {
  const night = nightFactor();
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawGround(ctx, cam, night, now);
  drawProps(ctx, cam, night, now);
  for (const car of traffic.parked) drawCar(ctx, car, cam, night, now);
  for (const car of traffic.cars) drawCar(ctx, car, cam, night, now);
  for (const car of police.cars) drawCar(ctx, car, cam, night, now);
  for (const ped of peds.list) drawPed(ctx, ped, cam, now);
  for (const cop of police.officers) if (cop.hp > 0) drawPed(ctx, cop, cam, now);
  drawPlayer(ctx, cam, now);
  drawBuildings(ctx, cam, night);
  drawBullets(ctx, cam);

  // Objective marker: a breathing gold diamond over the target.
  if (state === 'playing') {
    const target = objectiveTarget();
    if (target) {
      const x = target.x - cam.x, y = target.y - cam.y + Math.sin(now / 300) * 5;
      if (x > -20 && y > -20 && x < VIEW_W + 20 && y < VIEW_H + 20) {
        ctx.save();
        ctx.translate(x, y - 26);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffd23d';
        ctx.fillRect(-7, -7, 14, 14);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,210,61,0.25)';
        ctx.beginPath(); ctx.ellipse(x, y + 8, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Light: dusk warms the frame, night cools and darkens it.
  const dusk = duskFactor();
  if (dusk > 0.03) { ctx.fillStyle = 'rgba(255,130,50,' + (dusk * 0.13) + ')'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (night > 0.03) { ctx.fillStyle = 'rgba(8,12,40,' + (night * 0.34) + ')'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }

  if (state === 'playing' || state === 'paused') {
    drawHUD(ctx, { player, police, clockText: clockText() }, now);
  }
  if (state === 'title') drawTitle(now);
  if (state === 'paused') {
    ctx.fillStyle = 'rgba(6,8,16,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2 - 10);
    ctx.fillStyle = '#fff';
    ctx.font = '17px "Trebuchet MS", sans-serif';
    ctx.fillText('Esc to resume · M to mute · progress saves itself', VIEW_W / 2, VIEW_H / 2 + 28);
  }
  if (state === 'busted' || state === 'wasted') {
    ctx.fillStyle = state === 'busted' ? 'rgba(20,30,80,0.45)' : 'rgba(80,10,10,0.45)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(state === 'busted' ? 'BUSTED' : 'WASTED', VIEW_W / 2, VIEW_H / 2);
  }
}

function drawTitle(now) {
  // A dusk gradient over the live city, palms and all.
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, 'rgba(30,10,50,0.55)');
  grad.addColorStop(0.55, 'rgba(90,20,60,0.35)');
  grad.addColorStop(1, 'rgba(10,8,24,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 96px Georgia, serif';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText('PALMERA', VIEW_W / 2 + 3, 203);
  ctx.fillText('HEAT', VIEW_W / 2 + 3, 293);
  const titleGrad = ctx.createLinearGradient(0, 120, 0, 300);
  titleGrad.addColorStop(0, '#ffe9b0');
  titleGrad.addColorStop(0.6, '#ffb35c');
  titleGrad.addColorStop(1, '#ff5e8a');
  ctx.fillStyle = titleGrad;
  ctx.fillText('PALMERA', VIEW_W / 2, 200);
  ctx.fillText('HEAT', VIEW_W / 2, 290);
  ctx.font = '19px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#e8e8f2';
  ctx.fillText('An open-world crime story in the city of Palmera — every street, every car, yours to take.', VIEW_W / 2, 340);
  ctx.font = '15px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('WASD drive & walk · Mouse aim · Click attack · F interact · Shift sprint/boost · Tab fists/pistol · Esc pause', VIEW_W / 2, 372);
  ctx.fillText('Work for Marisol Vega. Outrun Palmera PD. Steal the Azure GT.', VIEW_W / 2, 398);

  const drawButton = (y, label, hot) => {
    ctx.fillStyle = hot ? 'rgba(255,179,92,0.92)' : 'rgba(16,18,32,0.85)';
    ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - 130, y, 260, 46, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,233,176,0.6)';
    ctx.stroke();
    ctx.fillStyle = hot ? '#241408' : '#ffe9b0';
    ctx.font = 'bold 19px "Trebuchet MS", sans-serif';
    ctx.fillText(label, VIEW_W / 2, y + 30);
  };
  if (hasSave) {
    drawButton(470, 'CONTINUE', Math.floor(now / 600) % 2 === 0);
    drawButton(528, 'NEW GAME', false);
  } else {
    drawButton(470, 'START — NEW GAME', Math.floor(now / 600) % 2 === 0);
  }
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Progress saves automatically in this browser. Sound on M.', VIEW_W / 2, 640);
}

// Screenshot staging: the kit's own shots drive the live game to staged
// states through the query string, exactly like a player would see them.
(function stageFromQuery() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shot')) return;
  state = 'playing';
  const wh = city.landmarks.warehouse.door;
  const setTime = (h) => { minutes = h * 60; };
  const shot = q.get('shot');
  if (shot === 'neon-drive') {
    setTime(19.1);
    const showroom = city.landmarks.showroom.door;
    placePlayer(showroom.x, showroom.y);
    const car = api.spawnCar('sport', showroom.x + 10, showroom.y + 66, 0, '#e07b28');
    enterCar(car, []);
    player.car.speed = 150;
    player.money = 890;
    runner.index = 4; runner.active = true; runner.step = 1;
  } else if (shot === 'police-chase') {
    setTime(16.4);
    placePlayer(wh.x - 400, wh.y - 300);
    const car = api.spawnCar('muscle', player.x, player.y, 0.4, '#6e2a2a');
    enterCar(car, []);
    player.car.speed = 190;
    api.setStars(3);
    runner.index = 5; runner.active = true; runner.step = 0;
    runner.stepTimer = 64;
    player.money = 2140;
    // Two patrol cars already on the tail.
    for (let i = 0; i < 2; i++) {
      const cop = makeCar('sedan', player.x - 130 - i * 90, player.y - 40 + i * 70, 0.3, '#20242e');
      cop.isPolice = true; cop.driver = 'police'; cop.hp = 130;
      police.cars.push(cop);
    }
  } else if (shot === 'boardwalk-fight') {
    setTime(11.5);
    const bw = city.landmarks.boardwalk.door;
    placePlayer(bw.x - 20, bw.y + 30);
    player.weapon = 'fists';
    runner.index = 2;
    player.money = 690;
    const names = ['Tito Marlowe', 'Bruno', 'Cass'];
    for (let i = 0; i < 3; i++) {
      const thug = { id: 500 + i, x: bw.x + 26 + i * 30, y: bw.y + 44, angle: Math.PI, speed: 0, walkSpeed: 50, shirt: i === 0 ? '#e8e3da' : '#3d3d46', pants: '#2c3242', hp: i === 0 ? 130 : 90, state: 'walk', timer: 0, target: null, anim: i * 2, downAt: 0, isCop: false, isThug: true, name: names[i], r: 11 };
      peds.list.push(thug);
      runner.thugs.push(thug);
    }
    runner.active = true; runner.step = 1;
    showBanner('Paper Trail', 'Take the ledger from Tito Marlowe', performance.now(), 999);
  } else if (shot === 'azure-steal') {
    setTime(18.7);
    const gt = traffic.parked.find(c => c.isAzure);
    if (gt) {
      placePlayer(gt.x - 40, gt.y + 10);
      runner.index = 4; runner.active = true; runner.step = 1;
      player.money = 1250;
      showBanner('The Azure GT', 'Steal the one-off GT from Azure Motors', performance.now(), 999);
    }
  }
  snapCamera();
})();

// A handle for the screenshot tooling (and curious players in devtools).
window.__palmera = { player, police, runner, city, traffic, peds, startGame };

requestAnimationFrame(frame);
