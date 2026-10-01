# 04 — KEY NUMBERS (verified — say them with confidence)

## Scores (0–10, higher = more risk)

| Stop | 2005 | 2015 | 2020 | Today | 2070 |
|---|---|---|---|---|---|
| Velachery (Sadasiva Nagar) | 7.2 | 8.2 | 4.5 | **8.5** | 8.5 |
| Taramani (by the marsh) | 2.9 | 2.9 | 2.9 | 5.6 | 6.9 |
| SRM Kattankulathur (35 m) | 0.7 | 5.1 | 1.4 | **1.4** | 1.4 |

Wetlands counterfactual: Taramani **5.6 → 4.7**. Worst cell citywide: **9.1**.
Velachery facts: ground 2.3 m · today's water 1.60 m ("above waist") · floods at ≈26 mm/day · ~80
residents on the cell.

## Flood-layer receipts (features published → shown in app)

2005: GCC extent, 239 km² · 2015: NRSC satellite, **3,733 polygons**, 255 km² · 2020: Nivar
hotspots, 53 points (sparse record — we show it honestly) · Today: GCC High+Moderate, **2,254 of
7,360 polygons** · 2070: GCC 200-yr corridors, 286 km².

## Rainfall receipts (ERA5)

2005: 521.7 mm · 2015: 485.4 mm · 2020: 438.6 mm · today's design storm = Michaung **379.2 mm**
(wettest day 255.8 mm, 2023-12-04).

## Exposure (≥15 cm water; severe = ≥60 cm)

| Year | People | Buildings | Roads | Critical sites |
|---|---|---|---|---|
| 2015 | **~7.4 lakh** | 91,888 | 3,019 km | 590 |
| Today | ~14.8 lakh (in hazard zones) | — | — | **1,111 (586 in ≥60 cm)** |
| 2070 | ~12.4 lakh | — | **4,325 km** | 932 |

Land use in today's water: **12.4 km² residential · 5.7 commercial · 22.0 industrial.**
Worst ward today: **#86 Ambattur, ~25,600 people.** Full 201-ward ranked table downloads as CSV.

## Multi-hazard (PS 1.1)

MCDM = weighted linear combination: **0.45 flood · 0.30 waterlogging · 0.15 landslide · 0.10
exposure.** Weights fixed a priori by expert judgement; **top-100 ranking stable under ±20%
weight perturbation (100% overlap, 3,000 cells sampled).** Landslide: 0 below 3°, 100 above 15°;
max slope in the city **28.9°**; only **St. Thomas Mount & Guindy ridge** are real — ~98% of cells
zero, said on screen. Combined-index counts today: 43,106 moderate + 733 high cells.

## Routes (PS 1.1)

Graph: **101,150 junctions · ~199,000 edge pairs** from the same offline tiles.
Destinations: **1,845 hospitals/clinics · 1,076 shelters** (schools & community halls).
Origins: **Velachery · Taramani · Ambattur (worst ward #86)**. Cost = km × (1 + 2·risk + 3·severe[≥0.6 m]). Baked per origin × role × year; Dijkstra, fully offline.

**The receipt to lead with (Velachery → shelter, today):**
shortest = 1.1 km to King's Matric Hr Sec School, **0.4 km of it in ≥0.6 m water**;
least-risk = 1.4 km to BrightPath Play School, **0 km in ≥0.6 m water.**
Also today: Taramani → hospital 1.5 km (0.5 severe) vs 1.7 km (0.2 severe) ·
Taramani → shelter 0.7 km (0.4 severe) vs 0.8 km (0.1 severe) ·
Velachery → hospital 0.5/0.5 severe vs 0.5/0.2 severe ·
**Ambattur → hospital 1.8 km with 0.6 km severe vs same 1.8 km with 0.2 km severe** (equal distance, 67% less waist-deep water).
Shortest-route city totals per year (the case for least-risk): 2005: 0.3 km severe ·
2015: 1.2 km · today: **1.8 km in ≥0.6 m water** · 2070: 1.7 km.

## Engineering

Payload **92.9 MB** fully offline (basemap 31.4 · terrain 36.2 · score grid 16.5 · flood 5.8 ·
fonts 1.8 · vendor 1.1). 207,291 scored cells across 475 tiles (~100 m grid). Zero runtime
dependencies — MapLibre + PMTiles vendored. 38 automated verify checks, all passing.
