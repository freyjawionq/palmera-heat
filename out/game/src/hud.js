// hud.js — everything drawn over the world: health and money, the wanted
// stars, the objective line, banners and phone-talk subtitles, the bust
// meter, the speedometer, and the minimap with its blips.

import { PLAYER_MAX_HEALTH } from './config.js';
import { clamp } from './utils.js';
import { city, worldToMinimap } from './city.js';
import { objectiveText, objectiveTarget } from './missions.js';

export const hud = {
  banners: [],   // {title, sub, until}
  talks: [],     // {text, until}
  prompt: '',
};

export function showBanner(title, sub, now, seconds = 3.4) {
  hud.banners.push({ title, sub, until: now + seconds * 1000 });
  if (hud.banners.length > 2) hud.banners.shift();
}

export function showTalk(text, now) {
  hud.talks.push({ text, until: now + 4600 });
  if (hud.talks.length > 2) hud.talks.shift();
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,12,22,0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fill();
}

export function drawHUD(ctx, game, now) {
  const { player, police, clockText } = game;
  hud.banners = hud.banners.filter(b => b.until > now);
  hud.talks = hud.talks.filter(t => t.until > now);

  // Top-left: cash and health.
  panel(ctx, 16, 14, 208, 58);
  ctx.fillStyle = '#7be495';
  ctx.font = 'bold 21px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('$' + player.money.toLocaleString('en-US'), 28, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(28, 50, 180, 9);
  ctx.fillStyle = player.health > 30 ? '#e34f6d' : '#ff2e2e';
  ctx.fillRect(28, 50, 180 * clamp(player.health / PLAYER_MAX_HEALTH, 0, 1), 9);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.fillText(clockText + ' · Palmera', 132, 40);

  // Top-right: wanted stars and the weapon in hand.
  const stars = police.stars;
  if (stars > 0 || police.heat > 1) {
    panel(ctx, ctx.canvas.width - 196, 14, 180, 58);
    ctx.font = '25px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < stars ? '#ffd23d' : 'rgba(255,255,255,0.22)';
      ctx.fillText('★', ctx.canvas.width - 168 + i * 32, 45);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(ctx.canvas.width - 178, 54, 144, 4);
    ctx.fillStyle = '#ffd23d';
    ctx.fillRect(ctx.canvas.width - 178, 54, 144 * clamp((police.heat % 34) / 34, 0, 1), 4);
  }
  ctx.fillStyle = 'rgba(10,12,22,0.62)';
  ctx.beginPath(); ctx.roundRect(ctx.canvas.width - 196, 80, 180, 26, 8); ctx.fill();
  ctx.fillStyle = '#e8e8f2';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.mode === 'car' ? 'DRIVING — F to get out' : (player.weapon === 'pistol' ? 'PISTOL — click to fire' : 'FISTS — click to punch'), ctx.canvas.width - 106, 97);

  // Objective line, top centre.
  const obj = objectiveText();
  if (obj) {
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
    const w = Math.min(560, ctx.measureText(obj).width + 34);
    panel(ctx, ctx.canvas.width / 2 - w / 2, 14, w, 32);
    ctx.fillStyle = '#ffd98a';
    ctx.textAlign = 'center';
    ctx.fillText(obj, ctx.canvas.width / 2, 36);
  }

  // Banners in the middle distance.
  let by = 120;
  for (const b of hud.banners) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(b.title, ctx.canvas.width / 2 + 2, by + 2);
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText(b.title, ctx.canvas.width / 2, by);
    ctx.font = '16px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.sub || '', ctx.canvas.width / 2, by + 26);
    by += 74;
  }

  // Phone-talk subtitles along the bottom.
  let ty = ctx.canvas.height - 118;
  for (const t of hud.talks) {
    ctx.font = '15px "Trebuchet MS", sans-serif';
    const w = Math.min(720, ctx.measureText(t.text).width + 30);
    panel(ctx, ctx.canvas.width / 2 - w / 2, ty - 20, w, 28);
    ctx.fillStyle = '#ffe9b0';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, ctx.canvas.width / 2, ty);
    ty -= 34;
  }

  // Interact prompt.
  if (hud.prompt) {
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    const w = ctx.measureText(hud.prompt).width + 30;
    panel(ctx, ctx.canvas.width / 2 - w / 2, ctx.canvas.height - 84, w, 30);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(hud.prompt, ctx.canvas.width / 2, ctx.canvas.height - 63);
  }

  // Bust meter while the net closes in.
  if (player.bustTimer > 0.05) {
    const w = 240;
    panel(ctx, ctx.canvas.width / 2 - w / 2, 64, w, 22);
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(ctx.canvas.width / 2 - w / 2 + 5, 69, (w - 10) * clamp(player.bustTimer / 1.6, 0, 1), 12);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED?', ctx.canvas.width / 2, 58);
  }

  drawMinimap(ctx, game, now);
  if (player.mode === 'car' && player.car) drawSpeedo(ctx, player.car);
}

function drawMinimap(ctx, game, now) {
  if (!city.minimap) return;
  const { player, police } = game;
  const MW = 196, MH = Math.round(196 * (city.minimap.height / city.minimap.width));
  const x0 = ctx.canvas.width - MW - 16, y0 = ctx.canvas.height - MH - 16;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y0, MW, MH, 10);
  ctx.clip();
  ctx.fillStyle = 'rgba(10,12,22,0.8)';
  ctx.fillRect(x0, y0, MW, MH);
  const sx = MW / city.minimap.width, sy = MH / city.minimap.height;
  ctx.drawImage(city.minimap, x0, y0, MW, MH);
  const blip = (wx, wy, color, size) => {
    const [mx, my] = worldToMinimap(wx, wy);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x0 + mx * sx, y0 + my * sy, size, 0, Math.PI * 2); ctx.fill();
  };
  for (const car of police.cars) if (!car.dead) blip(car.x, car.y, (Math.floor(now / 300) % 2 ? '#ff5252' : '#4d7bff'), 2.6);
  for (const cop of police.officers) if (cop.hp > 0) blip(cop.x, cop.y, '#4d7bff', 2.2);
  const target = objectiveTarget();
  if (target) {
    blip(target.x, target.y, '#ffd23d', 4);
    ctx.strokeStyle = 'rgba(255,210,61,0.6)';
    ctx.beginPath(); ctx.arc(x0 + worldToMinimap(target.x, target.y)[0] * sx, y0 + worldToMinimap(target.x, target.y)[1] * sy, 6 + Math.sin(now / 240) * 1.6, 0, Math.PI * 2); ctx.stroke();
  }
  // The player arrow.
  const [px, py] = worldToMinimap(player.x, player.y);
  ctx.translate(x0 + px * sx, y0 + py * sy);
  ctx.rotate(player.angle + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.roundRect(x0, y0, MW, MH, 10); ctx.stroke();
}

function drawSpeedo(ctx, car) {
  const speed = Math.round(Math.abs(car.speed) * 0.62);
  panel(ctx, 16, ctx.canvas.height - 84, 168, 68);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(speed + '', 30, ctx.canvas.height - 44);
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('km/h', 108, ctx.canvas.height - 44);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(30, ctx.canvas.height - 34, 140, 7);
  ctx.fillStyle = car.hp > 40 ? '#7be495' : '#ff5252';
  ctx.fillRect(30, ctx.canvas.height - 34, 140 * clamp(car.hp / 100, 0, 1), 7);
}
