// 01 — Offline basemap + vendored browser libraries + style JSON.
//
// Why not raster tiles from tile.openstreetmap.org? Their usage policy explicitly forbids
// bulk downloading and offline use. Protomaps ships the same OpenStreetMap data as a single
// archive designed for exactly this, so we pull only the Chennai region straight out of the
// public daily build with byte-range reads and store it as a plain folder of vector tiles.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PMTiles, FetchSource } from 'pmtiles';
import {
  ROOT, log, ensureDir, writeJson, loadRegion, human,
  tilesInBbox, x2lon, y2lat,
} from './lib.mjs';

const TILE_CONCURRENCY = 10;
const HTTP = { headers: { 'user-agent': 'FloodTimeMachine/1.0 (hackathon pre-bake)' } };

const region = loadRegion(process.argv[2]);
log(`region: ${region.name} bbox ${region.bbox.join(', ')}`);

// ---------------------------------------------------------------- vector tiles
const tilesDir = path.join(ROOT, 'data', 'tiles');
ensureDir(tilesDir);

const archive = new PMTiles(new FetchSource(region.basemap.buildUrl));
const header = await archive.getHeader();
log(`protomaps build ${region.basemap.buildDate}: zooms ${header.minZoom}-${header.maxZoom}, tileType ${header.tileType}, compression ${header.tileCompression}`);

const maxZ = Math.min(region.basemap.tileZoomMax, header.maxZoom);
const wanted = [];
for (let z = 0; z <= maxZ; z++) wanted.push(...tilesInBbox(region.bbox, z));
log(`tiles to pull: ${wanted.length} (z0-z${maxZ})`);

// The pmtiles JS reader hands back already-inflated tile bodies, but be defensive:
// if a build ever returns a still-compressed tile, unwrap it, otherwise keep the bytes as-is.
function normaliseTile(data, mode) {
  const buf = Buffer.from(data);
  const attempt = {
    1: () => zlib.gunzipSync(buf),
    2: () => zlib.brotliDecompressSync(buf),
    3: () => zlib.zstdDecompressSync(buf),
  }[mode];
  if (!attempt) return buf;
  try {
    const out = attempt();
    return out.length ? out : buf;
  } catch {
    return buf;
  }
}

let done = 0;
let kept = 0;
let bytes = 0;
let cursor = 0;

async function worker() {
  while (cursor < wanted.length) {
    const [z, x, y] = wanted[cursor++];
    const tile = await archive.getZxy(z, x, y);
    if (tile && tile.data) {
      const body = normaliseTile(tile.data, header.tileCompression);
      const dir = path.join(tilesDir, String(z), String(x));
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, `${y}.mvt`), body);
      kept++;
      bytes += body.length;
    }
    if (++done % 50 === 0) log(`  ${done}/${wanted.length} tiles, kept ${kept}, ${human(bytes)}`);
  }
}
await Promise.all(Array.from({ length: TILE_CONCURRENCY }, worker));
log(`tiles written: ${kept}/${wanted.length} (${human(bytes)}) -> data/tiles/`);

const meta = await archive.getMetadata();
writeJson('data/basemap-meta.json', {
  provider: region.basemap.provider,
  build: region.basemap.buildUrl,
  buildDate: region.basemap.buildDate,
  attribution: '© OpenStreetMap contributors (ODbL) — tiles by Protomaps',
  tilesWritten: kept,
  bytes,
  zoomsStored: `0-${maxZ}`,
  archiveMetadata: meta,
}, true);

// ---------------------------------------------------------------- browser libs
const vendor = path.join(ROOT, 'data', 'vendor');
ensureDir(vendor);

async function download(url, dest) {
  const res = await fetch(url, HTTP);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

log('vendoring MapLibre + PMTiles runtime');
const vendored = {};
vendored.maplibreJs = await download('https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js', path.join(vendor, 'maplibre-gl.js'));
vendored.maplibreCss = await download('https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css', path.join(vendor, 'maplibre-gl.css'));
vendored.pmtilesJs = await download('https://cdn.jsdelivr.net/npm/pmtiles@4/dist/pmtiles.js', path.join(vendor, 'pmtiles.js'));
log(Object.entries(vendored).map(([k, v]) => `${k} ${human(v)}`).join(', '));

// ---------------------------------------------------------------- fonts + sprites
const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// 256-codepoint blocks: Latin ranges, Tamil (Chennai place names), and the special block MapLibre uses.
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '2816-3071', '8192-8447', '65280-65535'];

const fontsDir = path.join(ROOT, 'data', 'fonts');
let fontFiles = 0;
let fontBytes = 0;
for (const stack of FONTSTACKS) {
  const dir = path.join(fontsDir, stack);
  ensureDir(dir);
  for (const range of RANGES) {
    const url = `https://protomaps.github.io/basemaps-assets/fonts/${encodeURIComponent(stack)}/${range}.pbf`;
    try {
      fontBytes += await download(url, path.join(dir, `${range}.pbf`));
      fontFiles++;
    } catch (err) {
      log(`  font range skipped: ${stack} ${range}`);
    }
  }
}
log(`fonts: ${fontFiles} range files (${human(fontBytes)})`);

const spritesDir = path.join(ROOT, 'data', 'sprites');
ensureDir(spritesDir);
const spriteVariants = {};
for (const flavor of ['light', 'dark']) {
  let ok = true;
  for (const suffix of ['', '@2x']) {
    for (const ext of ['json', 'png']) {
      const url = `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}${suffix}.${ext}`;
      try {
        await download(url, path.join(spritesDir, `${flavor}${suffix}.${ext}`));
      } catch {
        ok = false;
      }
    }
  }
  spriteVariants[flavor] = ok;
  log(`sprite ${flavor}: ${ok ? 'vendored' : 'unavailable (icons will be stripped)'}`);
}

// ---------------------------------------------------------------- style JSON
const basemaps = await import('@protomaps/basemaps');
const sourceSpec = {
  type: 'vector',
  tiles: [region.basemap.tilesPath],
  minzoom: 0,
  maxzoom: maxZ,
  attribution: '© OpenStreetMap contributors (ODbL) · Protomaps',
};

function buildStyle(flavorName) {
  const flavor = basemaps.namedFlavor(flavorName);
  const layers = basemaps.layers('protomaps', flavor, { lang: 'en' });
  const hasSprite = spriteVariants[flavorName];
  for (const layer of layers) {
    if (!hasSprite && layer.layout) delete layer.layout['icon-image'];
  }
  const style = {
    version: 8,
    name: `Flood Time Machine — ${flavorName}`,
    glyphs: 'data/fonts/{fontstack}/{range}.pbf',
    sources: { protomaps: sourceSpec },
    layers,
  };
  if (hasSprite) style.sprite = `data/sprites/${flavorName}`;
  return style;
}

for (const flavorName of ['light', 'dark']) {
  writeJson(`data/basemap-${flavorName}.json`, buildStyle(flavorName), true);
}
log('styles written: data/basemap-light.json, data/basemap-dark.json');
log('basemap stage complete — no network needed for the map from here on.');
