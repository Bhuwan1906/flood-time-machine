# Slides — Flood Time Machine

Five slides. No more. The judges spend their attention on the app, not on the deck, so every slide
either sets up a click or answers the question they were about to ask.

---

## Slide 1 — Title

**Flood Time Machine**
`Teen Titans`

**Your street. Its flood risk. 2005 → 2070.**

Domain: Disaster Risk Analysis · GEO IMPATHON 1.0 · SRMIST Chennai

Bottom edge, small: **QR code → live app** (and the URL in text underneath, in case the QR fails).

---

## Slide 2 — The problem, in one line

> **Chennai floods. Nobody can tell you what that means for one address.**

Under it, three short lines:

- District-level flood maps exist. Decisions don't happen at district level — they happen at one door.
- Insurers, banks and homebuyers price per property. Nobody has a per-property number.
- Every existing tool needs a live internet connection. Floods take the internet down first.

---

## Slide 3 — What it is

> **Type an address. Drag the years. Watch your own street's risk change.**

Five dated records on the slider, each with its source on screen:

| Year | Published record | Coverage |
|---|---|---|
| 2005 | GCC flood extent | 235 polygons · 239 km² |
| 2015 | **NRSC satellite** inundation mapping | 3,733 polygons · 255 km² |
| 2020 | Cyclone Nivar hotspots (GCC) | 53 points |
| Today | GCC flood hazard zoning | 2,254 polygons · 71 km² |
| 2070 | GCC 200-year flood corridors | 383 corridors · 286 km² |

**Screenshot of the app with the score dial visible** — take it from the live site, not a mockup.

---

## Slide 4 — How the score is built

> **Every 100 m cell, scored before you click.**

```
score = 10 × ( 0.40 × modelled depth        ← published zones + terrain hollows
             + 0.20 × past flood history    ← how many of the three records hit this cell
             + 0.30 × low ground            ← 1.0 at ≤ 2 m, 0 at ≥ 20 m
             + 0.10 × built-up share )      ← land use + measured building footprints
```

Three lines underneath:

- Ground truth: satellite flood extents, city zoning, radar elevation, OpenStreetMap footprints.
- No model training, no AI guessing — a written formula and inspectable files.
- **Works offline by design.** When the city floods, the towers go down.

---

## Slide 5 — Why this is a company, and what we refuse to fake

Left column — **the business** — three bullets:

- Insurers, lenders and homebuyers pay per address. So does every city in India.
- New city = one config entry and a data run, not a rewrite.
- First Street did this for one country and one hazard and became the reference provider. Depth beats
  breadth.

Right column — **what we refuse to fake** — three bullets:

- Chennai has almost no surveyed building heights, so our 3D buildings are labelled massing, not measured.
- One published record has no event date, so it is evidence, never a timeline year.
- We show each agency's own extent even when they disagree — the coverage counts are on screen.

Bottom line, large:

> **A score you can argue with, because you can see where every number came from.**
