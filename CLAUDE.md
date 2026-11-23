# CLAUDE.md

Guidance for Claude when working in this repository.

## About the user

The user is learning to code. Treat every task as a chance to teach as well as to build.

## How to work

1. **Work in small steps.** Break each task into small pieces and do one piece at a time. Don't write large amounts of code in one go. After each step, stop so the user can follow along and ask questions before you continue.
2. **Explain before writing code.** Before you create or change any code, say in plain language:
   - what you are about to do
   - why it is needed
   - which file(s) it will touch
3. **Comment every line of code.** Every line of code you write gets a comment in plain, beginner-friendly language saying what that line does. Skip jargon, or explain it the first time you use it.
4. **Keep it simple.** Prefer the simplest approach a beginner can understand over clever or advanced techniques. If an advanced technique really is the better choice, explain why.
5. **Summarize after each step.** Briefly say what changed and what the next step will be.

## Project overview

### Name and address

- **Name:** Landturned (renamed from Landturn on 2026-11-23).
- **Address:** https://landturned.com (Render's own address for the service, landturn.onrender.com, also works).
- **Naming rule:** "Landturned" (capital L, rest lowercase) in all text people read: titles, labels, docs, comments. Lowercase "landturned" only in URLs, file names and code. The local folder `landturn/` keeps the old name. The GitHub repository is `sam-thang/landturned` (renamed 2026-11-23; GitHub redirects the old address).
- **Kept on purpose:** the Render service name `landturn`, its disk `landturn-cache` and the setting `LANDTURN_CACHE_DIR`. Renaming them in `render.yaml` could make Render create a second service and an empty disk, or quietly stop saving to the disk.

### What Landturned is

Landturned is a web app that shows how the land around any address in the world has changed over time. The user types an address and sees:

- a satellite map with a before/after swipe
- a year slider
- color-coded change layers:
  - **red**: green space cleared (trees or grass/farmland that became bare ground, with nothing built yet)
  - **green**: green space gained (any non-green land that became trees or grass/farmland)
  - **orange**: newly built (any land that became built, including former green space)
  - **blue**: new water (any land that became water)
  - Each pixel gets one color. The "green space lost" stat counts every green → non-green pixel, so it includes the red pixels plus the orange and blue pixels that used to be green. Changes between two green categories (trees ↔ grass/farmland) and pixels with no data in either year get no color; the no-data area is reported separately.
- a side panel with stats, such as hectares of green space lost

The design is dark, minimal, and image-led. `docs/mockup-v2.html` is the design reference. It replaces the older `docs/mockup.html`. The mockup uses simulated data, and its code is a design reference only: don't copy it into the app.

### How change is detected

- We do **not** classify imagery ourselves. We use published, pre-classified global land-cover maps.
- To find change, we compare each pixel's label between two years. Area changed = number of changed pixels × pixel area.
- Results are **estimates**, and the app must say so.

### Data eras

| Era | Years | Dataset | Resolution | Classes | Status |
|---|---|---|---|---|---|
| Detailed | 2017 to 2024 | Impact Observatory annual land cover, read from the AWS Registry of Open Data (`io-10m-annual-lulc` S3 bucket, one file per UTM zone and year) as Cloud-Optimized GeoTIFFs | 10 m | 9 | **Built** |
| Long view (photos only) | about 1985 to today | Landsat Collection 2 Level-2 on Planetary Computer (`landsat-c2-l2`) | 30 m | none: photos, not measured | Planned, version 2 (see Later features) |

- The long view is photos only and must say so ("Photos only · 30 m · not measured"). It never feeds the stats.
- The land-cover data maps into our own simple categories: **trees, grass/farmland, built, water, bare, no data** (no data includes clouds).

### Architecture

- `frontend/`: Vite, plain JavaScript, MapLibre GL JS.
- `backend/`: Python with FastAPI, managed with uv (Python 3.13). Given a location, it fetches only the small area needed, compares two years, and returns the change layer and stats.
- **Analysis area:** the 2 × 2 km square the map shows (1 km north, south, east, and west of the address), not a circle. The stats must describe exactly what people see when they swipe between years.

### Test locations

- **Main development test:** the Inland Empire, California (Ontario/Fontana area). Farmland there became warehouse districts, so changes are easy to verify.
- **Second test:** Stavanger, Norway. It's a cloudy region with subtle change.
- Nothing may be hard-coded to one country.

### Design decisions

These override the mockup where the two differ:

- **American English:** All user-facing text uses American English. This covers spelling (color, center, analyze, meter) and dates ("Oct 21, 2017"). Metric units (m, km, ha) stay. Code names, comments, and quotes or official names from data sources are not changed.
- **Global search:** the search box says "Enter any address", with no country named.
- **Landing:** a linework globe drawn with D3 (orthographic projection on a canvas), *not* MapLibre's built-in globe (the user rejected that one as tacky). It spins slowly and can be dragged. Glowing hotspots mark a hand-picked list of places with dramatic land change, colored by change type, with a hover teaser. The search box sits in a side panel (desktop) or bottom panel (mobile), together with place buttons.
- **Two-stage transition:**
  1. The globe turns and zooms only to a regional view and shows a coordinate callout.
  2. Meanwhile, the detailed MapLibre map loads hidden at the location, and the backend computes the change. When MapLibre fires its `idle` event, crossfade from the globe to the map.
  - Never fly MapLibre from world zoom down to street level.
- **Reveal:** one sentence leads the results, naming the real years compared, e.g. "Between 2017 and 2024, Fontana turned X hectares of land into buildings.", taken from the backend's answer: the data stops at its latest year, so "since" would wrongly suggest it runs up to today.
- **Timeline:** measured change runs from 2017 to the latest Impact Observatory year. The photos-only long view from about 1985 is a separate overlay (see Later features), not part of this timeline.
- **Planning-drawing identity:** a title block with site, coordinates, period, and data source; a scale bar; a north arrow. The four change colors (red, green, orange, blue) are the only accent colors.
- **No locator globe:** a small "key map" globe was built and dropped (2026-11-16). It looked out of place on desktop and phone, and on desktop it falsely invited dragging. Don't propose it again; the globe-to-map transition and the panel's coordinates already give location context.
- **Grid-up map:** the analysis square comes from the UTM grid, whose "up" differs slightly from true north (grid convergence: about 0.3° in California, about 3° in Stavanger). The map is turned so the square always sits straight, and the north arrow turns with it so it always points to true north, like a site plan drawn square to its site. People can't rotate or tilt the map themselves.
- **Verified hotspots:** every place in `frontend/src/places.js` is chosen by `backend/scripts/rank_places.py`, which runs the app's own analysis around candidates and nudges each square onto the change, and then checked by eye on its change picture. Teasers quote the real hectares. Reject places whose change is a classification error, not real change (e.g. Lima's desert settlements were labeled "rangeland" in 2017 and "built" in 2023). Under our color rule, forest → pasture is green → green and gets no color, so red places need land stripped bare (mines, earthworks).
- **Honest progress:** the loading steps and progress bar follow real events (globe turn finished, map tiles loaded, later the backend result), never fake timers. A short hold after the last step lets people see it complete before the crossfade.

### Later features

Not part of the first version, so don't build these yet:

- "New construction sites found" stat (grouping changed pixels into separate sites)
- Share screen (download image, PDF summary, copy link)
- **Long view: how it turned since 1985** (planned, version 2)
  - **Purpose:** show long-term change at city scale, from about 1985 to today, as photos only. No land-cover measurement.
  - **Entry point:** a quiet link under the result sentence: "See how it turned since 1985 →". The main flow stays unchanged.
  - **View:** a full-screen overlay:
    - centered on the searched address, covering about 15 × 15 km, so 30 m imagery looks like a real photo
    - the current 2 × 2 km analysis square outlined, for context
    - a year scrubber with one frame about every 5 years (1985, 1990 … latest), plus a play button
    - the title block labelled "Photos only · 30 m · not measured"
    - closing it returns to the map exactly where the user was
  - **Data:** the Landsat Collection 2 Level-2 archive on Planetary Computer (`landsat-c2-l2`):
    - Landsat 5 (1984–2011) and Landsat 8/9 (2013 onward)
    - never Landsat 7 after 2003, because a sensor fault left stripes across its images
    - never mix Landsat with Esri photos in the same view
  - **Speed:**
    - pre-cut crops from Planetary Computer's item/bbox endpoint, one image per frame, on the same UTM grid so frames line up
    - choose one tile and orbit for all years where possible
    - check clouds at the place with a small cloud mask before downloading
    - cache by rounded coordinates
    - precompute frames for the globe hotspots
  - **Build order:** after the speed work and the first deployment.
- Maybe later: measured land cover for 1985–2016 with GLC_FCS30D (30 m).

### Purpose

This is a portfolio project. The user has a background in landscape architecture, urban planning, and IT. Explain both the code **and** the GIS and remote sensing concepts (for example, rasters, pixel resolution, map projections, land-cover classes) as we go.
