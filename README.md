# Flood Time Machine

**Type any Chennai address. Drag a time slider from 2005 to 2070. Watch that one street's flood risk change — and when the water comes, take the least-risk route to shelter, not the shortest one.**

Built for **GEO IMPATHON 1.0** at SRMIST, Chennai — domain: **Disaster Risk Analysis**. Final-round
problem statement 1.1: *multi-hazard geospatial decision support + least-risk emergency routes.*
This repo answers it end to end (see [Multi-hazard and emergency routes](#multi-hazard-and-emergency-routes-ps-11)).

Live: **https://flood-time-machine.pages.dev** · Video: _<add the YouTube link here>_

---

## What it does

1. You type an area, or tap the map, and the pin lands on **your** street.
2. You get one number out of ten — a per-address flood risk score, where higher means higher flood risk (0 safe, 10 extreme).
3. The slider moves through the years that actually have published flood records for Chennai:
   **2005 · 2015 · 2020 · Today · 2070**.
4. Every year carries its receipts: which agency published it, how many polygons, how many square
   kilometres, and what the rain did in those days.
5. Press **3D** and the same map tips over: real satellite terrain, and the water is raised to each
   cell's modelled depth.
6. Flip **Restore wetlands** and the hazard term drops where marshland sat within 400 m of the pin.
7. Switch hazard layers in the legend — **Flood · Waterlogging · Landslide · MCDM** — each labelled
   separately, then combined.
8. Open **Emergency routes** and pick an origin and a destination type: the map draws the plain
   shortest route and the least-risk route to the nearest hospital or relief shelter, re-priced for
   whichever year is on the slider.

Nothing is guessed by a language model. Every number traces back to a published dataset, and the whole
thing runs with the wifi switched off.

## Why it is built this way

Most flood maps tell you a district is risky. That is useless to anybody actually deciding something —
an insurer pricing a policy, a bank underwriting a home loan, a family choosing a street. Decisions
happen at one address, so the unit of this product is one address.

Three deliberate choices follow from that:

- **Depth over breadth.** One city, scored properly, at ~100 m resolution, with the published record
  behind every cell. Chennai is the pilot, not the ceiling — see [_Scale_](#scale-beyond-chennai).
- **Offline as a feature, not a limitation.** When a city floods, the cell towers go down. A disaster
  tool that needs a live API is a tool that fails exactly when it is needed. Every tile, every terrain
  height, every score and every flood record ships in this folder.
- **Refuse to invent.** Where the data does not exist, the app says so instead of filling the gap. See
  [_What we deliberately did not do_](#what-we-deliberately-did-not-do).

## How it works

A 100% static web app. No backend, no database, no accounts, no API keys, and no computation at demo
time — every click is a file lookup.

```
index.html      the whole UI: map, search, score dial, routes panel, hazard-layer tabs, timeline
app.js          orchestration — state, address search, year timeline, score panel, routes, keyboard
map.js          MapLibre setup: offline basemap, terrain, flood layers, risk grid, route lines
score.js        score lookups: address -> 100 m cell -> baked numbers, plus the wetland counterfactual
three-d.js      the 3D view: terrain exaggeration, building massing, rising water
style.css       the instrument-panel look
server.mjs      a ~120-line static server so the folder runs with no internet and no dependencies
start.bat       double-click launcher for the Windows demo laptop
data/           everything pre-baked: basemap, terrain, scores, flood records, routes, fonts, libs
pipeline/       the fourteen Node scripts that built data/ (run before the event, never during)
demo/           the live script, the judge card, and the printable presentation pack (demo/present/)
```

One renderer does both 2D and 3D: the 3D view is the same map, tilted, with terrain switched on and
the score grid extruded to water depth. There is no separate 3D scene to keep in sync.

### The score grid (the core idea)

Every ~100 m cell over Chennai is scored **before** anybody clicks, and the results are stored as one
small JSON file per map tile (`data/score/14/{x}/{y}.json`). That is what makes the demo instant: the
app fetches the handful of tiles around the pin and reads numbers.

```
score = 10 × ( 0.40 × modelled depth         // how deep the published records put water here
             + 0.20 × past flood history     // how many of the three historical records hit this cell
             + 0.30 × low ground             // 1.0 at or below 2 m, 0 at or above 20 m
             + 0.10 × built-up share )       // land use and measured building footprints
```

Each cell also stores the two hazard terms separately, which is what lets the browser recompute a
score instantly when you flip the wetlands toggle — the counterfactual never needed a server.

### Exposure statistics (challenge 4.4)

The brief for Disaster Risk Analysis asks what a hazard means for settlements, roads and
infrastructure. Each cell therefore also carries three baked fields: an estimated resident
population, a building count and the metres of mapped road inside it. `pipeline/11-exposure.mjs`
turns those into `data/exposure.json` — for every year on the slider, how many people, buildings
and kilometres of road sit in modelled water (≥ 15 cm = affected, ≥ 60 cm = severe/waist-deep).
The panel on the right of the app re-counts as you drag the years; the score panel shows the
residents on the selected street.

Population is a **model, and it says so**: India publishes no street-level population raster, so
residents are estimated from measured OpenStreetMap building footprints at a Census-anchored
occupancy — one household per ~85 m² of footprint, 3.51 persons per household (Census 2011 Tamil
Nadu average). Published gridded-population rasters (WorldPop, GHSL) were considered and rejected:
at their resolution a single cell swallows several city blocks, which is exactly the district-level
blur this product exists to remove. The estimate is credited in the footer as a gridded estimate,
not a census. Citywide it lands at ≈ 33 lakh people and ≈ 3.8 lakh buildings across the scored
cells, which sanity-checks against Chennai's population.

Each cell also counts its **critical facilities** — hospitals, clinics, schools, colleges,
universities, kindergartens, police stations, fire stations, relief shelters and community centres
(2,715 across the region, from the OSM `pois` layer). The exposure panel reports how many sit in
each year's water, alongside the severe (≥ 60 cm) tier: today that is **1,111 critical sites in
the city's own hazard zones, 586 of them in waist-deep water or deeper.**

The brief's land-use input appears in the output too: built-up land in each year's water is split
**residential / commercial / industrial** (today: 12.4 / 5.7 / 22.0 km²), and the exposure is
joined to the 201 ward polygons (`pipeline/12-wards.mjs`) for a ranked ward table — worst ward
today is #86 Ambattur at ~25,600 exposed residents — downloadable as **CSV** straight from the
panel. That file is the deliverable form of "affected infrastructure statistics": a ward officer
or an insurer can open it in a spreadsheet, offline, today.

## Multi-hazard and emergency routes (PS 1.1)

### The MCDM index, stated openly

The per-address score above is itself a weighted linear combination — the classic MCDM workhorse —
and the app labels it as such. The combined multi-hazard index adds the PS's second hazard and
weights consequence:

```
MH = 10 × ( 0.45 × flood hazard          // the published-record term, per year
          + 0.30 × waterlogging          // low ground that cannot drain (the terrain term, on its own)
          + 0.15 × landslide             // DEM-slope susceptibility: 0 below 3°, 100 above 15°
          + 0.10 × built exposure )      // land use + measured footprints
```

Weights are fixed a priori by expert judgement and printed on screen and in `data/multihazard.json`.
We also tested them: perturbing every weight by ±20% leaves the top-100 risk ranking **100%
intact** (3,000 sampled cells). The conclusion does not depend on the exact weights.

Landslide susceptibility comes from Zevenbergen–Thorne slope on the baked elevation grid
(`pipeline/13-multihazard.mjs`, field `LH` in every score tile). Chennai is a coastal plain, so the
layer reads near-zero — ~98% of cells — and the app says so, naming St. Thomas Mount and the Guindy
ridge as the only real slopes. A near-empty layer that is honestly explained is a finding; the same
pipeline re-targets to a hilly city unchanged.

### The least-risk route engine

`pipeline/14-route-graph.mjs` builds a routable road graph — **101,150 junctions, ~199,000 edge
pairs** — from the same offline z15 tiles the map already serves, and prices every street edge with
its per-year flood risk:

```
edge cost = km × ( 1 + 2 × risk + 3 × severe )     // severe = modelled depth ≥ 0.6 m (waist-deep)
```

Dijkstra then runs twice per origin — once for plain distance, once for least risk — to the nearest
destinations of each type: **1,845 hospitals/clinics** and **1,076 relief shelters** (schools,
colleges and community halls — how Chennai actually shelters). Origin neighbourhoods are the
worst-exposed flood bowls (Velachery, Taramani, Ambattur); adding one is a one-line change and a
9-second re-bake, fully offline. Route pairs are baked for every year on the slider, so sliding from
2015 to today re-prices every street on screen.

The receipts, today, from Velachery: the **shortest** route to the nearest shelter (King's Matric
Hr Sec School, 1.1 km) wades **0.4 km of waist-deep water**; the **least-risk** route (1.4 km to
BrightPath Play School) wades **none**. Shortest is not safest — the map proves it street by street.

### Route and hazard data files

| File | Contents |
|---|---|
| `data/routes/routes.json` | baked route pairs (origin × role × year × mode), with per-edge depth/risk |
| `data/routes/graph-meta.json` | graph stats: nodes, edges, hospital/shelter counts |
| `data/multihazard.json` | MCDM weights, justification, sensitivity note, per-year class counts |

| Layer | Source | What ships |
|---|---|---|
| 2005 flood extent | Greater Chennai Corporation, via opencity.in | 235 published polygons, 239 km² |
| 2015 flood inundation | **NRSC** satellite mapping, via opencity.in | 3,733 published polygons, 255 km² |
| 2020 Cyclone Nivar | Greater Chennai Corporation, via opencity.in | 53 published hotspot points |
| Today's zoning | GCC flood hazard zoning, via opencity.in | 2,254 of 7,360 polygons (High + Moderate), 71 km² |
| 2070 projection | GCC 200-year return-period flow corridors, via opencity.in | 383 corridors, 286 km² |
| Measured depths | GCC inundation points (depth in inches), via opencity.in | 192 points, up to 60 in |
| Ground elevation | AWS Open Data Terrain Tiles (Terrarium) | 771 tiles, z11–z15 |
| Buildings, roads, land use, place names | OpenStreetMap contributors | via Protomaps vector tiles + Overpass |
| Rainfall | Open-Meteo historical archive (ERA5) | 1991–2020 normals plus every event window |
| Ward boundaries | datameet Municipal Spatial Data (CC-BY) | 201 wards, for reference |

Licences: opencity.in datasets are **public domain**; OpenStreetMap and Protomaps data are **ODbL**;
datameet is **CC-BY**; AWS Terrain Tiles and Open-Meteo are free open data. Full attribution is shown
in the app footer and listed in `data/manifest.json`.

Every number quoted in the timeline panel is lifted straight from the published record by
`pipeline/07-bundle.mjs` — the feature counts, the published areas and the rainfall are never typed
in by hand.

## What we deliberately did not do

These are choices, not gaps:

- **No invented building heights.** OpenStreetMap publishes a height for a tiny minority of Chennai's
  buildings (we measured ~1% in a sample). The 3D view uses the published height where it exists and a
  flat massing everywhere else, labelled as such. A pretty skyline would have been a lie.
- **No pretend census.** Per-cell population is a footprint-times-occupancy estimate (Census-anchored,
  labelled in the app). It is built for comparison across years and streets, not for counting heads
  at one door.
- **No fake events.** The published measured-depth layer carries no event date, so it is shown as
  evidence of depth, never as a timeline stop. The five stops are all dated, sourced records.
- **No inflated coverage.** GCC published only 53 hotspot points for Cyclone Nivar, so 2020 looks
  sparse. That is the published record; the app says so rather than smoothing it into a nice shape.
- **No machine learning.** There is no trained model to distrust. The formula is written out above.
- **No national-scale hand-waving.** Coarse country-level flood maps already exist and are free. This
  product competes on per-address accuracy, which is a data problem, not a modelling one.
- **No rainfall "what-if" slider.** The 3D water already answers "how deep does it get", and every hour
  of build time came out of rehearsal.

## Scale beyond Chennai

The pipeline is parameterised by `data/regions.json` — a name, a bounding box, a hazard layer path and
a handful of tuning constants. Nothing in the app is Chennai-specific: adding a second city means
adding an entry and re-running the seven scripts.

```bash
node pipeline/01-fetch-basemap.mjs <region>
node pipeline/02-fetch-terrain.mjs <region>
# ... etc
```

The real constraint is not code, it is receipts. Most Indian cities have no public street-level flood
depth record at all, which is why the defensible position in this market is data partnerships — the
same route First Street took in the US with a single country and a single hazard.

## Run it

**On the demo laptop (offline, recommended):** double-click **`start.bat`**, or:

```bash
node server.mjs --open
```

It serves <http://localhost:8123/> and opens the browser. `node_modules` is not needed to run the app —
only MapLibre and PMTiles are vendored into `data/vendor/`.

**Hosted:** the folder is deployable as-is to any static host (Cloudflare Pages, Netlify, GitHub
Pages). Paths are all relative, so it works from a subdirectory without changes.

> Opening `index.html` directly from disk will not work: browsers block ES modules and data fetches on
> the `file://` protocol. That is what `server.mjs` and `start.bat` are for.

## Rebuild the data

Requires Node 18+ (developed on Node 24). No Python, no GDAL, no build step.

```bash
npm install                # pmtiles, @protomaps/basemaps, @mapbox/vector-tile, pbf (pipeline only)

npm run fetch:basemap      # 01 Vector tiles for the region + vendored MapLibre, fonts, sprites, styles
npm run fetch:terrain      # 02 AWS Terrarium elevation, full city + extra detail at the demo stops
npm run fetch:flood        # 03 Every Chennai flood layer on opencity.in, KML -> clipped GeoJSON
npm run fetch:places       # 04 Wards, wetlands, offline place-name search index
npm run fetch:rainfall     # 05 Event rainfall + 1991-2020 normals from Open-Meteo
npm run build:score        # 06 THE BRAIN: bake the per-cell, per-year score grid
npm run build:all          # 07 Promote the year layers, write receipts, manifest, integrity check
node pipeline/10-population.mjs   # 10 Residents, buildings, road metres per cell (challenge 4.4)
node pipeline/11-exposure.mjs     # 11 Per-year citywide exposure statistics -> data/exposure.json
npm run build:multihazard # 13 Landslide susceptibility field + MCDM metadata (PS 1.1)
npm run build:routes      # 14 Road graph + least-risk vs shortest route pairs (PS 1.1)
npm run verify            # 08 Pre-demo check: is every lookup going to succeed? (38 checks)
```

`npm run verify` is the one to run before you demo. It confirms the data is complete and parseable,
that all three demo stops resolve to real scored cells, and that nothing the app fetches is missing.

Payload after a full build: **~90 MB** (basemap 31 MB, terrain 36 MB, scores 14 MB, flood layers 6 MB,
fonts and libraries 3 MB). Raw downloads live in `.cache/` and are not committed.

## Known limits

- Route pairs are pre-baked from the configured origin neighbourhoods (any origin is a one-line
  change plus a 9-second offline re-bake, but the shipped data covers the baked set).
- Route edge risk samples the packed grid at each segment's midpoint; a ~50 m segment inherits one
  cell's depth. Refinement would interpolate along the segment.

- The 2015 rainfall figure comes from gridded reanalysis, which under-reports local extremes: real
  gauge records for 1 December 2015 are higher than the ~116 mm/day in this dataset. The app labels
  the source for exactly this reason.
- Depths are **modelled** from published zones plus a terrain hollow term, and measured points override
  them where GCC published a measurement. Only the measured points are direct observations.
- The wetland counterfactual applies a modelled attenuation by distance (35% at the marsh, decaying
  over four ~100 m rings). It is a planning illustration, not a hydrological simulation.
- Different agencies drew different extents for the same city. A street can appear in the 2005 extent
  and not in the 2015 satellite footprint. We show what each agency published instead of harmonising
  them into one tidy story.

## Team and event

GEO IMPATHON 1.0, SRMIST Chennai · 30 September – 1 October 2026 · Domain: Disaster Risk Analysis.
Team name: _Teen Titans_.

Code: MIT (see `LICENSE`). Data: as listed above, each under its own licence.

Built with MapLibre GL JS, Protomaps basemap tiles, AWS Terrain Tiles, Open-Meteo, datameet and the
Chennai open data portal. Not affiliated with any of them.
