// main.ts — the entry Make.fun runs. Palmera Heat is a static browser
// game, so this file is pure plumbing: copy game/ and screenshots/ into
// the output directory byte for byte, then ask the kit's dossier builder
// to describe what was handed in. No game logic lives here.

import { cpSync, writeFileSync } from "node:fs";
import { buildDossier } from "./vendor/makefun-game.ts";

const root = new URL("./", import.meta.url).pathname.replace(/\/$/, "");
const out = (process.env.MAKEFUN_OUTPUT_DIR || "/output").replace(/\/$/, "");

cpSync(root + "/game", out + "/game", { recursive: true });
cpSync(root + "/screenshots", out + "/screenshots", { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
  game_path_max_bytes: 1_000,
});

writeFileSync(out + "/dossier.json", dossier);
