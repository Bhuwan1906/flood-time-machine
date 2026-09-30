# FLOOD TIME MACHINE — JUDGE CARD (print this page)

**Team: Teen Titans** · Domain: Disaster Risk Analysis · The live app runs offline — nothing to type, nothing to load.

---

## THE ONE-LINER

**"Type any Chennai address, slide through 20 years of flood records, and see your street's risk — then restore the wetlands and watch it fall."**

---

## THE SCORE (0–10 · higher = MORE risk)

```
score = 10 × ( 0.40 × FLOOD HAZARD   ← published record puts water here, this year
             + 0.30 × LOW GROUND     ← real satellite elevation (≤2 m = max, ≥20 m = 0)
             + 0.20 × FLOOD HISTORY  ← how often past records hit this cell
             + 0.10 × BUILT-UP )     ← OSM land use + measured building footprints
```

No ML anywhere. Every cell's score is explainable in 30 seconds. Weights live in `data/score/index.json`.

**2070** = GCC's own 200-yr flow corridors + 2015's measured rain replayed as a design storm. *Their projection, our stress test.*
**2005** = GCC's recorded flood extent replayed on today's terrain. *Real water, coarse map — tagged "est."*

---

## THE FIVE STOPS (verified numbers — say them with confidence)

| Stop | What it shows | Velachery score | Say this |
|---|---|---|---|
| **2005** `est.` | GCC flood extent, 239 km² | 7.2 | "The Corporation's own map from that monsoon." |
| **2015** | NRSC satellite inundation, 3,733 polys | 8.2 | "The worst flood in a century, measured from space." |
| **2020** | Cyclone Nivar hotspots | 4.5 | "A cleaner decade — the score honestly falls." |
| **Today** | GCC hazard zoning (High+Mod) | 8.5 | "This street floods in every recorded event." |
| **2070** `est.` | 200-yr corridors, 286 km² | 8.5 | "Already in the worst corridor — the map adds nothing here." |

**Other proven numbers:** Taramani 5.6 → **4.7** with wetlands · SRM campus **1.4** at 35 m (the control) · worst cell citywide **9.1** · depth "1.60 m — above waist" · rainfall receipts per stop (2005: 521.7 mm · 2015: 485.4 mm · 2020: 438.6 mm · today's design storm: Michaung 379.2 mm, 255.8 mm worst day).

---

## TOP 10 JUDGE ANSWERS (one breath each)

1. **"Why not use GCC data directly?"** → They published data, not answers. 7,360 polygons in a KML is not something a parent in Velachery can use. Type the address, get the verdict in 10 seconds — offline.

2. **"How does 2070 work?"** → We don't predict. GCC's own 200-year corridors + 2015's measured rain as a design storm. The projection is theirs, the math is transparent, it's tagged est.

3. **"Is this AI?"** → No, deliberately. Transparent arithmetic on published data. A flood tool nobody can audit is a liability.

4. **"What if the internet dies?"** → It never needs it. 90 MB — tiles, terrain, data — one folder, any laptop. When a city floods, towers go down. That's why it's built this way.

5. **"Weaknesses?"** → Four, all in the README: ERA5 smooths 2015's extreme rain; depths are modelled; the wetland toggle is an illustration; past years use today's buildings. A tool that hides limits is dangerous.

6. **"Why these weights?"** → Hazard 40% because records are the strongest evidence; low ground 30% because gravity doesn't negotiate; history 20% because streets that flooded twice flood again; built-up 10% worsens consequences, doesn't cause floods.

7. **"Depth says waist-deep — measured?"** → Modelled: flood zone + terrain-hollow term. 192 real measured points exist and are shown on Today, but per-cell depth is modelled and labelled.

8. **"Only Chennai?"** → The city is one entry in regions.json. Swap flood datasets, re-run the pipeline, ship Mumbai. The engine is city-agnostic.

9. **"Wetlands toggle — real?"** → It's a planning illustration, labelled on screen: cells within 400 m of a marsh get 35–8% hazard discount in four rings. That's what a wetland physically does — absorb and slow.

10. **"Who is it for?"** → Residents, journalists, ward officers — anyone who needs their street's risk in 10 seconds. Public data, MIT license; if GCC built this themselves, we'd have won.

---

## EMERGENCY LINES

- App frozen? → Press **R** (recenter) or reload — state is in the URL-free app, nothing is lost.
- Judge pushes on a number? → "Let me open the receipts for that year" — click the footer line, show the count.
- Lost for words? → **"Same street, same rain, less risk — that's the cheapest flood defence a city can buy."**
- Time cut to 2 min? → Skip to **Stop 3.5**: 2070 + Taramani + Restore wetlands, let the dial fall. That's the differentiator.

---

*Sources: GCC & NRSC via opencity.in (public domain) · AWS Terrain Tiles · OpenStreetMap (ODbL) · Open-Meteo ERA5 · Protomaps · datameet wards. Depths modelled; wetland effect is a planning illustration; every number's receipt is shown in-app.*
