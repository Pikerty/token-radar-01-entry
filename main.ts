// Token launch radar — entrypoint.
//
// Reads the sealed DefiLlama snapshot, builds the ranked board of pre-token protocols with
// the model in lib/model.ts, and writes everything the grader expects into the output
// directory: board.json (the ranked board), data.js (the dashboard's dataset), a copy of
// dashboard/ and screenshots/, and dossier.json (built with the vendored make.fun library,
// which the scorer rebuilds and compares byte for byte).
//
// Run locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`radar: snapshot not found at ${snapshotPath} (pass --input <file|dir>)\n`);
  process.exit(2);
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = buildRadar(snapshot);
const problem = validateBoard(radar.board, snapshot);
if (problem !== null) {
  process.stderr.write(`radar: board would fail the gate: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: radar.board }) + '\n');
writeFileSync(join(outputDir, 'data.js'), `window.RADAR=${JSON.stringify(radar.data)};\n`);

/** Copy the regular, non-hidden files of one directory into another; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

copyDir(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyDir(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shots.length} files; the gate wants 3 or 4 images\n`);
  process.exit(1);
}

// Written last: the dossier describes the dashboard and screenshots as they now stand.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ` +
    `${radar.board.length} board rows (${radar.data.early_size} beyond the watchlist)\n`,
);
