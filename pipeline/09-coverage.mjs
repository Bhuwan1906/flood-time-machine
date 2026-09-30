// 09 — Coverage outline.
// The risk grid stops abruptly at the edge of the scored tiles, which reads as a rendering bug
// even though it is the honest boundary of the data. This writes data/score-coverage.geojson:
// the outline of every tile that has a score file, for the app to draw as a dashed "coverage
// area" line with a whisper of fill. Re-run whenever the score grid changes.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

const gridZoom = 14;
const dir = path.join(DATA, 'score', String(gridZoom));
if (!fs.existsSync(dir)) {
  console.error(`no score tiles at data/score/${gridZoom} — run the score build first`);
  process.exit(1);
}

// Tile bounds in lon/lat (Web Mercator).
function tileBounds(x, y, z) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const latRad = (lat) => (lat * Math.PI) / 180;
  const latOf = (yy) => {
    const nn = Math.PI - (2 * Math.PI * yy) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nn) - Math.exp(-nn)));
  };
  return { west, east, north: latOf(y), south: latOf(y + 1) };
}

// Collect every edge; edges shared by two tiles are interior, the rest form the outline.
const edgeCount = new Map();
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

let tileCount = 0;
for (const xDir of fs.readdirSync(dir)) {
  const xDirPath = path.join(dir, xDir);
  if (!fs.statSync(xDirPath).isDirectory()) continue;
  for (const file of fs.readdirSync(xDirPath)) {
    if (!file.endsWith('.json')) continue;
    const y = Number.parseInt(file, 10);
    const x = Number.parseInt(xDir, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    tileCount++;
    const { west, east, north, south } = tileBounds(x, y, gridZoom);
    const corners = {
      nw: [west, north], ne: [east, north], se: [east, south], sw: [west, south],
    };
    const edges = [
      ['nw', 'ne'], ['ne', 'se'], ['se', 'sw'], ['sw', 'nw'],
    ];
    for (const [a, b] of edges) {
      const pa = JSON.stringify(corners[a]);
      const pb = JSON.stringify(corners[b]);
      const k = key(pa, pb);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
}

const outline = [];
for (const [k, count] of edgeCount) {
  if (count !== 1) continue;
  const [pa, pb] = k.split('|').map((s) => JSON.parse(s));
  outline.push([pa, pb]);
}

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { kind: 'outline' },
      geometry: { type: 'MultiLineString', coordinates: outline },
    },
  ],
};
fs.writeFileSync(path.join(DATA, 'score-coverage.geojson'), JSON.stringify(geojson));
console.log(`coverage outline: ${tileCount} tiles, ${outline.length} boundary segments -> data/score-coverage.geojson`);
