// Flood Time Machine — shared pipeline helpers.
// Pure Node (no Python, no build step). Runs before the hackathon, never during the demo.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const CACHE = path.join(ROOT, '.cache');

const START = Date.now();

export function log(...args) {
  const t = ((Date.now() - START) / 1000).toFixed(1).padStart(6);
  console.log(`[${t}s]`, ...args);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(relPath, obj, pretty = false) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  return fs.statSync(abs).size;
}

export function readJson(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

export function loadRegion(id) {
  const cfg = readJson('data/regions.json');
  const key = id || cfg.defaultRegion;
  const region = cfg.regions[key];
  if (!region) throw new Error(`Unknown region "${key}" in data/regions.json`);
  return region;
}

export function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- tile math (Web Mercator / slippy tiles) ----------
export const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
export const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** [south, west, north, east] -> inclusive tile ranges for a zoom level. */
export function tileRange(bbox, z) {
  const [s, w, n, e] = bbox;
  return { x0: lon2x(w, z), x1: lon2x(e, z), y0: lat2y(n, z), y1: lat2y(s, z) };
}

export function tilesInBbox(bbox, z) {
  const { x0, x1, y0, y1 } = tileRange(bbox, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

/** Metres per tile edge and per pixel on the ground at a given latitude. */
export function groundMetresPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

// ---------- network ----------
export async function fetchRetry(url, opts = {}, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < tries) await sleep(400 * 2 ** (i - 1));
    }
  }
  throw new Error(`${url} failed after ${tries} tries: ${lastErr?.message}`);
}

export async function fetchBuffer(url, opts, tries) {
  const res = await fetchRetry(url, opts, tries);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchJson(url, opts, tries) {
  const res = await fetchRetry(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } }, tries);
  return res.json();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal PNG decoder (terrarium elevation tiles) ----------
// Supports 8-bit RGB / RGBA / greyscale, non-interlaced — which is what AWS Terrain Tiles ship.
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Terrarium elevation: (R * 256 + G + B / 256) - 32768 metres. */
export function pngElevation(png, px, py) {
  const { width, height, channels, data } = png;
  const x = Math.max(0, Math.min(width - 1, px));
  const y = Math.max(0, Math.min(height - 1, py));
  const i = (y * width + x) * channels;
  return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
}

// ---------- geometry ----------
export function bboxOfGeometry(geom) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]);
      s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else for (const part of c) walk(part);
  };
  walk(geom.coordinates);
  return [s, w, n, e];
}

export function bboxOverlap(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Ray-casting point-in-ring. ring is [[lon,lat], ...] (closed or open). */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon, lat, rings) {
  if (!rings.length) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
  return true;
}

export function eachPolygon(feature, fn) {
  const g = feature.geometry;
  if (!g) return;
  if (g.type === 'Polygon') fn(g.coordinates, feature);
  else if (g.type === 'MultiPolygon') for (const p of g.coordinates) fn(p, feature);
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round = (v, d = 2) => Number(v.toFixed(d));
