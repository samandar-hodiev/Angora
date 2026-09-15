#!/usr/bin/env node
// Generates the placement listening clips from the transcripts in
// apps/api/cmd/seed/placement/content.json using macOS text-to-speech (say + afconvert).
//
//   node infrastructure/scripts/generate-placement-audio.mjs
//
// Output: apps/api/cmd/seed/placement/audio/<slug>.m4a and durations.json. The clips are
// committed so seeding works on any OS; rerun this after changing a transcript.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const placementDir = join(root, "apps/api/cmd/seed/placement");
const outDir = join(placementDir, "audio");
const content = JSON.parse(readFileSync(join(placementDir, "content.json"), "utf8"));

let voices;
try {
  voices = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
} catch {
  console.error("This script needs macOS text-to-speech (say and afconvert).");
  process.exit(1);
}
const hasVoice = (name) => voices.split("\n").some((line) => line.startsWith(`${name} `));

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "engora-audio-"));
const durations = {};

try {
  for (const clip of content.listening) {
    const voice = hasVoice(clip.voice) ? clip.voice : "Daniel";
    const aiff = join(tmp, `${clip.slug}.aiff`);
    const m4a = join(outDir, `${clip.slug}.m4a`);
    execFileSync("say", ["-v", voice, "-r", String(clip.rate ?? 170), "-o", aiff, clip.transcript]);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", aiff, m4a]);
    const info = execFileSync("afinfo", [m4a], { encoding: "utf8" });
    const seconds = Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0);
    durations[clip.slug] = Math.round(seconds * 1000);
    console.log(`${clip.slug}: ${voice}, ${seconds.toFixed(1)}s`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(outDir, "durations.json"), `${JSON.stringify(durations, null, 2)}\n`);
