// missions.js — the story of Rafe Costa and Marisol Vega, told in six jobs,
// plus the repeatable taxi fares that keep a wheelman fed afterwards.
// A mission is a list of steps; the runner walks the player through them,
// and the HUD reads the runner for its objective line and map marker.

import { dist, clamp } from './utils.js';
import { city } from './city.js';
import { makePed } from './pedestrians.js';

export const STORY = [
  {
    id: 'welcome', title: 'Welcome to Palmera', giver: 'Marisol Vega', reward: 150,
    intro: [
      'Marisol: Rafe Costa. Heard you can drive anything with wheels.',
      'Marisol: Start simple. Take the grey sedan outside, and let the fish market see your face.',
    ],
    steps: [
      { kind: 'enterStoryCar', text: 'Get into the grey sedan outside the warehouse' },
      { kind: 'drive', at: 'fishmarket', text: 'Drive to the Palmera Fish Market' },
    ],
    outro: 'Marisol: Not bad. The city might keep you.',
  },
  {
    id: 'coldboxes', title: 'Cold Boxes', giver: 'Marisol Vega', reward: 300,
    intro: [
      'Marisol: Three crates of "fish" that cannot sit in the sun.',
      'Marisol: Market first, then the Coral Crown, then the boardwalk cafe. Fast, but whole.',
    ],
    steps: [
      { kind: 'goto', at: 'fishmarket', text: 'Pick up the crates at the Fish Market' },
      { kind: 'timed', at: 'hotel', seconds: 95, text: 'Deliver to the Coral Crown Hotel' },
      { kind: 'timed', at: 'boardwalk', seconds: 80, text: 'Deliver to the Boardwalk cafe' },
    ],
    outro: 'Marisol: Cold boxes, warm money. Good.',
  },
  {
    id: 'papertrail', title: 'Paper Trail', giver: 'Marisol Vega', reward: 250,
    intro: [
      'Marisol: Tito Marlowe owes me a ledger and three months of excuses.',
      'Marisol: He sunbathes at the boardwalk with two friends. Collect. Hands are fine.',
    ],
    steps: [
      { kind: 'goto', at: 'boardwalk', text: 'Find Tito Marlowe at the Boardwalk' },
      { kind: 'fight', count: 3, at: 'boardwalk', text: 'Take the ledger from Tito and his friends' },
    ],
    outro: 'Marisol: The ledger, and Tito keeps his teeth. Mostly.',
  },
  {
    id: 'sirens', title: 'Sirens', giver: 'Marisol Vega', reward: 200,
    intro: [
      'Marisol: That noise? That is the bill for the boardwalk, cariño.',
      'Marisol: Lose them. Then lie low at the Old Town safehouse.',
    ],
    steps: [
      { kind: 'escape', text: 'Lose the police — get your wanted level to zero' },
      { kind: 'goto', at: 'safehouse', text: 'Reach the Old Town Safehouse' },
    ],
    outro: 'Marisol: Quiet streets again. You learn fast.',
  },
  {
    id: 'azure', title: 'The Azure GT', giver: 'Marisol Vega', reward: 600,
    intro: [
      'Marisol: Azure Motors keeps a one-off GT the colour of the bay.',
      'Marisol: Tonight it changes owners. Bring it to Vega\'s Garage. The alarm will sing.',
    ],
    steps: [
      { kind: 'goto', at: 'showroom', text: 'Go to Azure Motors on the Neon Mile' },
      { kind: 'stealAzure', text: 'Steal the Azure GT' },
      { kind: 'deliverAzure', at: 'garage', text: 'Deliver the Azure GT to Vega\'s Garage' },
    ],
    outro: 'Marisol: Look at her. The bay, parked in my garage.',
  },
  {
    id: 'lastferry', title: 'Last Ferry', giver: 'Marisol Vega', reward: 1000,
    intro: [
      'Marisol: One last run, Rafe. The Skyport ferry leaves with or without you.',
      'Marisol: Hit every flare I lit across town, then the pier. Half the city will watch.',
    ],
    steps: [
      { kind: 'timed', at: 'police', seconds: 70, text: 'Flare one: past Police HQ, Downtown' },
      { kind: 'timed', at: 'boardwalk', seconds: 85, text: 'Flare two: the Boardwalk' },
      { kind: 'timed', at: 'ferry', seconds: 95, text: 'Final flare: the Skyport Ferry Pier' },
    ],
    outro: 'Marisol: Palmera is yours now, Rafe. Drive it well.',
  },
];

export const runner = {
  index: -1,          // which story mission is offered/active; -1 = none yet
  step: 0,
  active: false,
  done: false,        // whole story finished
  stepTimer: 0,
  thugs: [],
  storyCar: null,
  bannerQueue: [],
  fare: null,         // active taxi fare {ped, dest, destName, phase}
  faresDone: 0,
};

export function currentMission() {
  return runner.index >= 0 && runner.index < STORY.length ? STORY[runner.index] : null;
}

export function currentStep() {
  const m = currentMission();
  return m && runner.active ? m.steps[runner.step] : null;
}

export function objectiveTarget() {
  const step = currentStep();
  if (!step) {
    if (runner.fare) return runner.fare.phase === 'pickup' ? { x: runner.fare.ped.x, y: runner.fare.ped.y } : runner.fare.dest;
    const m = currentMission();
    if (m && !runner.done) return city.landmarks.warehouse.door;
    return null;
  }
  if (step.kind === 'enterStoryCar' && runner.storyCar) return { x: runner.storyCar.x, y: runner.storyCar.y };
  if (step.kind === 'stealAzure') {
    const gt = runner.azureCar;
    return gt ? { x: gt.x, y: gt.y } : city.landmarks.showroom.door;
  }
  if (step.at) return city.landmarks[step.at].door;
  return null;
}

export function objectiveText() {
  const step = currentStep();
  if (step) {
    let text = step.text;
    if (step.kind === 'timed' || runner.stepTimer > 0) text += ' — ' + Math.max(0, Math.ceil(runner.stepTimer)) + 's';
    if (step.kind === 'fight') {
      const left = runner.thugs.filter(t => t.hp > 0).length;
      text += ' (' + left + ' standing)';
    }
    return text;
  }
  if (runner.fare) {
    return runner.fare.phase === 'pickup' ? 'Fare: pick up the passenger' : 'Fare: drive to ' + runner.fare.destName;
  }
  if (runner.done) return 'Free roam — fares pay, the city is yours';
  const m = currentMission();
  if (m) return 'Go to Marisol\'s Warehouse to start: ' + m.title;
  return '';
}

// Called when the player presses Interact at the warehouse door.
export function tryStartMission(api) {
  const m = currentMission();
  if (!m || runner.active || runner.done) return false;
  runner.active = true;
  runner.step = 0;
  beginStep(api);
  for (const line of m.intro) runner.bannerQueue.push({ kind: 'talk', text: line });
  api.banner(m.title, 'A job from ' + m.giver);
  api.sound('phone');
  return true;
}

function beginStep(api) {
  const step = currentStep();
  if (!step) return;
  runner.stepTimer = step.kind === 'timed' ? step.seconds : 0;
  if (step.kind === 'enterStoryCar') {
    const door = city.landmarks.warehouse.door;
    runner.storyCar = api.spawnCar('sedan', door.x - 60, door.y + 44, Math.PI / 2, '#9aa0ab');
  }
  if (step.kind === 'fight') {
    const spot = city.landmarks[step.at];
    runner.thugs = [];
    const names = ['Tito Marlowe', 'Bruno', 'Cass'];
    for (let i = 0; i < step.count; i++) {
      const thug = makePed(spot.door.x + (i - 1) * 34, spot.door.y + 26 + (i % 2) * 22);
      thug.isThug = true;
      thug.name = names[i];
      thug.shirt = i === 0 ? '#e8e3da' : '#3d3d46';
      thug.hp = i === 0 ? 130 : 90;
      thug.r = 11;
      runner.thugs.push(thug);
      api.addPed(thug);
    }
    api.banner('Tito Marlowe', 'You owe Marisol a ledger, Tito.');
  }
  if (step.kind === 'escape') {
    api.setStars(2);
    api.banner('Lose the heat', 'Break line of sight and let the stars fade');
  }
  if (step.kind === 'stealAzure') {
    runner.azureCar = api.findAzure();
  }
  if (currentMission() && currentMission().id === 'lastferry' && runner.step === 0) {
    api.setStars(3);
  }
}

function completeMission(api) {
  const m = currentMission();
  runner.active = false;
  runner.step = 0;
  api.giveMoney(m.reward);
  runner.bannerQueue.push({ kind: 'talk', text: m.outro });
  api.banner('Job complete', m.title + ' — ' + '$' + m.reward);
  api.sound('sting');
  runner.index++;
  if (runner.index >= STORY.length) {
    runner.done = true;
    api.banner('PALMERA HEAT', 'Story complete — free roam unlocked');
  }
}

function failStep(api, why) {
  runner.bannerQueue.push({ kind: 'talk', text: 'Marisol: ' + why });
  api.banner('Job failed', why);
  api.sound('fail');
  runner.active = false;
  runner.step = 0;
  runner.thugs = [];
}

export function updateMissions(dt, api) {
  const step = currentStep();
  // Taxi fares tick along beside the story.
  updateFare(dt, api);
  if (!step) return;
  const player = api.player;

  if (step.kind === 'timed') {
    runner.stepTimer -= dt;
    if (runner.stepTimer <= 0) { failStep(api, 'Too slow. The job is off — come back to the warehouse.'); return; }
  }

  const target = objectiveTarget();
  const near = target && dist(player.x, player.y, target.x, target.y) < (step.kind === 'goto' || step.kind === 'timed' ? 56 : 64);

  switch (step.kind) {
    case 'enterStoryCar':
      if (player.mode === 'car' && player.car === runner.storyCar) advance(api);
      break;
    case 'goto':
    case 'timed':
      if (near) advance(api);
      break;
    case 'drive':
      if (near && player.mode === 'car') advance(api);
      break;
    case 'fight': {
      updateThugs(dt, api);
      if (runner.thugs.length && runner.thugs.every(t => t.hp <= 0)) {
        runner.thugs = [];
        advance(api);
      }
      break;
    }
    case 'escape':
      if (api.stars() === 0) advance(api);
      break;
    case 'stealAzure':
      if (player.mode === 'car' && player.car && player.car.isAzure) {
        api.setStars(3);
        api.banner('The alarm sings', 'Get the GT to Vega\'s Garage');
        advance(api);
      }
      break;
    case 'deliverAzure':
      if (near && player.mode === 'car' && player.car && player.car.isAzure) {
        player.car.driver = 'parked';
        advance(api);
      }
      break;
  }
}

function advance(api) {
  const m = currentMission();
  runner.step++;
  if (runner.step >= m.steps.length) completeMission(api);
  else {
    api.sound('cash');
    beginStep(api);
  }
}

// Tito and his friends swing back. Fists only — this is a debt collection.
function updateThugs(dt, api) {
  const player = api.player;
  for (const thug of runner.thugs) {
    if (thug.hp <= 0) continue;
    thug.anim += dt * 8;
    const d = dist(thug.x, thug.y, player.x, player.y);
    if (player.mode === 'car') continue;
    if (d > 24) {
      const a = Math.atan2(player.y - thug.y, player.x - thug.x);
      thug.angle = a;
      thug.x += Math.cos(a) * 118 * dt;
      thug.y += Math.sin(a) * 118 * dt;
    } else {
      thug.timer -= dt;
      if (thug.timer <= 0) {
        thug.timer = 0.85;
        api.hurtPlayer(7, thug);
      }
    }
  }
}

export function thugTargets() {
  return runner.thugs.filter(t => t.hp > 0);
}

// ---- Taxi fares: the living after the story -------------------------------

const FARE_SPOTS = ['fishmarket', 'hotel', 'boardwalk', 'garage', 'hospital', 'showroom', 'safehouse', 'ferry'];

export function updateFare(dt, api) {
  const player = api.player;
  if (!runner.fare) {
    // Now and then a pedestrian near a landmark hails the player's car.
    if (player.mode === 'car' && api.rng() < dt * 0.05) {
      const spotId = FARE_SPOTS[Math.floor(api.rng() * FARE_SPOTS.length)];
      const spot = city.landmarks[spotId];
      if (dist(player.x, player.y, spot.door.x, spot.door.y) < 300) {
        const ped = api.pedNear(spot.door.x, spot.door.y);
        if (ped) {
          let destId = FARE_SPOTS[Math.floor(api.rng() * FARE_SPOTS.length)];
          if (destId === spotId) destId = spotId === 'hotel' ? 'fishmarket' : 'hotel';
          const dest = city.landmarks[destId];
          runner.fare = { ped, dest: dest.door, destName: dest.name, phase: 'pickup' };
          api.banner('Fare hailed', 'Pick up the passenger by ' + spot.name);
        }
      }
    }
    return;
  }
  const fare = runner.fare;
  if (fare.phase === 'pickup') {
    if (player.mode !== 'car') { runner.fare = null; return; }
    if (dist(player.x, player.y, fare.ped.x, fare.ped.y) < 40 && Math.abs(player.car.speed) < 12) {
      fare.phase = 'drive';
      fare.ped.state = 'gone';
      api.banner('Fare aboard', 'Drive to ' + fare.destName);
      api.sound('cash');
    }
  } else {
    if (player.mode !== 'car') { runner.fare = null; api.banner('Fare lost', 'The passenger bailed'); return; }
    if (dist(player.x, player.y, fare.dest.x, fare.dest.y) < 58 && Math.abs(player.car.speed) < 26) {
      const pay = 40 + Math.round(dist(fare.ped.x, fare.ped.y, fare.dest.x, fare.dest.y) / 22);
      api.giveMoney(pay);
      runner.faresDone++;
      api.banner('Fare paid', '+$' + pay);
      api.sound('cash');
      runner.fare = null;
    }
  }
}

export function saveState() {
  return { index: runner.index, done: runner.done, faresDone: runner.faresDone };
}

export function loadState(data) {
  if (!data) return;
  runner.index = clamp(data.index ?? -1, -1, STORY.length);
  runner.done = !!data.done || runner.index >= STORY.length;
  runner.faresDone = data.faresDone || 0;
  if (runner.index < 0) runner.index = 0;
}
