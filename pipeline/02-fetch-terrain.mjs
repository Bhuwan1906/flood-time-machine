// 02 — Elevation (AWS Terrain Tiles, Terrarium encoding, no API key).
// Everything the risk score says about "how low is this ground" comes from here, and the 3D view
// renders the same tiles as real terrain. Full city coverage at z11-z14, plus z15 detail only over
// the demo areas so the download stays small without looking flat where it matters.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, ensureDir, writeJson, loadRegion, human, tilesInBbox, groundMetresPerPixel } from './lib.mjs';

const CONCURRENCY = 12;
const region = loadRegion(process.argv[2]);
const terrain = region.terrain;
const dir = path.join(ROOT, 'data', 'terrain');
ensureDir(dir);

const jobs = new Map(); // "z/x/y" -> true, dedupes overlapping areas
for (let z = terrain.minZoom; z < terrain.maxZoom; z++) {
  for (const [tz, tx, ty] of tilesInBbox(region.bbox, z)) jobs.set(`${tz}/${tx}/${ty}`, [tz, tx, ty]);
}
const detailZoom = terrain.maxZoom;
for (const area of region.demoAreas) {
  for (const [tz, tx, ty] of tilesInBbox(area.bbox, detailZoom)) jobs.set(`${tz}/${tx}/${ty}`, [tz, tx, ty]);
}

const list = [...jobs.values()];
const perZoom = {};
for (const [z] of list) perZoom[z] = (perZoom[z] || 0) + 1;
log(`terrain tiles to fetch: ${list.length} ${JSON.stringify(perZoom)}`);
log(`ground resolution at z${terrain.sampleZoom}: ${groundMetresPerPixel(region.center[1], terrain.sampleZoom).toFixed(1)} m/px`);

let ok = 0;
let skipped = 0;
let bytes = 0;
let cursor = 0;

async function worker() {
  while (cursor < list.length) {
    const [z, x, y] = list[cursor++];
    const dest = path.join(dir, String(z), String(x), `${y}.png`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      ok++;
      bytes += fs.statSync(dest).size;
      continue;
    }
    const url = terrain.urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'FloodTimeMachine/1.0 (hackathon pre-bake)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, buf);
      ok++;
      bytes += buf.length;
    } catch (err) {
      skipped++;
    }
    if ((ok + skipped) % 200 === 0) log(`  ${ok + skipped}/${list.length} terrain tiles, ${human(bytes)}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

log(`terrain stored: ${ok} tiles, ${skipped} unavailable (${human(bytes)}) -> data/terrain/`);
writeJson('data/terrain-meta.json', {
  provider: terrain.provider,
  encoding: terrain.encoding,
  zoomsFull: `${terrain.minZoom}-${terrain.maxZoom - 1}`,
  zoomDetail: `${detailZoom} (demo areas only)`,
  tiles: ok,
  bytes,
}, true);
