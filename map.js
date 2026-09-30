// map.js — the map, its layers, and the risk grid drawn from the pre-baked tiles.
//
// One renderer does 2D and 3D: the 3D view is the same map, tilted, with real terrain switched on and
// the score grid extruded to each cell's water depth. Nothing here talks to a tile server on the
// internet — the basemap, terrain and scores are all served from this folder.

import { state as scoreState, scoreTile, cellBounds, rampColorAt } from './score.js';

let map = null;
let region = null;
let current = { yearIndex: 3, wetlands: false, riskGrid: true, theme: 'dark', threeD: false };
const floodCache = new Map();

// Colour of the pixels behind the tiles, matched per theme so the coverage edge — even if it
// could be reached — blends into the basemap instead of reading as a grey void.
const VOID_COLOR = { dark: '#16283e', light: '#e8e4da' };

/** Camera fence: a padded box around the region so the offline tile edge is never on screen. */
function coverageBounds(regionConfig) {
  const pad = 0.25;
  const [south, west, north, east] = regionConfig.bbox;
  const dLat = (north - south) * pad;
  const dLon = (east - west) * pad;
  return [[west - dLon, Math.max(-85, south - dLat)], [east + dLon, Math.min(85, north + dLat)]];
}
let refreshToken = 0;

export const handlers = { onGridLoaded: () => {}, onFloodLoaded: () => {} };

const FLOOD_COLORS = {
  fill: 'rgba(64, 156, 255, 0.42)',
  line: 'rgba(140, 210, 255, 0.85)',
};

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * MapLibre wants an absolute sprite URL once the style arrives as an object rather than a file.
 * Resolving against the page URL keeps every path in this repo relative, so the app runs from any
 * folder — localhost, a subdirectory, or a CDN root — without edits.
 */
function absolutize(style) {
  const base = new URL('./', window.location.href).href; // ends in a slash
  // Templates hold {z}/{x}/{y} tokens that a URL parser would percent-encode, so join them by hand.
  const template = (value) => (/^[a-z]+:/i.test(value) ? value : base + value);
  if (style.sprite) style.sprite = template(style.sprite);
  if (style.glyphs) style.glyphs = template(style.glyphs);
  for (const source of Object.values(style.sources || {})) {
    if (Array.isArray(source.tiles)) source.tiles = source.tiles.map(template);
    if (typeof source.url === 'string') source.url = template(source.url);
  }
  return style;
}

async function fetchStyle(theme) {
  return absolutize(await (await fetch(`data/basemap-${theme}.json`)).json());
}

export function getMap() {
  return map;
}

export async function initMap(container, regionConfig) {
  region = regionConfig;
  const style = await fetchStyle(current.theme);

  map = new maplibregl.Map({
    container,
    style,
    center: region.initialView.center,
    zoom: region.initialView.zoom,
    pitch: 0,
    attributionControl: false,
    maxZoom: 18,
    minZoom: 10.5,
    maxBounds: coverageBounds(regionConfig),
    dragRotate: true,
    hash: false,
    fadeDuration: 220,
  });

  map.getContainer().style.background = VOID_COLOR[current.theme];
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
  map.on('style.load', installOverlays);
  await new Promise((resolve) => map.once('load', resolve));
  installOverlays();
  return map;
}

function addSource(id, spec) {
  if (!map.getSource(id)) map.addSource(id, spec);
}

/** Every overlay is reinstalled after a style swap, so the theme toggle never loses them. */
function installOverlays() {
  addSource('pin', { type: 'geojson', data: emptyFC() });
  addSource('selected-cell', { type: 'geojson', data: emptyFC() });
  addSource('risk-grid', { type: 'geojson', data: emptyFC() });
  addSource('flood', { type: 'geojson', data: emptyFC() });
  addSource('measured', { type: 'geojson', data: emptyFC() });
  addSource('wetlands', { type: 'geojson', data: emptyFC() });
  addSource('coverage', { type: 'geojson', data: emptyFC() });
  addSource('water-3d', { type: 'geojson', data: emptyFC() });
  addSource('terrain', {
    type: 'raster-dem',
    tiles: ['data/terrain/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    minzoom: region.terrain.minZoom,
    maxzoom: region.terrain.maxZoom,
    attribution: 'Elevation: AWS Open Data Terrain Tiles',
  });

  const before = map.getLayer('water') ? 'water' : undefined;

  // The scored area has a hard edge; draw its boundary as an intentional dashed coverage line.
  if (!map.getLayer('coverage-line')) {
    map.addLayer({
      id: 'coverage-line',
      type: 'line',
      source: 'coverage',
      paint: {
        'line-color': 'rgba(142, 163, 196, 0.55)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 1.6],
        'line-dasharray': [3, 2],
      },
    });
  }
  if (!map.getLayer('risk-grid-fill')) {
    map.addLayer({
      id: 'risk-grid-fill',
      type: 'fill',
      source: 'risk-grid',
      layout: { visibility: current.riskGrid ? 'visible' : 'none' },
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['get', 's'],
          0, '#22c55e', 2, '#a3d900', 4, '#eab308', 6, '#f97316', 8, '#ef4444', 10, '#c026d3',
        ],
        'fill-opacity': ['interpolate', ['linear'], ['get', 's'], 0, 0.16, 3, 0.3, 6, 0.45, 8, 0.58, 10, 0.7],
      },
    });
  }
  if (!map.getLayer('risk-grid-line')) {
    map.addLayer({
      id: 'risk-grid-line',
      type: 'line',
      source: 'risk-grid',
      layout: { visibility: current.riskGrid ? 'visible' : 'none' },
      paint: { 'line-color': 'rgba(4, 12, 22, 0.35)', 'line-width': 0.4 },
    });
  }
  if (!map.getLayer('flood-fill')) {
    map.addLayer({
      id: 'flood-fill',
      type: 'fill',
      source: 'flood',
      // Outline-led: a solid fill here is what made the map read blue/purple/orange and fought the
      // risk ramp. The wash only anchors the polygons; the line carries the shape.
      paint: { 'fill-color': FLOOD_COLORS.fill, 'fill-opacity': 0.18, 'fill-antialias': true },
    });
  }
  if (!map.getLayer('flood-line')) {
    map.addLayer({
      id: 'flood-line',
      type: 'line',
      source: 'flood',
      paint: {
        'line-color': FLOOD_COLORS.line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.8, 17, 3.0],
      },
    });
  }
  if (!map.getLayer('measured-dots')) {
    map.addLayer({
      id: 'measured-dots',
      type: 'circle',
      source: 'measured',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'inches'], 1, 3, 24, 8, 60, 16],
        'circle-color': '#facc15',
        'circle-opacity': 0.5,
        'circle-stroke-color': 'rgba(250, 204, 21, 0.9)',
        'circle-stroke-width': 0.8,
      },
    });
  }
  if (!map.getLayer('wetland-fill')) {
    map.addLayer({
      id: 'wetland-fill',
      type: 'fill',
      source: 'wetlands',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#2fbf71', 'fill-opacity': 0.4, 'fill-outline-color': '#7ff0b0' },
    });
    map.addLayer({
      id: 'wetland-line',
      type: 'line',
      source: 'wetlands',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#8ef2b8', 'line-width': 1.1, 'line-dasharray': [2, 1.4] },
    });
  }
  if (!map.getLayer('buildings-3d')) {
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'protomaps',
      'source-layer': 'buildings',
      minzoom: 13.5,
      layout: { visibility: current.threeD ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 7], 0, '#31405a', 12, '#46536b', 30, '#5d7396', 80, '#7f97bd'],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 7],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82,
      },
    });
  }
  if (!map.getLayer('water-3d')) {
    map.addLayer({
      id: 'water-3d',
      type: 'fill-extrusion',
      source: 'water-3d',
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['get', 'd'],
          0.05, '#67f7e3', 0.4, '#2fd0ff', 0.9, '#2f6bff', 1.6, '#5b21d6',
        ],
        'fill-extrusion-height': ['*', ['get', 'd'], region.terrain.verticalExaggeration],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.7,
      },
    });
  }
  if (!map.getLayer('pin-ring')) {
    map.addLayer({
      id: 'selected-cell-line',
      type: 'line',
      source: 'selected-cell',
      paint: { 'line-color': 'rgba(255, 255, 255, 0.9)', 'line-width': 2 },
    });
    map.addLayer({
      id: 'pin-glow',
      type: 'circle',
      source: 'pin',
      paint: { 'circle-radius': 16, 'circle-color': 'rgba(70, 199, 255, 0.18)', 'circle-blur': 0.6 },
    });
    map.addLayer({
      id: 'pin-ring',
      type: 'circle',
      source: 'pin',
      paint: {
        'circle-radius': 6,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#46c7ff',
        'circle-stroke-width': 3,
      },
    });
  }
  if (before) {
    // keep the overlays above the basemap water so thin rivers do not hide the risk grid
    for (const id of ['risk-grid-fill', 'risk-grid-line', 'flood-fill', 'flood-line', 'measured-dots', 'wetland-fill', 'wetland-line']) {
      if (map.getLayer(id)) map.moveLayer(id);
    }
  }
}

export function enableRotateHelp() {
  return map.dragRotate.isEnabled();
}

// ---------------------------------------------------------------- pin and selection
export function setPin(lon, lat) {
  map.getSource('pin')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] });
  const [west, south, east, north] = cellBounds(...cellGxGy(lon, lat));
  map.getSource('selected-cell')?.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
      properties: {},
    }],
  });
}

function cellGxGy(lon, lat) {
  const r = (lat * Math.PI) / 180;
  const gx = Math.floor(((lon + 180) / 360) * scoreState.world);
  const gy = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scoreState.world);
  return [gx, gy];
}

export function flyToAddress(lon, lat, { zoom = null } = {}) {
  const targetZoom = zoom ?? Math.max(map.getZoom(), 15.4);
  map.flyTo({ center: [lon, lat], zoom: targetZoom, duration: 1400, essential: true, curve: 1.3 });
}

// ---------------------------------------------------------------- flood layers
export async function showYear(yearKey) {
  const source = map.getSource('flood');
  if (!source) return;
  let data = floodCache.get(yearKey);
  if (!data) {
    try {
      data = await (await fetch(`data/flood/${yearKey}.json`)).json();
      floodCache.set(yearKey, data);
    } catch {
      data = emptyFC();
    }
  }
  source.setData(data);
  handlers.onFloodLoaded(yearKey, data.features.length);
}

export async function showMeasured(visible) {
  const source = map.getSource('measured');
  if (!source) return;
  if (!visible) {
    source.setData(emptyFC());
    return;
  }
  if (!floodCache.has('__measured')) {
    try {
      floodCache.set('__measured', await (await fetch('data/flood/measured.json')).json());
    } catch {
      floodCache.set('__measured', emptyFC());
    }
  }
  source.setData(floodCache.get('__measured'));
  if (map.getLayer('measured-dots')) map.setLayoutProperty('measured-dots', 'visibility', 'visible');
}

/** Coverage outline loads once; it never changes unless the pipeline re-runs. */
export async function ensureCoverage() {
  const source = map.getSource('coverage');
  if (!source || floodCache.has('__coverage')) return;
  try {
    floodCache.set('__coverage', await (await fetch('data/score-coverage.geojson')).json());
  } catch {
    floodCache.set('__coverage', emptyFC());
  }
  source.setData(floodCache.get('__coverage'));
}

export async function showWetlands(visible) {
  const source = map.getSource('wetlands');
  if (!source) return;
  if (!floodCache.has('__wetlands')) {
    try {
      floodCache.set('__wetlands', await (await fetch('data/wetlands.geojson')).json());
    } catch {
      floodCache.set('__wetlands', emptyFC());
    }
  }
  source.setData(visible ? floodCache.get('__wetlands') : emptyFC());
  for (const id of ['wetland-fill', 'wetland-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
  if (visible) map.easeTo({ pitch: current.threeD ? 58 : 18, duration: 700 });
}

// ---------------------------------------------------------------- risk grid
export function setRiskGridVisible(visible) {
  current.riskGrid = visible;
  for (const id of ['risk-grid-fill', 'risk-grid-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

export function setWaterVisible(visible) {
  if (map.getLayer('water-3d')) map.setLayoutProperty('water-3d', 'visibility', visible ? 'visible' : 'none');
}

/** Which grid tiles the viewport needs, with an aggregation stride so a phone never gets 10k polygons. */
function visibleTiles() {
  const bounds = map.getBounds();
  const cpt = scoreState.cellsPerTile;
  const z = scoreState.gridZoom;
  const lonToX = (lon, zz) => Math.floor(((lon + 180) / 360) * 2 ** zz);
  const latToY = (lat, zz) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** zz);
  };
  const x0 = lonToX(bounds.getWest(), z);
  const x1 = lonToX(bounds.getEast(), z);
  const y0 = latToY(bounds.getNorth(), z);
  const y1 = latToY(bounds.getSouth(), z);
  const tiles = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) tiles.push([tx, ty]);
    if (tiles.length > 220) break;
  }
  const zoom = map.getZoom();
  const stride = zoom < 11.5 ? 4 : zoom < 12.8 ? 3 : zoom < 14 ? 2 : 1;
  return { tiles, stride, cpt };
}

/**
 * Rebuild the visible score grid for the selected year, aggregated by stride.
 * Each feature carries the numbers the layers need: s = score, d = depth, h = hazard.
 */
export async function refreshRiskGrid({ yearIndex, wetlands }) {
  const token = ++refreshToken;
  const { tiles, stride, cpt } = visibleTiles();
  const features = [];
  const water = [];
  const per = cpt / stride;

  for (const [tx, ty] of tiles) {
    const tile = await scoreTile(tx, ty);
    if (!tile) continue;
    for (let by = 0; by < per; by++) {
      for (let bx = 0; bx < per; bx++) {
        let bestScore = -1;
        let bestDepth = 0;
        let bestHazard = 0;
        let vuln = 0;
        let expo = 0;
        let wet = 0;
        let masked = true;
        let bestIndex = -1;
        for (let dy = 0; dy < stride; dy++) {
          for (let dx = 0; dx < stride; dx++) {
            const cx = bx * stride + dx;
            const cy = by * stride + dy;
            const i = cy * cpt + cx;
            const o = i * tile.n;
            const F = scoreState.fields;
            if (tile.c[o + F.MASK] > 0) continue;
            masked = false;
            const hazardRaw = (tile.c[o + F.HAZ + yearIndex] ?? 0) / 100;
            const atten = wetlands ? (tile.c[o + F.WET] ?? 0) / 100 : 0;
            const value = 10 * (hazardRaw * (1 - atten) + 0.3 * Math.max(0, (tile.c[o + F.VULN] ?? 0) / 100) + 0.1 * (tile.c[o + F.EXPO] ?? 0) / 100);
            if (value > bestScore) {
              bestScore = value;
              bestDepth = (tile.c[o + F.DEPTH + yearIndex] ?? 0) / 100;
              bestHazard = hazardRaw * (1 - atten);
              vuln = (tile.c[o + F.VULN] ?? 0) / 100;
              expo = (tile.c[o + F.EXPO] ?? 0) / 100;
              wet = atten;
              bestIndex = i;
            }
          }
        }
        if (masked || bestScore < 0.3) continue;
        const gx = tx * cpt + bx * stride;
        const gy = ty * cpt + by * stride;
        const west = ((gx / scoreState.world) * 360) - 180;
        const east = (((gx + stride) / scoreState.world) * 360) - 180;
        const north = latOf(gy);
        const south = latOf(gy + stride);
        const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
        const properties = {
          s: Math.round(bestScore * 10) / 10,
          d: Math.round(bestDepth * 100) / 100,
          h: Math.round(bestHazard * 100) / 100,
          w: Math.round(wet * 100) / 100,
          v: Math.round(vuln * 100),
          x: Math.round(expo * 100),
          c: bestIndex,
        };
        features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } });
        if (bestDepth > 0.05) water.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
    }
    if (features.length > 9000) break;
  }

  if (token !== refreshToken) return null;
  map.getSource('risk-grid')?.setData({ type: 'FeatureCollection', features });
  map.getSource('water-3d')?.setData({ type: 'FeatureCollection', features: water });
  handlers.onGridLoaded(features.length, water.length);
  return { cells: features.length, water: water.length };
}

function latOf(gy) {
  const n = Math.PI - (2 * Math.PI * gy) / scoreState.world;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// ---------------------------------------------------------------- 3D and theme
export async function set3D(enabled) {
  current.threeD = enabled;
  const { applyThreeD } = await import('./three-d.js');
  applyThreeD({ map, region, enabled });
}

export async function setTheme(theme) {
  if (theme === current.theme) return;
  current.theme = theme;
  map.getContainer().style.background = VOID_COLOR[theme];
  const style = await fetchStyle(theme);
  const waiting = new Promise((resolve) => map.once('style.load', resolve));
  map.setStyle(style, { diff: false });
  await waiting;
  installOverlays();
  if (current.threeD) {
    map.setTerrain({ source: 'terrain', exaggeration: region.terrain.verticalExaggeration });
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
    setWaterVisible(true);
  }
  // setStyle resets the sky, so re-paint it to match the 3D state after a theme swap.
  const { paintSky } = await import('./three-d.js');
  paintSky(map, current.threeD);
  await refreshRiskGrid(current);
}

export function onIdleRefresh(callback) {
  let timer = null;
  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(callback, 260);
  });
}

export function getMarkerColor(score) {
  return rampColorAt(score);
}
