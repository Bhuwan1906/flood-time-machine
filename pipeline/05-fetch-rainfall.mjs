// 05 — Rainfall receipts.
// For every flood year in the slider we record what actually fell, day by day, from Open-Meteo's
// historical reanalysis, plus 1991-2020 normals so the app can say "this street floods when X mm lands".
// This is the panel that turns "trust me" into "here is the number".
import { log, writeJson, loadRegion, round } from './lib.mjs';

const region = loadRegion(process.argv[2]);
const [lon, lat] = region.center;
const UA = { headers: { 'user-agent': 'FloodTimeMachine/1.0 (hackathon pre-bake)' } };

const EVENT_WINDOWS = {
  2005: ['2005-10-15', '2005-11-15', 'Chennai floods, October–November 2005'],
  2015: ['2015-11-15', '2015-12-15', 'Chennai floods, November–December 2015'],
  2020: ['2020-11-15', '2020-12-10', 'Cyclone Nivar, November 2020'],
  2023: ['2023-12-01', '2023-12-12', 'Cyclone Michaung, December 2023'],
};

async function archive(start, end) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${end}&daily=precipitation_sum,rain_sum&timezone=Asia%2FKolkata`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  return res.json();
}

const events = {};
for (const [year, [start, end, label]] of Object.entries(EVENT_WINDOWS)) {
  const data = await archive(start, end);
  const dates = data.daily.time;
  const values = data.daily.precipitation_sum.map((v) => v ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  let maxIdx = 0;
  values.forEach((v, i) => { if (v > values[maxIdx]) maxIdx = i; });
  const ranked = values.map((v, i) => ({ date: dates[i], mm: round(v, 1) })).sort((a, b) => b.mm - a.mm);
  events[year] = {
    label,
    window: { start, end },
    totalMm: round(total, 1),
    maxDailyMm: round(values[maxIdx], 1),
    maxDailyDate: dates[maxIdx],
    wettestDays: ranked.slice(0, 5),
    daily: dates.map((d, i) => ({ d, mm: round(values[i], 1) })),
    elevationM: data.elevation,
    source: 'Open-Meteo historical archive (ERA5 reanalysis)',
  };
  log(`${year}: total ${events[year].totalMm} mm, wettest day ${events[year].maxDailyMm} mm on ${events[year].maxDailyDate}`);
}

// 30 years of daily rain at the same point, for percentiles and heavy-rain frequency.
const normals = await archive('1991-01-01', '2020-12-31');
const vals = normals.daily.precipitation_sum.map((v) => v ?? 0).filter((v) => Number.isFinite(v));
const sorted = [...vals].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const years = 30;
const byYear = {};
normals.daily.time.forEach((t, i) => {
  const y = t.slice(0, 4);
  byYear[y] = Math.max(byYear[y] ?? 0, vals[i]);
});
const annualMax = Object.values(byYear).sort((a, b) => a - b);
const heavy = vals.filter((v) => v > 64.5).length / years; // IMD "heavy"
const veryHeavy = vals.filter((v) => v > 115.6).length / years; // IMD "very heavy"
const extreme = vals.filter((v) => v > 204.5).length / years; // IMD "extremely heavy"

const stats = {
  station: { lon, lat, elevationM: normals.elevation, timezone: 'Asia/Kolkata' },
  period: { start: '1991-01-01', end: '2020-12-31', years },
  dailyMeanMm: round(vals.reduce((a, b) => a + b, 0) / years / 365, 2),
  p95: round(pct(95), 1),
  p99: round(pct(99), 1),
  p999: round(pct(99.9), 1),
  annualMaxMedian: round(annualMax[Math.floor(annualMax.length / 2)], 1),
  heavyDaysPerYear: round(heavy, 2),
  veryHeavyDaysPerYear: round(veryHeavy, 2),
  extremelyHeavyDaysPerYear: round(extreme, 3),
  thresholds: { heavy: 64.5, veryHeavy: 115.6, extremelyHeavy: 204.5, note: 'IMD daily rainfall categories' },
  source: 'Open-Meteo historical archive (ERA5), 1991-2020',
};
log(`normals: p99 ${stats.p99} mm/day, median annual max ${stats.annualMaxMedian} mm, ${stats.heavyDaysPerYear} heavy days/year`);

writeJson('data/receipts.json', {
  region: region.id,
  generated: new Date().toISOString(),
  normals: stats,
  events,
  citations: {
    '2015 footprint': 'NRSC flood inundation zone, via opencity.in (public domain)',
    '2005 footprint': 'GCC flood extent 2005, via opencity.in (public domain)',
    '2020 hotspots': 'GCC hotspots from Cyclone Nivar 2020, via opencity.in (public domain)',
    '2070 projection': 'GCC flood flow corridors, 200-year return period, via opencity.in (public domain)',
    'ground elevation': 'AWS Open Data Terrain Tiles (Terrarium)',
    'buildings and roads': 'OpenStreetMap contributors (ODbL), tiles by Protomaps',
    wards: 'datameet Municipal Spatial Data (CC-BY)',
    rainfall: 'Open-Meteo historical archive (ERA5 reanalysis)',
  },
}, true);
log('receipts written -> data/receipts.json');
