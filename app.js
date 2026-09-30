// app.js — wires the page together.
//
// Flow: load the pre-baked indexes, draw the map, then every interaction is a lookup. Switching year
// changes the published flood layer, the risk grid and the score; switching on 3D tips the same map
// over and lifts the water to each cell's modelled depth.

import * as score from './score.js';
import * as mapApi from './map.js';
import { THREE_D_NOTE, describeDepth } from './three-d.js';

const $ = (id) => document.getElementById(id);

const state = {
  region: null,
  years: [],
  yearIndex: 3,
  cell: null,
  lon: null,
  lat: null,
  place: null,
  wetlands: false,
  threeD: false,
  grid: true,
  theme: 'dark',
  playing: false,
  places: [],
  demoAreas: [],
};

const els = {};

// ---------------------------------------------------------------- boot
async function boot() {
  els.loading = $('loading');
  els.loadingBar = $('loading-bar');

  score.onLoadingChange.current = (count) => {
    els.loading.classList.toggle('active', count > 0);
    els.loadingBar.style.width = count > 0 ? '68%' : '100%';
    if (count === 0) setTimeout(() => { els.loadingBar.style.width = '0%'; }, 420);
  };

  const [regions, scoreIndex, floodIndex, manifest, placesFile, demoFile] = await Promise.all([
    fetch('data/regions.json').then((r) => r.json()),
    score.loadScoreIndex(),
    fetch('data/flood/index.json').then((r) => r.json()),
    fetch('data/manifest.json').then((r) => r.json()).catch(() => null),
    fetch('data/places.json').then((r) => r.json()),
    fetch('data/demo-areas.json').then((r) => r.json()),
  ]);

  state.region = regions.regions[regions.defaultRegion];
  state.years = floodIndex.years;
  state.places = placesFile.places;
  state.demoAreas = demoFile.areas;
  state.yearIndex = state.years.findIndex((y) => y.key === 'today');
  if (state.yearIndex < 0) state.yearIndex = state.years.length - 1;

  $('region-name').textContent = `${state.region.name} · ${state.region.state}`;
  $('brand-years').textContent = `${state.years[0].key} → ${state.years[state.years.length - 1].key}`;
  renderAttribution(manifest?.attribution);
  loadExposure();
  buildTicks();
  buildPresets();

  await mapApi.initMap('map', state.region);
  mapApi.ensureCoverage();
  wire();
  await selectYear(state.yearIndex);

  // Something on screen straight away for anyone arriving from a QR code.
  const first = state.demoAreas[0];
  if (first) {
    await goTo(first.preset[0], first.preset[1], `${first.label} — ${first.subtitle}`, { fly: true });
  }
  updateRecenter();

  // A small handle for rehearsal: drive the app from the console and inspect what is in memory.
  window.floodTimeMachine = {
    state,
    map: mapApi.getMap(),
    selectYear,
    goTo,
    score, // the lookup module, handy for checking a cell by hand during rehearsal
    refresh: () => mapApi.refreshRiskGrid({ yearIndex: state.yearIndex, wetlands: state.wetlands }),
  };
}

function renderAttribution(attribution) {
  const fallback = 'Flood extents: NRSC / GCC via opencity.in · Elevation: AWS Terrain Tiles · Rainfall: Open-Meteo · Buildings, roads, names: © OpenStreetMap contributors (ODbL) · Basemap tiles: Protomaps · Wards: datameet (CC-BY)';
  if (!attribution) {
    $('attribution-text').textContent = fallback;
    return;
  }
  $('attribution-text').innerHTML = Object.entries(attribution)
    .map(([label, value]) => `<strong>${label}</strong>: ${value}`)
    .join(' · ');
}

function buildTicks() {
  const ticks = $('ticks');
  ticks.innerHTML = '';
  state.years.forEach((year, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = year.key;
    // 'est.' marks modelled stops: 2005 is a coarse footprint, 2070 is a projection. Never tag a
    // measured record — the tag is a claim about data quality, not decoration.
    if (year.key === '2005' || year.key === '2070') {
      const tag = document.createElement('span');
      tag.className = 'est';
      tag.textContent = 'est.';
      tag.title = 'Modelled layer: 2005 is a coarse extent footprint, 2070 is a 200-year projection.';
      button.appendChild(tag);
    }
    button.dataset.index = String(index);
    button.addEventListener('click', () => selectYear(index));
    ticks.appendChild(button);
  });
  const slider = $('year-slider');
  slider.min = '0';
  slider.max = String(state.years.length - 1);
  slider.value = String(state.yearIndex);
}

function buildPresets() {
  const wrap = $('presets');
  wrap.innerHTML = '';
  for (const area of state.demoAreas) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = area.label;
    button.title = `${area.whyShort} (${area.subtitle})`;
    button.addEventListener('click', () => goTo(area.preset[0], area.preset[1], `${area.label} — ${area.subtitle}`, { fly: true }));
    wrap.appendChild(button);
  }
}

// ---------------------------------------------------------------- wiring
function wire() {
  const map = mapApi.getMap();

  map.on('click', (event) => {
    const { lng, lat } = event.lngLat;
    const near = nearestPlace(lng, lat);
    goTo(lng, lat, near ? `${near.name} (${near.km.toFixed(1)} km away)` : 'Pinned location', { fly: false });
  });

  $('year-slider').addEventListener('input', (event) => selectYear(Number(event.target.value)));
  $('play').addEventListener('click', () => togglePlay());

  const search = $('address');
  search.addEventListener('input', () => renderResults(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = document.querySelector('#search-results li');
      if (first) first.click();
    }
    if (event.key === 'Escape') hideResults();
  });
  search.addEventListener('blur', () => setTimeout(hideResults, 160));
  $('clear-address').addEventListener('click', () => {
    search.value = '';
    hideResults();
    $('place-line').textContent = 'Tap anywhere on the map to drop the pin on your own street.';
  });

  $('toggle-3d').addEventListener('click', async () => {
    state.threeD = !state.threeD;
    setPressed('toggle-3d', state.threeD);
    await mapApi.set3D(state.threeD);
    await mapApi.refreshRiskGrid({ yearIndex: state.yearIndex, wetlands: state.wetlands });
    $('mode-note').textContent = state.threeD
      ? THREE_D_NOTE
      : 'Each square is a 100 m cell. Colours are pre-computed risk, so the whole city is already scored before you click.';
  });

  $('toggle-wetlands').addEventListener('click', async () => {
    state.wetlands = !state.wetlands;
    setPressed('toggle-wetlands', state.wetlands);
    await mapApi.showWetlands(state.wetlands);
    await mapApi.refreshRiskGrid({ yearIndex: state.yearIndex, wetlands: state.wetlands });
    updateScorePanel();
  });

  $('toggle-grid').addEventListener('click', () => {
    state.grid = !state.grid;
    setPressed('toggle-grid', state.grid);
    mapApi.setRiskGridVisible(state.grid);
  });

  $('toggle-theme').addEventListener('click', async () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    setPressed('toggle-theme', state.theme === 'light');
    await mapApi.setTheme(state.theme);
  });

  $('recenter-button').addEventListener('click', () => {
    if (state.lon !== null) mapApi.flyToAddress(state.lon, state.lat, { zoom: 15.6 });
  });

  mapApi.onIdleRefresh(() => {
    mapApi.refreshRiskGrid({ yearIndex: state.yearIndex, wetlands: state.wetlands });
    updateRecenter();
  });

  window.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT') return;
    if (event.key === 'ArrowRight') selectYear(Math.min(state.years.length - 1, state.yearIndex + 1));
    if (event.key === 'ArrowLeft') selectYear(Math.max(0, state.yearIndex - 1));
    if (event.key === '3') $('toggle-3d').click();
    if (event.key.toLowerCase() === 'w') $('toggle-wetlands').click();
    if (event.key.toLowerCase() === 'g') $('toggle-grid').click();
    if (event.key.toLowerCase() === 'l') $('toggle-theme').click();
    if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  });
}

function setPressed(id, value) {
  $(id).setAttribute('aria-pressed', value ? 'true' : 'false');
}

// ---------------------------------------------------------------- address handling
async function goTo(lon, lat, label, { fly = true } = {}) {
  state.lon = lon;
  state.lat = lat;
  state.place = label;
  mapApi.setPin(lon, lat);
  if (fly) mapApi.flyToAddress(lon, lat, { zoom: 15.4 });
  $('place-line').textContent = label;
  $('address').value = '';
  const cell = await score.cellAt(lon, lat);
  state.cell = cell;
  updateScorePanel();
  updateRecenter();
}

function nearestPlace(lon, lat) {
  let best = null;
  let bestKm = Infinity;
  for (const place of state.places) {
    const km = haversineKm(lon, lat, place.c[0], place.c[1]);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best ? { name: best.en || best.n, km: bestKm } : null;
}

function haversineKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function renderResults(query) {
  const list = $('search-results');
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) {
    hideResults();
    return;
  }
  const matches = state.places
    .map((place) => {
      const name = place.n.toLowerCase();
      const english = (place.en || '').toLowerCase();
      let rank = -1;
      if (name.startsWith(trimmed) || english.startsWith(trimmed)) rank = 0;
      else if (name.includes(trimmed) || english.includes(trimmed)) rank = 1;
      return { place, rank };
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.place.w - b.place.w || a.place.n.length - b.place.n.length)
    .slice(0, 8);

  if (!matches.length) {
    list.hidden = false;
    list.innerHTML = '<li>No match. Tap the map instead — every tap is scored.</li>';
    return;
  }
  list.hidden = false;
  list.innerHTML = '';
  for (const { place } of matches) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${place.en || place.n}</strong><span>${place.t || ''}</span>`;
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      hideResults();
      goTo(place.c[0], place.c[1], place.en || place.n, { fly: true });
    });
    list.appendChild(li);
  }
}

function hideResults() {
  $('search-results').hidden = true;
}

// ---------------------------------------------------------------- year + score
let exposureByYear = {};

function shortNum(n) {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(n >= 1000000 ? 1 : 2)} L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

async function loadExposure() {
  try {
    exposureByYear = Object.fromEntries((await (await fetch('data/exposure.json')).json()).years.map((y) => [y.key, y]));
  } catch {
    exposureByYear = {};
  }
}

function updateExposurePanel() {
  const year = state.years[state.yearIndex];
  const y = exposureByYear[year.key];
  $('exposure-year').textContent = year.label.split('—')[0].trim();
  $('expo-people').textContent = y ? shortNum(y.people) : '–';
  $('expo-buildings').textContent = y ? y.buildings.toLocaleString('en-IN') : '–';
  $('expo-roads').textContent = y ? `${y.roadKm.toLocaleString('en-IN')} km` : '–';
  $('expo-cells').textContent = y ? y.cells.toLocaleString('en-IN') : '–';
}

async function selectYear(index) {
  const clamped = Math.max(0, Math.min(state.years.length - 1, index));
  state.yearIndex = clamped;
  const year = state.years[clamped];

  $('year-slider').value = String(clamped);
  for (const button of document.querySelectorAll('#ticks button')) {
    button.classList.toggle('active', Number(button.dataset.index) === clamped);
  }
  $('timeline-year').textContent = year.label.split('—')[0].trim();
  $('timeline-source').textContent = year.source;
  $('score-year').textContent = year.label.split('—')[0].trim();
  $('timeline-receipt').innerHTML = receiptFor(year);

  updateExposurePanel();
  await mapApi.showYear(year.key);
  await mapApi.showMeasured(year.key === 'today');
  await mapApi.refreshRiskGrid({ yearIndex: clamped, wetlands: state.wetlands });
  updateScorePanel();
}

function receiptFor(year) {
  const shown = year.featuresInApp !== year.publishedFeatures
    ? `${year.featuresInApp.toLocaleString()} of ${year.publishedFeatures.toLocaleString()} published polygons (High + Moderate)`
    : year.publishedAreaKm2 > 0
      ? `${year.publishedFeatures.toLocaleString()} published polygons · ${year.publishedAreaKm2} km²`
      : `${year.publishedFeatures.toLocaleString()} published hotspot points`;
  const rain = year.rainfall
    ? `${year.rainfall.role}: ${year.rainfall.totalMm} mm total, wettest day ${year.rainfall.maxDailyMm} mm (${year.rainfall.maxDailyDate})`
    : '';
  return `<span>${shown}</span>${rain ? `<br><span>${rain}</span>` : ''}`;
}

function updateScorePanel() {
  const cell = state.cell;
  const yearIndex = state.yearIndex;
  const options = { wetlands: state.wetlands };

  if (!cell) {
    $('score-number').textContent = '–';
    $('score-label').textContent = 'pick an address';
    $('score-delta').textContent = '';
    resetBars();
    return;
  }

  if (cell.masked) {
    $('score-number').textContent = '—';
    $('score-label').textContent = 'water — not a street address';
    $('score-delta').textContent = 'this cell is sea, river, lake or marsh, so it carries no score';
    $('bar-hazard').style.width = '0%';
    $('bar-ground').style.width = '0%';
    $('bar-built').style.width = '0%';
    $('fact-elev').textContent = cell.elevation === null ? '–' : `${cell.elevation.toFixed(1)} m`;
    $('fact-depth').textContent = '–';
    $('fact-rain').textContent = '–';
    $('wetland-note').hidden = true;
    return;
  }

  const result = score.scoreFor(cell, yearIndex, options);
  const band = score.riskBand(result.value);
  const value = result.value;

  score.animateValue($('score-number'), Number($('score-number').dataset.value || 0), value, {
    duration: 620,
    format: (v) => v.toFixed(1),
  });
  $('score-number').dataset.value = String(value);
  $('score-number').style.color = band.color;
  $('score-label').textContent = band.label;

  const dial = $('dial-value');
  const circumference = 2 * Math.PI * 58;
  dial.style.strokeDasharray = String(circumference);
  dial.style.strokeDashoffset = String(circumference * (1 - Math.min(1, value / 10)));
  dial.style.stroke = band.color;

  const previous = score.previousScore(cell, yearIndex, options);
  if (previous === null) {
    $('score-delta').textContent = 'first year in the record';
  } else {
    const delta = value - previous;
    const arrow = delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '■';
    const prevYear = state.years[yearIndex - 1]?.key ?? 'previous';
    // Name the comparison AND the main driver, so the line answers 'compared to what, and why'.
    const driver = delta > 0.05
      ? (cell.wetland > 0.1 ? 'wetland cover fell' : 'hazard exposure grew')
      : delta < -0.05
        ? (cell.wetland > 0.1 ? 'wetland buffer restored' : 'hazard receded')
        : 'no material change';
    $('score-delta').textContent = `${arrow} ${Math.abs(delta).toFixed(1)} vs ${prevYear} — ${driver}`;
    $('score-delta').style.color = delta > 0.05 ? '#fca5a5' : delta < -0.05 ? '#86efac' : 'var(--muted)';
  }

  const hazardShare = Math.min(1, result.hazard / 0.6);
  setBar('bar-hazard', 'bar-hazard-value', hazardShare, `${Math.round(result.hazard * 100)}%`, '#46c7ff');
  setBar('bar-ground', 'bar-ground-value', Math.max(0, cell.vuln), `${Math.round(Math.max(0, cell.vuln) * 100)}%`, '#fbbf24');
  // A true 0 (no land-use polygon and no footprint in the cell) reads as missing data, so say so.
  if (cell.expo > 0.005) {
    setBar('bar-built', 'bar-built-value', cell.expo, `${Math.round(cell.expo * 100)}%`, '#a78bfa');
  } else {
    setBar('bar-built', 'bar-built-value', 0, 'n/a', 'rgba(122, 162, 220, 0.35)');
  }

  $('fact-elev').textContent = `${cell.elevation.toFixed(1)} m`;
  $('fact-depth').textContent = describeDepth(result.depth);
  $('fact-rain').textContent = cell.rainThreshold === null ? '–' : `≈ ${cell.rainThreshold} mm in a day`;
  $('fact-pop').textContent = cell.pop !== null && cell.pop !== undefined && cell.pop > 0
    ? `≈ ${Math.round(cell.pop).toLocaleString('en-IN')}`
    : (cell.bldc ? 'sparse' : '–');

  const note = $('wetland-note');
  if (state.wetlands && cell.wetland > 0) {
    const before = score.scoreFor(cell, yearIndex, { wetlands: false }).value;
    note.hidden = false;
    note.textContent = `Wetlands within about 400 m absorb ${Math.round(cell.wetland * 100)}% of the local hazard term: ${before.toFixed(1)} → ${value.toFixed(1)}. This is a modelled counterfactual, not a published measurement.`;
  } else if (state.wetlands) {
    note.hidden = false;
    note.textContent = 'No wetland sits within 400 m of this cell, so restoring them would not change its hazard term.';
  } else {
    note.hidden = true;
  }
}

function setBar(barId, valueId, share, label, color) {
  const bar = $(barId);
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
  bar.style.background = color;
  $(valueId).textContent = label;
}

function resetBars() {
  for (const id of ['bar-hazard', 'bar-ground', 'bar-built']) $(id).style.width = '0%';
  for (const id of ['bar-hazard-value', 'bar-ground-value', 'bar-built-value']) $(id).textContent = '–';
  $('fact-elev').textContent = '–';
  $('fact-depth').textContent = '–';
  $('fact-rain').textContent = '–';
  const popEl = $('fact-pop');
  if (popEl) popEl.textContent = '–';
}

function updateRecenter() {
  const wrap = $('recenter');
  if (!wrap) return;
  if (state.lon === null) {
    wrap.hidden = true;
    return;
  }
  const map = mapApi.getMap();
  const bounds = map.getBounds();
  wrap.hidden = bounds.contains([state.lon, state.lat]);
}

// ---------------------------------------------------------------- play
async function togglePlay() {
  const button = $('play');
  if (state.playing) {
    state.playing = false;
    button.classList.remove('playing');
    return;
  }
  state.playing = true;
  button.classList.add('playing');
  if (state.yearIndex >= state.years.length - 1) await selectYear(0);
  if (state.lon !== null) mapApi.flyToAddress(state.lon, state.lat, { zoom: 15.2 });
  for (let index = state.yearIndex; index < state.years.length; index++) {
    if (!state.playing) break;
    await selectYear(index);
    await wait(index === state.years.length - 1 ? 0 : 1750);
  }
  state.playing = false;
  button.classList.remove('playing');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

boot().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<div class="panel" style="position:absolute;left:18px;bottom:18px;z-index:99">Something failed to load: ${error.message}</div>`);
});
