// city.js — Palmera itself: a seeded grid city of six districts on a bay.
// Generates the blocks, buildings, landmarks, props and road layout once,
// and draws the visible slice each frame. Also prerenders the minimap.

import { BLOCK, ROAD, PITCH, CITY_COLS, CITY_ROWS, WORLD_W, WORLD_H, DISTRICTS } from './config.js';
import { makeRng, pick, randRange, clamp } from './utils.js';

export const city = {
  buildings: [],     // {x,y,w,h,height,roof,wall,district,landmark|null,seed}
  props: [],         // {x,y,kind} palms, lamps, crates, boats, benches
  solids: [],        // rects that block movement (buildings + solid props)
  landmarks: {},     // id -> {id,name,x,y,door:{x,y},district}
  blocks: [],        // per-block info for drawing ground variety
  minimap: null,     // offscreen canvas, drawn once
};

function districtAt(col, row) {
  if (col >= CITY_COLS - 2) return 'beach';
  if (row >= CITY_ROWS - 3 && col <= 6) return 'airport';
  if (row >= CITY_ROWS - 4 && col >= CITY_COLS - 7) return 'marina';
  if (col >= 9 && col <= 15 && row >= 3 && row <= 9) return 'downtown';
  if (row <= 2 || (col >= 16 && col <= 21 && row <= 6)) return 'neon';
  return 'oldtown';
}

export function streetCenterX(i) { return i * PITCH + ROAD / 2; }
export function streetCenterY(j) { return j * PITCH + ROAD / 2; }
export function blockOriginX(col) { return col * PITCH + ROAD; }
export function blockOriginY(row) { return row * PITCH + ROAD; }

export function isWater(x, y) {
  return x > WORLD_W - ROAD - 6;
}

export function isOnRoad(x, y) {
  const mx = ((x % PITCH) + PITCH) % PITCH;
  const my = ((y % PITCH) + PITCH) % PITCH;
  return mx < ROAD || my < ROAD;
}

export function isOnSand(x, y) {
  return x > blockOriginX(CITY_COLS - 2) - ROAD;
}

// The named places the story visits. Positions snap to real blocks below.
const LANDMARK_SPOTS = [
  { id: 'warehouse', name: "Marisol's Warehouse", col: 20, row: 15, district: 'marina' },
  { id: 'fishmarket', name: 'Palmera Fish Market', col: 22, row: 12, district: 'marina' },
  { id: 'boardwalk', name: 'Palmera Boardwalk', col: 23, row: 8, district: 'beach' },
  { id: 'safehouse', name: 'Old Town Safehouse', col: 3, row: 6, district: 'oldtown' },
  { id: 'showroom', name: 'Azure Motors', col: 18, row: 2, district: 'neon' },
  { id: 'garage', name: "Vega's Garage", col: 12, row: 11, district: 'downtown' },
  { id: 'police', name: 'Palmera Police HQ', col: 10, row: 5, district: 'downtown' },
  { id: 'hospital', name: 'St. Solana Hospital', col: 7, row: 8, district: 'oldtown' },
  { id: 'ferry', name: 'Skyport Ferry Pier', col: 5, row: 17, district: 'airport' },
  { id: 'hotel', name: 'The Coral Crown Hotel', col: 21, row: 5, district: 'neon' },
];

export function generateCity() {
  const rng = makeRng(20261117);
  city.buildings.length = 0;
  city.props.length = 0;
  city.solids.length = 0;
  city.blocks.length = 0;
  city.landmarks = {};

  const landmarkBlocks = new Map();
  for (const spot of LANDMARK_SPOTS) landmarkBlocks.set(spot.col + ',' + spot.row, spot);

  for (let row = 0; row < CITY_ROWS; row++) {
    for (let col = 0; col < CITY_COLS; col++) {
      const district = districtAt(col, row);
      const bx = blockOriginX(col), by = blockOriginY(row);
      city.blocks.push({ col, row, district, x: bx, y: by, seed: rng() });
      const spot = landmarkBlocks.get(col + ',' + row);

      if (district === 'beach') {
        // Open sand with palms, huts and the boardwalk; no towers here.
        const palms = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < palms; i++) {
          const px = bx + randRange(rng, 16, BLOCK - 16), py = by + randRange(rng, 16, BLOCK - 16);
          city.props.push({ x: px, y: py, kind: 'palm' });
          city.solids.push({ x: px - 5, y: py - 5, w: 10, h: 10 });
        }
        if (spot) addLandmark(spot, bx, by, rng, 26);
        else if (rng() < 0.4) {
          const hut = { x: bx + 34, y: by + 40, w: 62, h: 44, height: 12, roof: '#d9b380', wall: '#9a7c52', district, landmark: null, seed: rng() };
          city.buildings.push(hut); city.solids.push(hut);
        }
        continue;
      }

      if (district === 'airport' && row >= CITY_ROWS - 2 && col >= 1 && col <= 5) {
        // The runway strip: open asphalt, marked in drawGround.
        if (col === 3 && row === CITY_ROWS - 2 && !spot) { /* keep clear */ }
        if (spot) addLandmark(spot, bx, by, rng, 20);
        continue;
      }

      if (spot) { addLandmark(spot, bx, by, rng, district === 'downtown' ? 90 : 34); continue; }

      // Ordinary block: one to four buildings with a sidewalk margin.
      const tall = district === 'downtown' ? randRange(rng, 55, 150)
        : district === 'neon' ? randRange(rng, 35, 105)
        : district === 'marina' ? randRange(rng, 12, 30)
        : district === 'airport' ? randRange(rng, 14, 26)
        : randRange(rng, 16, 44);
      const split = rng() < 0.45 ? 2 : 1;
      for (let s = 0; s < split; s++) {
        const w = split === 2 ? (BLOCK - 30) / 2 : BLOCK - 26;
        const h = BLOCK - 26;
        const b = {
          x: bx + 13 + s * ((BLOCK - 30) / 2 + 4), y: by + 13, w, h,
          height: Math.max(12, tall * randRange(rng, 0.75, 1.15)),
          roof: pick(rng, DISTRICTS[district].roof), wall: DISTRICTS[district].wall,
          district, landmark: null, seed: rng(),
        };
        city.buildings.push(b);
        city.solids.push(b);
      }
      // Street lamps on the block corners, palms in the sunny districts.
      if (rng() < 0.7) city.props.push({ x: bx - 6, y: by - 6, kind: 'lamp' });
      if ((district === 'neon' || district === 'marina') && rng() < 0.55) {
        const px = bx + randRange(rng, 8, BLOCK - 8), py = by + BLOCK - 4;
        city.props.push({ x: px, y: py, kind: 'palm' });
        city.solids.push({ x: px - 5, y: py - 5, w: 10, h: 10 });
      }
      if (district === 'marina' && rng() < 0.6) {
        city.props.push({ x: bx + randRange(rng, 14, BLOCK - 30), y: by + randRange(rng, 14, BLOCK - 20), kind: 'boat' });
      }
    }
  }
  buildMinimap();
}

function addLandmark(spot, bx, by, rng, height) {
  const b = {
    x: bx + 10, y: by + 12, w: BLOCK - 20, h: BLOCK - 30,
    height, roof: pick(rng, DISTRICTS[spot.district].roof), wall: DISTRICTS[spot.district].wall,
    district: spot.district, landmark: spot.id, seed: rng(),
  };
  city.buildings.push(b);
  city.solids.push(b);
  city.landmarks[spot.id] = {
    id: spot.id, name: spot.name, district: spot.district,
    x: b.x + b.w / 2, y: b.y + b.h / 2,
    door: { x: b.x + b.w / 2, y: b.y + b.h + 16 },
  };
}

// ---- Drawing -------------------------------------------------------------
// The camera is a plain offset: world (x, y) lands at (x - cam.x, y - cam.y).

const GROUND_TINT = {
  downtown: '#565d75', neon: '#5d5470', oldtown: '#77644e',
  marina: '#5d7268', airport: '#5c5e63', beach: '#d9bd8a',
};

export function drawGround(ctx, cam, night, timeMs) {
  // Streets are the base layer everywhere.
  ctx.fillStyle = night > 0.5 ? '#232733' : '#3c414d';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const c0 = Math.max(0, Math.floor(cam.x / PITCH)), c1 = Math.min(CITY_COLS - 1, Math.floor((cam.x + ctx.canvas.width) / PITCH));
  const r0 = Math.max(0, Math.floor(cam.y / PITCH)), r1 = Math.min(CITY_ROWS - 1, Math.floor((cam.y + ctx.canvas.height) / PITCH));

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const block = city.blocks[row * CITY_COLS + col];
      const x = block.x - cam.x - 7, y = block.y - cam.y - 7, s = BLOCK + 14;
      if (block.district === 'airport' && row >= CITY_ROWS - 2 && col >= 1 && col <= 5) {
        ctx.fillStyle = night > 0.5 ? '#26282e' : '#43454b';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = 'rgba(240,240,230,0.75)';
        for (let d = 0; d < 4; d++) ctx.fillRect(x + 14 + d * 36, y + s / 2 - 2, 20, 4);
        continue;
      }
      ctx.fillStyle = GROUND_TINT[block.district];
      ctx.fillRect(x, y, s, s);
      // A worn inner lot tone so blocks do not read as flat slabs.
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x + 8, y + 8, s - 16, s - 16);
    }
  }

  // Lane dashes along every visible street centre.
  ctx.fillStyle = night > 0.5 ? 'rgba(220,190,90,0.5)' : 'rgba(240,210,110,0.65)';
  for (let i = 0; i <= CITY_COLS; i++) {
    const x = streetCenterX(i) - cam.x;
    if (x < -8 || x > ctx.canvas.width + 8) continue;
    for (let y = -((cam.y) % 44); y < ctx.canvas.height; y += 44) ctx.fillRect(x - 1, y, 2, 22);
  }
  for (let j = 0; j <= CITY_ROWS; j++) {
    const y = streetCenterY(j) - cam.y;
    if (y < -8 || y > ctx.canvas.height + 8) continue;
    for (let x = -((cam.x) % 44); x < ctx.canvas.width; x += 44) ctx.fillRect(x, y - 1, 22, 2);
  }

  // The bay: animated water along the east edge.
  const wx = WORLD_W - ROAD - 6 - cam.x;
  if (wx < ctx.canvas.width) {
    const grad = ctx.createLinearGradient(Math.max(0, wx), 0, ctx.canvas.width, 0);
    grad.addColorStop(0, night > 0.5 ? '#14304d' : '#2e7fb8');
    grad.addColorStop(1, night > 0.5 ? '#0d2438' : '#1f6aa3');
    ctx.fillStyle = grad;
    ctx.fillRect(Math.max(0, wx), 0, ctx.canvas.width - Math.max(0, wx), ctx.canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y < ctx.canvas.height; y += 26) {
      const off = Math.sin(timeMs / 700 + y * 0.05) * 5;
      ctx.moveTo(wx + 4 + off, y);
      ctx.lineTo(wx + 22 + off, y);
    }
    ctx.stroke();
  }
}

export function drawBuildings(ctx, cam, night) {
  const x0 = cam.x - 80, y0 = cam.y - 200, x1 = cam.x + ctx.canvas.width + 80, y1 = cam.y + ctx.canvas.height + 80;
  const visible = city.buildings.filter(b => b.x + b.w > x0 && b.x < x1 && b.y + b.h > y0 && b.y < y1);
  visible.sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const b of visible) {
    const lift = b.height * 0.42;
    const x = b.x - cam.x, y = b.y - cam.y;
    // Shadow, then the wall block, then the lifted roof.
    ctx.fillStyle = 'rgba(10,10,20,0.30)';
    ctx.fillRect(x + lift * 0.5, y + lift * 0.35, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(x, y - lift, b.w, b.h + lift);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y + b.h - 3, b.w, 3 + lift * 0.2);
    ctx.fillStyle = b.roof;
    ctx.fillRect(x, y - lift, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y - lift + 3, b.w - 6, b.h - 6);
    // Rooftop clutter from the building's own seed.
    const rr = makeRng(Math.floor(b.seed * 1e6) + 7);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    const boxes = 1 + Math.floor(rr() * 3);
    for (let i = 0; i < boxes; i++) {
      ctx.fillRect(x + 8 + rr() * (b.w - 34), y - lift + 8 + rr() * (b.h - 34), 12 + rr() * 16, 10 + rr() * 12);
    }
    if (night > 0.45 && b.height > 30) {
      // Lit windows speckle the roof edge and south wall after dark.
      ctx.fillStyle = 'rgba(255,214,120,0.85)';
      const wins = Math.floor(b.height / 14);
      for (let i = 0; i < wins; i++) {
        if (rr() < 0.6) ctx.fillRect(x + 6 + rr() * (b.w - 12), y + b.h - 2 - rr() * lift * 0.5, 3, 3);
      }
    }
    if (b.landmark) {
      ctx.font = 'bold 13px Georgia, serif';
      ctx.textAlign = 'center';
      const label = city.landmarks[b.landmark].name.toUpperCase();
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = 'rgba(12,14,26,0.82)';
      ctx.fillRect(x + b.w / 2 - w / 2, y - lift - 24, w, 19);
      ctx.fillStyle = '#ffd98a';
      ctx.fillText(label, x + b.w / 2, y - lift - 10);
    }
  }
}

export function drawProps(ctx, cam, night, timeMs) {
  for (const p of city.props) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (x < -40 || y < -40 || x > ctx.canvas.width + 40 || y > ctx.canvas.height + 40) continue;
    if (p.kind === 'palm') {
      ctx.strokeStyle = '#6e5136';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 12); ctx.stroke();
      ctx.strokeStyle = night > 0.5 ? '#2e6e46' : '#3f9e57';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.sin(timeMs / 900 + p.x) * 0.08;
        ctx.beginPath();
        ctx.moveTo(x + 3, y - 12);
        ctx.quadraticCurveTo(x + 3 + Math.cos(a) * 12, y - 16 + Math.sin(a) * 5, x + 3 + Math.cos(a) * 19, y - 8 + Math.sin(a) * 10);
        ctx.stroke();
      }
    } else if (p.kind === 'lamp') {
      ctx.fillStyle = '#22242e';
      ctx.fillRect(x - 2, y - 10, 4, 12);
      if (night > 0.4) {
        const g = ctx.createRadialGradient(x, y - 12, 2, x, y - 12, 30);
        g.addColorStop(0, 'rgba(255,205,110,0.5)');
        g.addColorStop(1, 'rgba(255,205,110,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 30, y - 42, 60, 60);
      }
      ctx.fillStyle = '#ffd873';
      ctx.fillRect(x - 2, y - 14, 4, 4);
    } else if (p.kind === 'boat') {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#e8e4da';
      ctx.beginPath();
      ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(10, 7); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3d6e8a';
      ctx.fillRect(-7, -7, 14, 7);
      ctx.restore();
    }
  }
}

// ---- Minimap ---------------------------------------------------------------

function buildMinimap() {
  const scale = 300 / WORLD_W;
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = Math.round(WORLD_H * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#2c3247';
  g.fillRect(0, 0, c.width, c.height);
  for (const block of city.blocks) {
    g.fillStyle = block.district === 'beach' ? '#d9bd8a' : GROUND_TINT[block.district];
    g.fillRect(block.x * scale, block.y * scale, BLOCK * scale, BLOCK * scale);
  }
  g.fillStyle = '#2e7fb8';
  g.fillRect((WORLD_W - ROAD) * scale, 0, ROAD * scale + 4, c.height);
  g.fillStyle = 'rgba(240,240,240,0.5)';
  for (const b of city.buildings) g.fillRect(b.x * scale, b.y * scale, Math.max(1.5, b.w * scale), Math.max(1.5, b.h * scale));
  city.minimap = c;
  city.minimapScale = scale;
}

export function worldToMinimap(x, y) {
  const s = city.minimapScale || 300 / WORLD_W;
  return [x * s, y * s];
}

export { clamp };
