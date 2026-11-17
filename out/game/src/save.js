// save.js — the run persists in localStorage: cash, story progress, fares
// and where Rafe left off. The game itself still makes no network requests;
// this is the browser's own storage, on the player's own machine.

import { SAVE_KEY } from './config.js';

export function saveGame(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, ...data }));
    return true;
  } catch (err) {
    return false; // storage can be unavailable (private mode); play on.
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : null;
  } catch (err) {
    return null;
  }
}

export function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to wipe */ }
}
