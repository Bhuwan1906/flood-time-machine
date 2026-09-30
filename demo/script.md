# Live demo script — Flood Time Machine

Two roles. **Driver** reads the bold lines and does the click. **Slide person** watches the clock
(90 seconds per stop, 5 minutes total) and holds the Q&A sheet.

Say the words in bold out loud. Everything else is instruction for you, not for the judges.

---

## Before the judges arrive (5 minutes)

1. Double-click `start.bat`. The browser opens on its own.
2. Check the three buttons appear at the top left: **Velachery · Taramani · SRM Kattankulathur**.
3. Click Velachery, then click through 2005 → 2015 → 2020 → Today → 2070 once. This warms the caches,
   so nothing pauses in front of the judges.
4. Turn wifi **off**. Confirm the map still works. Leave it off for the demo if the venue wifi is bad
   — that is a feature, and you get to say so.
5. Leave the app on **Today** and on the **Velachery** stop.
6. Have the QR code, the hosted URL and the backup video ready on the slide laptop.

---

## Stop 1 — the hook (0:00–1:00) · Velachery

> **"Chennai floods. Everyone knows that. But nobody can tell you what your own street's risk is —
> so we built it. This is the Flood Time Machine."**

Click **Velachery**.

> **"This address is in Sadashiva Nagar, in the Velachery belt. It scores 8.5 out of 10 today.
> Extreme."**

Point at the dial, then at the receipt line under the timeline.

> **"Everything here is a published record. That number is built from the 2015 satellite flood
> mapping by NRSC, the city's own hazard zoning, real elevation from satellite terrain, and
> OpenStreetMap building data. No AI guessed this."**

## Stop 2 — the time machine (1:00–2:30) · still Velachery

Press **Play**. Let it run through all five years without talking. Then:

> **"Watch the same street move through time. 2005, 2015, 2020, today, and 2070. The score changes
> because the water changes."**

Click back to **2015**.

> **"This is the year everyone remembers. This is the satellite footprint of the water — 3,733
> polygons, 255 square kilometres. Our street is inside it."**

Click **2070**.

> **"And this is the 200-year flood corridor the city has already mapped. Water where it is flat."**

## Stop 3 — the gasp (2:30–3:30) · still Velachery

> **"Now the part that makes this feel real."**

Press **3D**.

> **"Real satellite terrain. Watch what happens to the water."**

Wait two beats while it tilts and the water rises.

> **"Every block you see is that cell's actual depth, exaggerated three times, because Chennai is
> almost flat. And if you are wondering about the buildings — those are real footprints from
> OpenStreetMap. Where a height is published we use it. Where it is not, we show a flat massing and
> we say so on screen. We could have drawn a beautiful skyline. It would have been fake, and this is
> an insurance product."**

Press **3D** again to come back.

## Stop 3.5 — lead with the toggle if time is short

If you only get 3 minutes: cut Stops 1–2 to one line each and spend the saved time here. Move the
slider to **2070**, click **Taramani**, then hit **Restore wetlands** and let the dial fall. The
wetlands what-if is the differentiator — it is the one thing no other team will show. Say why the
number drops: "the score falls because the cells next to the marsh get their hazard term back in
the model — that is what a restored wetland physically does."
## Stop 4 — the greener earth (3:30–4:15) · Taramani

Click **Taramani**.

> **"Five-six today. Now — this street sits right next to the Pallikaranai marsh. The marsh is what
> used to absorb this water."**

Press **Restore wetlands**.

> **"When we put the wetlands back, the hazard term drops. Five point six becomes four point seven.
> Same street, same rain, less risk. That is the cheapest flood defence a city can buy — and it is
> already gone in a lot of places."**

## Stop 5 — the honest close (4:15–5:00) · SRM

Click **SRM Kattankulathur**.

> **"Our own campus. 35 metres above sea level. One point four, even in 2070. The machine also tells
> you where NOT to worry — that is what makes the other numbers believable."**

Point at the exposure panel (right side).

> **"And every year comes with its count. In 2015's water: seven-point-four lakh people, ninety-two
> thousand buildings, three thousand kilometres of road. That is the challenge brief's question —
> not just how deep, but what and who is exposed."**

> **"It runs with no internet, on a laptop, from a folder. That is deliberate: when your city floods,
> the towers go down. Thank you."**

---

## Q&A — the five questions judges actually ask

**"How do you know the depth is right?"**
We don't claim it is measured. Depth is modelled from published zones plus terrain: water pools where
ground sits below its surroundings. Where the city published an actual measured depth in inches — 192
points — we let the measurement override our model. The panel says which is which.

**"Why only Chennai?"**
Because per-address accuracy needs street-level receipts, and Chennai is where they are published.
The pipeline is driven by one region config file: adding a city is a bounding box and a re-run. The
real bottleneck is data partnerships, not code — that is the moat.

**"What about the years that look less severe?"**
Different agencies drew different extents. The 2020 layer is only 53 hotspot points, because that is
all the city published for Cyclone Nivar. We show the published record rather than smoothing it into
a tidy trend, and the feature count is on screen for exactly that reason.

**"Is this just ChatGPT with a map?"**
No model. The score is a written formula — 40% modelled depth, 20% flood history, 30% low ground, 10%
built-up share — and every input is a file you can inspect. The repo has the dataset URL and the
published feature count for every layer.

**"Could a flood risk company use this?"**
That is the business case. Insurers and lenders price per property. This gives a per-address score, a
depth, a rainfall threshold and the evidence behind all three — and it works offline, which matters
when the event you are pricing is happening outside.

**"What would you do next?"**
Three things: add the second city where a partner will share depth records, drive the score grid from
observed depths instead of zones, and ship a small API so an insurer can pull a score for a policy
address. The engine already exists; v1 is a config change plus data.

---

## If something breaks

1. **Map is blank** → check the batch window is still open; if closed, run `start.bat` again.
2. **Score shows a dash** → you tapped water. Tap a nearby street.
3. **App will not load at all** → switch to the hosted URL. If hosting is down too, play the backup
   video and narrate over it. Never debug in front of judges.
4. **Projector resolution is low** → the layout stacks for small screens by itself; zoom the browser
   to 90% if the panels look tight.
