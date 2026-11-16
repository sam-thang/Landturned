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

The design is dark, minimal, and image-led. `docs/mockup.html` is the design reference.

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
- `backend/`: Python with FastAPI. Given a location, it fetches only the small area needed (default 1 km radius), compares two years, and returns the change layer and stats.

### Test locations

- **Main development test:** the Inland Empire, California (Ontario/Fontana area). Farmland there became warehouse districts, so changes are easy to verify.
- **Second test:** Stavanger, Norway. It's a cloudy region with subtle change.
- Nothing may be hard-coded to one country.

### Purpose

This is a portfolio project. The user has a background in landscape architecture, urban planning, and IT. Explain both the code **and** the GIS and remote sensing concepts (for example, rasters, pixel resolution, map projections, land-cover classes) as we go.
