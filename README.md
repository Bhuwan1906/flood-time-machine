# Flood Time Machine

**Type any Chennai address. Drag a time slider from 2005 to 2070. Watch that one street's flood risk change.**

Built for **GEO IMPATHON 1.0** at SRMIST, Chennai — domain: **Disaster Risk Analysis**.

Live: _<add the deployed URL here>_ · Video: _<add the YouTube link here>_

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
index.html      the whole UI: map, search, score dial, timeline, toggles
app.js          orchestration — state, address search, year timeline, score panel, keyboard
map.js          MapLibre setup: offline basemap, terrain, flood layers, the risk grid
score.js        score lookups: address -> 100 m cell -> baked numbers, plus the wetland counterfactual
three-d.js      the 3D view: terrain exaggeration, building massing, rising water
style.css       the instrument-panel look
server.mjs      a ~120-line static server so the folder runs with no internet and no dependencies
start.bat       double-click launcher for the Windows demo laptop
data/           everything pre-baked: basemap, terrain, scores, flood records, fonts, libraries
pipeline/       the seven Node scripts that built data/ (run before the event, never during)
demo/           the live script, the slides, the video shot list
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

## The data

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
npm run verify             # 08 Pre-demo check: is every lookup going to succeed?
```

`npm run verify` is the one to run before you demo. It confirms the data is complete and parseable,
that all three demo stops resolve to real scored cells, and that nothing the app fetches is missing.

Payload after a full build: **~90 MB** (basemap 31 MB, terrain 36 MB, scores 14 MB, flood layers 6 MB,
fonts and libraries 3 MB). Raw downloads live in `.cache/` and are not committed.

## Known limits

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
