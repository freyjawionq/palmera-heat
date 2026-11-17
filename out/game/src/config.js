// config.js — the numbers and names that define Palmera Heat.
// One place for world size, balance, controls and the city's identity.

export const VIEW_W = 1280;
export const VIEW_H = 800;

// The city is a grid of blocks separated by two-lane streets.
export const BLOCK = 150;          // building block pitch edge (px)
export const ROAD = 54;            // street width (px)
export const PITCH = BLOCK + ROAD; // one block plus one street
export const CITY_COLS = 26;
export const CITY_ROWS = 19;
export const WORLD_W = CITY_COLS * PITCH + ROAD;
export const WORLD_H = CITY_ROWS * PITCH + ROAD;

// Game identity — every name in Palmera is original to this game.
export const GAME_TITLE = 'PALMERA HEAT';
export const CITY_NAME = 'Palmera';
export const HERO_NAME = 'Rafe Costa';
export const BOSS_NAME = 'Marisol Vega';

export const DISTRICTS = {
  downtown: { name: 'Downtown', roof: ['#3d4a6b', '#46538a', '#39466e', '#4d5a94'], wall: '#2b3350' },
  neon:     { name: 'Neon Mile', roof: ['#5a3d6e', '#6e3d5f', '#4a3d7a', '#63386b'], wall: '#372a4d' },
  oldtown:  { name: 'Old Town', roof: ['#8a5a3d', '#96684a', '#7d5136', '#a06a42'], wall: '#5f4128' },
  marina:   { name: 'Marina', roof: ['#3d6e6a', '#477a72', '#38665f', '#4d857c'], wall: '#2a4d47' },
  airport:  { name: 'Airport Flats', roof: ['#6b6b72', '#75757e', '#62626b', '#82828c'], wall: '#47474f' },
  beach:    { name: 'Palmera Beach', roof: ['#c2a878', '#cbb183', '#b89e6e', '#d2ba8c'], wall: '#8a744e' },
};

// Player and world balance.
export const PLAYER_SPEED = 148;        // px/s on foot
export const PLAYER_RUN_SPEED = 232;    // px/s sprinting
export const PLAYER_RADIUS = 11;
export const PLAYER_MAX_HEALTH = 100;
export const DAY_LENGTH_SEC = 480;      // one full day-night cycle
export const START_MINUTES = 9 * 60;    // the story opens at 9:00 AM

// Wanted system: heat is earned per crime and cools when unseen.
export const HEAT = {
  stealCar: 22,        // stealing a car in view of someone
  hitCar: 10,          // ramming another car
  hitPed: 30,          // running a pedestrian down
  punch: 12,           // a witnessed assault
  shot: 26,            // a witnessed gunshot
  copDown: 55,         // taking an officer down
  mission: 0,
};
export const HEAT_PER_STAR = 34;       // heat 0..170 maps to 0..5 stars
export const HEAT_DECAY = 2.4;         // heat per second while unobserved
export const HEAT_DECAY_SEEN = 0.35;   // heat per second while police watch

// Controls, shown on the help screen and the start screen.
export const CONTROLS = [
  ['W A S D / Arrows', 'Move / drive'],
  ['Shift', 'Sprint / boost'],
  ['E', 'Enter or leave a car'],
  ['Mouse', 'Aim'],
  ['Click / Space', 'Punch or fire'],
  ['F', 'Interact / talk'],
  ['M', 'Toggle sound'],
  ['P / Esc', 'Pause'],
  ['Enter', 'Confirm'],
];

export const SAVE_KEY = 'palmera-heat-save-v1';
