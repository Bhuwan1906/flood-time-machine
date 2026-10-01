// 08 — Verify. Run this before the demo (and after any change during the event).
//
// It answers one question: if a judge taps a random street right now, will the app have an answer?
// It checks the data is complete and parseable, that the three demo stops resolve to real scored
// cells, that no absolute paths crept in, and that nothing the app fetches is missing.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA, log, readJson, loadRegion, human, y2lat } from './lib.mjs';

const region = loadRegion(process.argv[2]);
const problems = [];
const warnings = [];
const ok = [];

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full, ext);
    else if (full.endsWith(ext)) n += 1;
  }
  return n;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

// ---------------------------------------------------------------- 1. app files
const APP_FILES = ['index.html', 'app.js', 'map.js', 'score.js', 'three-d.js', 'style.css', 'server.mjs', 'start.bat', 'README.md', 'LICENSE'];
for (const file of APP_FILES) {
  if (exists(file)) ok.push(file);
  else problems.push(`missing app file: ${file}`);
}

// ---------------------------------------------------------------- 2. data files
const DATA_FILES = [
  'data/regions.json', 'data/manifest.json', 'data/places.json', 'data/receipts-summary.json',
  'data/wetlands.geojson', 'data/demo-areas.json', 'data/basemap-light.json', 'data/basemap-dark.json',
  'data/score/index.json', 'data/flood/index.json', 'data/flood/measured.json',
  'data/vendor/maplibre-gl.js', 'data/vendor/pmtiles.js', 'data/terrain-meta.json', 'data/basemap-meta.json',
];
for (const file of DATA_FILES) {
  if (exists(file)) ok.push(file);
  else problems.push(`missing data file: ${file}`);
}

const scoreIndex = exists('data/score/index.json') ? readJson('data/score/index.json') : null;
const floodIndex = exists('data/flood/index.json') ? readJson('data/flood/index.json') : null;
const exposure = exists('data/exposure.json') ? readJson('data/exposure.json') : null;

// ---------------------------------------------------------------- 3. every layer for every year
for (const year of floodIndex?.years || []) {
  if (!exists(year.file)) problems.push(`missing flood layer for ${year.key}: ${year.file}`);
  else if (year.featuresInApp === 0) warnings.push(`${year.key} has no features in the app`);
}

// ---------------------------------------------------------------- 4. tile counts and JSON integrity
const tiles = countFiles(path.join(DATA, 'tiles'), '.mvt');
const terrain = countFiles(path.join(DATA, 'terrain'), '.png');
const scoreFiles = countFiles(path.join(DATA, 'score'), '.json') - 2; // minus index.json and demo-snapshot.json
const fonts = countFiles(path.join(DATA, 'fonts'), '.pbf');
if (tiles < 600) problems.push(`basemap tiles look incomplete: ${tiles}`);
else ok.push(`${tiles} basemap tiles`);
if (terrain < 500) problems.push(`terrain tiles look incomplete: ${terrain}`);
else ok.push(`${terrain} terrain tiles`);
if (scoreFiles < 400) problems.push(`score tiles look incomplete: ${scoreFiles}`);
else ok.push(`${scoreFiles} score tiles`);
if (fonts < 10) warnings.push(`only ${fonts} font range files — some labels will fall back to a system font`);
else ok.push(`${fonts} font range files`);

// ---------------------------------------------------------------- 4b. exposure layer (challenge 4.4)
if (!exposure) {
  problems.push('missing data/exposure.json — run pipeline/11-exposure.mjs');
} else if (!scoreIndex || (scoreIndex.fieldCount ?? 0) < 24) {
  problems.push('score tiles lack POP/BLDC/ROADD fields — run pipeline/10-population.mjs');
} else {
  const byKey = Object.fromEntries(exposure.years.map((y) => [y.key, y]));
  for (const year of scoreIndex.years) {
    const y = byKey[year.key];
    if (!y) problems.push(`exposure.json has no entry for ${year.key}`);
    else if (typeof y.people !== 'number' || typeof y.roadKm !== 'number') problems.push(`exposure entry for ${year.key} is malformed`);
    else if (typeof y.crit !== 'number') problems.push(`exposure entry for ${year.key} lacks critical-site counts — re-run pipeline/11-exposure.mjs`);
  }
  if (exposure.years?.length === scoreIndex.years.length) {
    const worst = exposure.years.reduce((a, b) => (b.people > a.people ? b : a));
    const critTotal = exposure.cityTotals?.crit ?? 0;
    ok.push(`exposure stats for all ${exposure.years.length} years (worst: ${worst.label}, ${worst.people.toLocaleString('en-IN')} people, ${critTotal.toLocaleString('en-IN')} critical facilities citywide)`);
  }
}

// ---------------------------------------------------------------- 4c. PS 1.1: routes + multi-hazard
const routesFile = exists('data/routes/routes.json') ? readJson('data/routes/routes.json') : null;
if (!routesFile) {
  problems.push('missing data/routes/routes.json — run pipeline/14-route-graph.mjs');
} else {
  const risk = routesFile.routes.filter((r) => r.mode === 'least-risk').length;
  const short = routesFile.routes.filter((r) => r.mode === 'shortest').length;
  if (!routesFile.origins?.length) problems.push('routes.json has no origins');
  else if (risk === 0 || risk !== short) problems.push(`routes.json incomplete: ${risk} least-risk vs ${short} shortest`);
  else {
    const today = routesFile.routes.filter((r) => r.year === 'today' && r.mode === 'shortest');
    const worstSevere = today.length ? Math.max(...today.map((r) => r.severeKm)) : 0;
    ok.push(`${routesFile.origins.length} origins × hospitals+shelters × ${routesFile.years.length} years: ${routesFile.routes.length} baked routes (worst shortest-route severe leg today: ${worstSevere} km in ≥0.6 m water)`);
  }
  for (const r of routesFile.routes) {
    if (!r.edges?.length || !r.dest?.lonLat) { problems.push(`route ${r.origin}/${r.year}/${r.mode}/${r.role} is malformed`); break; }
  }
}
const graphMeta = exists('data/routes/graph-meta.json') ? readJson('data/routes/graph-meta.json') : null;
if (!graphMeta) {
  problems.push('missing data/routes/graph-meta.json — run pipeline/14-route-graph.mjs');
} else if ((graphMeta.edges ?? 0) < 1000) {
  problems.push(`route graph too small: ${graphMeta.edges} edges`);
} else {
  ok.push(`route graph: ${graphMeta.nodes.toLocaleString('en-IN')} nodes · ${graphMeta.edges.toLocaleString('en-IN')} edge pairs · ${graphMeta.hospitals.toLocaleString('en-IN')} hospitals · ${graphMeta.shelters.toLocaleString('en-IN')} shelters`);
}
const mhFile = exists('data/multihazard.json') ? readJson('data/multihazard.json') : null;
if (!mhFile) {
  problems.push('missing data/multihazard.json — run pipeline/13-multihazard.mjs');
} else if (!scoreIndex || (scoreIndex.fieldCount ?? 0) < 26) {
  problems.push('score tiles lack the LH landslide field — run pipeline/13-multihazard.mjs');
} else {
  ok.push(`multi-hazard MCDM (WLC): weights ${mhFile.weights.floodHazard}/${mhFile.weights.waterlogging}/${mhFile.weights.landslide}/${mhFile.weights.exposure} (flood/waterlogging/landslide/exposure), per-year counts for ${mhFile.byYear?.length ?? 0} years`);
}

// Spot-check score tiles: right length, right field count, a real spread of scores.
const expectedLength = (scoreIndex?.cellsPerTile ?? 24) ** 2 * (scoreIndex?.fieldCount ?? 21);
const sample = [];
if (scoreIndex) {
  const base = path.join(DATA, 'score', String(scoreIndex.gridZoom));
  if (fs.existsSync(base)) {
    const xDirs = fs.readdirSync(base).slice(0, 60);
    for (const x of xDirs) {
      for (const y of fs.readdirSync(path.join(base, x)).slice(0, 4)) sample.push(path.join(base, x, y));
    }
  }
}
let checked = 0;
let badLength = 0;
let scrambled = 0;
for (const file of sample.slice(0, 40)) {
  try {
    const tile = JSON.parse(fs.readFileSync(file, 'utf8'));
    checked++;
    if (tile.c.length !== expectedLength) badLength++;
    const scoreField = (scoreIndex.fields.SCORE ?? 13) + 4;
    let any = false;
    for (let i = 0; i < tile.c.length; i += tile.n) if (tile.c[i + scoreField] > 0) any = true;
    if (!any) scrambled++;
  } catch (err) {
    problems.push(`score tile will not parse: ${path.relative(ROOT, file)} (${err.message})`);
  }
}
if (checked) {
  if (badLength) problems.push(`${badLength} of ${checked} sampled score tiles have the wrong length (expected ${expectedLength})`);
  else ok.push(`${checked} score tiles parse with the expected ${expectedLength} values each`);
  if (scrambled) warnings.push(`${scrambled} sampled score tiles have no non-zero 2070 score at all`);
}

// ---------------------------------------------------------------- 5. the demo stops must work
const gridWorld = scoreIndex ? 2 ** (scoreIndex.gridZoom + Math.log2(scoreIndex.cellsPerTile)) : 0;
const fields = scoreIndex?.fields || {};
const cpt = scoreIndex?.cellsPerTile ?? 24;
function lookup(lon, lat) {
  const r = (lat * Math.PI) / 180;
  const gx = Math.floor(((lon + 180) / 360) * gridWorld);
  const gy = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * gridWorld);
  const tx = Math.floor(gx / cpt);
  const ty = Math.floor(gy / cpt);
  const file = path.join(DATA, 'score', String(scoreIndex.gridZoom), String(tx), `${ty}.json`);
  if (!fs.existsSync(file)) return null;
  const tile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const o = ((gy % cpt) * cpt + (gx % cpt)) * tile.n;
  return {
    masked: tile.c[o + fields.MASK] > 0,
    elev: tile.c[o + fields.ELEV],
    scores: [0, 1, 2, 3, 4].map((k) => tile.c[o + fields.SCORE + k] / 10),
    depths: [0, 1, 2, 3, 4].map((k) => tile.c[o + fields.DEPTH + k] / 100),
    wetland: tile.c[o + fields.WET],
    pop: fields.POP !== undefined ? tile.c[o + fields.POP] : null,
    crit: fields.CRIT !== undefined ? tile.c[o + fields.CRIT] : null,
  };
}

const demoFile = exists('data/demo-areas.json') ? readJson('data/demo-areas.json') : { areas: [] };
log('');
log('demo stops:');
for (const area of demoFile.areas) {
  const cell = lookup(area.preset[0], area.preset[1]);
  if (!cell) {
    problems.push(`${area.label}: no score tile covers ${area.preset.join(', ')}`);
    continue;
  }
  if (cell.masked) problems.push(`${area.label}: the preset lands on a masked cell (sea, river or marsh)`);
  const line = `${area.label}: scores ${cell.scores.map((s) => s.toFixed(1)).join(' / ')} · ground ${cell.elev} m · residents ≈${cell.pop ?? '?'} · critical sites ${cell.crit ?? '?'} · wetland term ${cell.wetland}%`;
  log(`  ${line}`);
  ok.push(line);
}

// ---------------------------------------------------------------- 6. no absolute paths, offline ready
const APP_SOURCES = ['index.html', 'app.js', 'map.js', 'score.js', 'three-d.js', 'style.css'];
for (const file of APP_SOURCES) {
  if (!exists(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const hits = text.match(/(?:src|href)\s*=\s*["']\/(?!\/)/g);
  if (hits) problems.push(`${file} contains absolute paths (${hits.length}) — breaks subfolder hosting`);
}
ok.push('no absolute asset paths');

const strays = [];
for (const file of APP_SOURCES) {
  if (!exists(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    if (!/opencity|openstreetmap|protomaps|open-meteo|amazonaws|w3\.org|localhost/.test(match[0])) continue;
    strays.push(`${file}: ${match[0]}`);
  }
}
if (strays.length) {
  warnings.push('network URLs referenced in app files (fine if they are attribution only):');
  for (const stray of strays) warnings.push(`    ${stray}`);
}

// ---------------------------------------------------------------- 7. report
const sizes = {
  basemap: dirSize(path.join(DATA, 'tiles')),
  terrain: dirSize(path.join(DATA, 'terrain')),
  score: dirSize(path.join(DATA, 'score')),
  flood: dirSize(path.join(DATA, 'flood')),
  fonts: dirSize(path.join(DATA, 'fonts')),
  sprites: dirSize(path.join(DATA, 'sprites')),
  vendor: dirSize(path.join(DATA, 'vendor')),
};
const total = Object.values(sizes).reduce((a, b) => a + b, 0);

log('');
log(`checks passed: ${ok.length}`);
log(`payload: ${human(total)} — ` + Object.entries(sizes).map(([k, v]) => `${k} ${human(v)}`).join(', '));
if (warnings.length) {
  log('');
  log(`warnings (${warnings.length}):`);
  for (const warning of warnings) log(`  ! ${warning}`);
}
if (problems.length) {
  log('');
  log(`PROBLEMS (${problems.length}):`);
  for (const problem of problems) log(`  x ${problem}`);
  log('');
  log('NOT demo ready.');
  process.exitCode = 1;
} else {
  log('');
  log(`demo ready — ${region.name}, ${scoreIndex ? scoreIndex.cellsScored.toLocaleString() : '?'} scored cells across ${scoreIndex ? scoreIndex.tiles : '?'} tiles.`);
}
