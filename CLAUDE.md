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

### What Landturn is

Landturn is a web app that shows how the land around any address in the world has changed over time. The user types an address and sees:

- a satellite map with a before/after swipe
- a year slider
- color-coded change layers:
  - **red**: green space lost
  - **green**: green space gained
  - **orange**: newly built or cleared land
  - **blue**: new water
- a side panel with stats, such as hectares of green space lost

The design is dark, minimal, and image-led. `docs/mockup-v2.html` is the design reference. It replaces the older `docs/mockup.html`. The mockup uses simulated data, and its code is a design reference only: don't copy it into the app.

### How change is detected

- We do **not** classify imagery ourselves. We use published, pre-classified global land-cover maps.
- To find change, we compare each pixel's label between two years. Area changed = number of changed pixels × pixel area.
- Results are **estimates**, and the app must say so.

### Data eras

| Era | Years | Dataset | Resolution | Classes | Status |
|---|---|---|---|---|---|
| Detailed | 2017 to today | Impact Observatory annual land cover, read from Microsoft Planetary Computer as Cloud-Optimized GeoTIFFs | 10 m | 9 | **Build first** |
| Long view | 1985 to 2022 | GLC_FCS30D | 30 m | 35 | Add later |

- Older (GLC_FCS30D) years are coarser, and the app must label them that way.
- Both datasets map into our own simple categories: **trees, grass/farmland, built, water, bare, no data** (no data includes clouds).

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

- **Global search:** the search box says "Enter any address", with no country named.
- **Landing:** a linework globe drawn with D3 (orthographic projection on a canvas), *not* MapLibre's built-in globe (the user rejected that one as tacky). It spins slowly and can be dragged. Glowing hotspots mark a hand-picked list of places with dramatic land change, colored by change type, with a hover teaser. The search box sits in a side panel (desktop) or bottom panel (mobile), together with place buttons.
- **Two-stage transition:**
  1. The globe turns and zooms only to a regional view and shows a coordinate callout.
  2. Meanwhile, the detailed MapLibre map loads hidden at the location, and the backend computes the change. When MapLibre fires its `idle` event, crossfade from the globe to the map.
  - Never fly MapLibre from world zoom down to street level.
- **Reveal:** one sentence leads the results, e.g. "Since 1985, Fontana turned X hectares of open land into buildings within 1 km." Until the long view era (GLC_FCS30D) is built, all app text says "since 2017" instead of "since 1985".
- **Timeline:** from 1985 to the latest available year. The coarse 30 m era (GLC_FCS30D) is visually marked. Before 2000 it moves in 5-year steps.
- **Planning-drawing identity:** a title block with site, coordinates, period, and data source; a scale bar; a north arrow. The four change colors (red, green, orange, blue) are the only accent colors.
- **No locator globe:** a small "key map" globe was built and dropped (2026-11-16). It looked out of place on desktop and phone, and on desktop it falsely invited dragging. Don't propose it again; the globe-to-map transition and the panel's coordinates already give location context.
- **North-up map:** the MapLibre map is locked north-up (no rotation or tilt), like a plan sheet, so the north arrow always points up.
- **Honest progress:** the loading steps and progress bar follow real events (globe turn finished, map tiles loaded, later the backend result), never fake timers. A short hold after the last step lets people see it complete before the crossfade.

### Later features

Not part of the first version, so don't build these yet:

- "New construction sites found" stat (grouping changed pixels into separate sites)
- Share screen (download image, PDF summary, copy link)
- Long view era (GLC_FCS30D, 1985 to 2016)
- Replace the placeholder hotspot list (`frontend/src/places.js`, copied from the mockup) with verified places that show strong change since 2017

### Purpose

This is a portfolio project. The user has a background in landscape architecture, urban planning, and IT. Explain both the code **and** the GIS and remote sensing concepts (for example, rasters, pixel resolution, map projections, land-cover classes) as we go.
