// score.js — reads the pre-baked risk grid.
//
// The browser never computes a risk model: it looks up a 100 m cell in a small JSON file and reads
// numbers that were baked in the pipeline. Everything here is arithmetic on those numbers, which is
// why the score appears instantly and keeps working with the wifi off.

export const state = {
  index: null,
  fields: null,
  cpt: 24,
  gridZoom: 14,
  cellsPerTile: 24,
  world: 1,
  exponent: 0,
  cellMetres: 100,
};

const cache = new Map();
const pending = new Map();
let loadingCount = 0;
export const onLoadingChange = { current: () => {} };

export async function loadScoreIndex() {
  const index = await (await fetch('data/score/index.json')).json();
  Object.assign(state, {
    index,
    fields: index.fields,
    cpt: index.cellsPerTile,
    gridZoom: index.gridZoom,
    cellsPerTile: index.cellsPerTile,
    cellMetres: index.cellMetres,
    exponent: index.gridZoom + Math.log2(index.cellsPerTile),
  });
  state.world = 2 ** state.exponent;
  return index;
}

export const gxOf = (lon) => Math.floor(((lon + 180) / 360) * state.world);
export const gyOf = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * state.world);
};
export const x2lon = (gx) => (gx / state.world) * 360 - 180;
export const y2lat = (gy) => {
  const n = Math.PI - (2 * Math.PI * gy) / state.world;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

async function fetchJson(url) {
  loadingCount += 1;
  onLoadingChange.current(loadingCount);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    loadingCount -= 1;
    onLoadingChange.current(loadingCount);
  }
}

export function scoreTile(tx, ty) {
  const key = `${tx}:${ty}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const promise = fetchJson(`data/score/${state.gridZoom}/${tx}/${ty}.json`).then((tile) => {
    cache.set(key, tile);
    pending.delete(key);
    return tile;
  });
  pending.set(key, promise);
  return promise;
}

/** Read one cell's baked fields into a friendly object. */
export function readCell(tile, index) {
  const c = tile.c;
  const F = state.fields;
  const n = tile.n;
  const o = index * n;
  const num = (offset) => {
    const v = c[o + offset];
    return v === undefined ? null : v;
  };
  return {
    tile,
    index,
    masked: num(F.MASK) > 0,
    elevation: num(F.ELEV),
    vuln: (num(F.VULN) ?? -1) / 100,
    expo: (num(F.EXPO) ?? 0) / 100,
    hazard: [0, 1, 2, 3, 4].map((k) => (num(F.HAZ + k) ?? 0) / 100),
    depth: [0, 1, 2, 3, 4].map((k) => (num(F.DEPTH + k) ?? 0) / 100),
    score: [0, 1, 2, 3, 4].map((k) => (num(F.SCORE + k) ?? 0) / 10),
    rainThreshold: num(F.RAIN),
    wetland: (num(F.WET) ?? 0) / 100,
    pop: num(F.POP),
    bldc: num(F.BLDC),
    roadd: num(F.ROADD),
    crit: num(F.CRIT),
    lh: (num(F.LH) ?? 0) / 100,
    years: tile.years,
  };
}

export function cellIndexFor(tx, ty, gx, gy) {
  const cpt = state.cellsPerTile;
  return (gy - ty * cpt) * cpt + (gx - tx * cpt);
}

export async function cellAt(lon, lat) {
  const cpt = state.cellsPerTile;
  const gx = gxOf(lon);
  const gy = gyOf(lat);
  const tx = Math.floor(gx / cpt);
  const ty = Math.floor(gy / cpt);
  const tile = await scoreTile(tx, ty);
  if (!tile) return null;
  const cell = readCell(tile, cellIndexFor(tx, ty, gx, gy));
  cell.lon = lon;
  cell.lat = lat;
  return cell;
}

/** Bounds of one grid cell, for drawing it. */
export function cellBounds(gx, gy) {
  const west = x2lon(gx);
  const east = x2lon(gx + 1);
  const north = y2lat(gy);
  const south = y2lat(gy + 1);
  return [west, south, east, north];
}

export function cellPolygon(gx, gy) {
  const [west, south, east, north] = cellBounds(gx, gy);
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

/**
 * The score, optionally as it would stand with the wetlands restored.
 * Restoring wetlands only touches the hazard term, which is why the app can redo it in the browser.
 */
export function scoreFor(cell, yearIndex, { wetlands = false } = {}) {
  const hazardRaw = cell.hazard[yearIndex] ?? 0;
  const attenuation = wetlands ? cell.wetland : 0;
  const hazard = hazardRaw * (1 - attenuation);
  const value = 10 * (hazard + 0.3 * Math.max(0, cell.vuln) + 0.1 * cell.expo);
  return {
    value: Math.max(0, Math.min(10, value)),
    hazard,
    hazardRaw,
    depth: cell.depth[yearIndex] ?? 0,
    attenuation,
  };
}

export function previousScore(cell, yearIndex, options) {
  if (yearIndex <= 0) return null;
  return scoreFor(cell, yearIndex - 1, options).value;
}

export const BANDS = [
  { max: 2, label: 'low', color: '#22c55e' },
  { max: 4, label: 'moderate', color: '#eab308' },
  { max: 6, label: 'elevated', color: '#f97316' },
  { max: 8, label: 'severe', color: '#ef4444' },
  { max: 10.01, label: 'extreme', color: '#c026d3' },
];

export function riskBand(value) {
  for (const band of BANDS) if (value < band.max) return band;
  return BANDS[BANDS.length - 1];
}

export function rampColorAt(value) {
  return riskBand(value).color;
}

/** Animated number for the dial: eased, never linear, and it lands on the exact value. */
export function animateValue(element, from, to, { duration = 620, format = (v) => v.toFixed(1) } = {}) {
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    element.textContent = format(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export const formatMm = (value) => `${Math.round(value)} mm`;
