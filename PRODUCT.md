# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the curious public.** Anyone who wonders how the land around a place they know (their home, their hometown, somewhere in the news) has changed. They are not GIS experts. They arrive with an address or a vague curiosity, often on a phone, and give the app a minute or two.

Secondary audiences, served through the same experience rather than separate features:
- **Portfolio reviewers** (hiring managers and peers in landscape architecture, urban planning, GIS and IT), who judge the craft and the honesty of the method.
- **Planners and environmental professionals**, who want a quick, credible read of change around a site.

When their needs conflict, the curious public wins: clarity and trust for a non-expert come first.

## Product Purpose

Landturn shows how the land around any address in the world has changed over time. You enter an address (or pick a highlighted place, or use your location), and Landturn compares published land-cover maps from two years across a 2 × 2 km square centred on that spot.

**Success:** people *see the change with their own eyes* in the before/after swipe and the color-coded change map, and leave with **one striking, honest number about their place** that they could repeat to someone else (e.g. how many hectares of open land turned into buildings).

## Positioning

- **Any address on Earth, not a curated gallery.** Nothing is hard-coded to one country; the highlighted places are an invitation, not the limit.
- **A planner's eye.** The result reads like a site plan: a fixed, square analysis area, a title block, a scale bar, a north arrow, and stats that describe exactly the square people see when they swipe.
- **Honest by construction.** Landturn does not classify imagery itself. It compares published, pre-classified global land-cover maps, and says plainly that results are estimates, which datasets and years they come from, and how coarse they are.

## Operating Context

- Used in a web browser, on phones and desktops alike. People find it by link or from a portfolio.
- The flow: a landing globe with highlighted places, then a search, then the globe turns to the region while the detailed map and the analysis load, then the results (a one-sentence reveal, the swipe, the year slider, the change layers, and the stats).
- Each analysis takes a few seconds on the backend, so the loading must report real progress, never fake timers.

## Capabilities and Constraints

- **Data:** Impact Observatory annual land cover (10 m, 2017 to the latest year, currently 2024) via its public AWS Open Data copy (CC BY 4.0). Planned later: GLC_FCS30D (30 m, 1985–2022), which must be labelled as coarser.
- **Categories:** trees, grass/farmland, built, water, bare, and no data (no data includes clouds).
- **Change colors:** red = green space cleared, green = green space gained, orange = newly built, blue = new water. One color per pixel. Green ↔ green changes and no-data pixels get no color, and the no-data area is reported separately.
- **Analysis area:** the 2 × 2 km UTM-grid square shown on the map. The map is turned grid-up, and people can't rotate or tilt it.
- **Wording:** the reveal sentence names the real years compared ("Between 2017 and 2023, …"), not "since", because the data stops at its latest year.
- **Stack:** Vite + plain JavaScript + MapLibre GL JS + D3 (frontend), Python FastAPI managed with uv (backend).
- **Later, not yet:** construction-site counting, a share screen, the long-view era, an "Analyse this area" button.
- **Open:** the hosting provider for the public deploy hasn't been chosen.

## Brand Commitments

- Name: **Landturn**. Its voice is plain, specific and calm, stating facts, never hype.
- Binding direction from the user (full detail in `CLAUDE.md`): dark, minimal and image-led; a planning-drawing identity; the four change colors are the only accent colors; a D3 linework globe on the landing page (not MapLibre's globe); no locator "key map" globe; don't look like watch.earth. `docs/mockup-v2.html` is the design reference, and `CLAUDE.md` wins where the two differ.

## Evidence on Hand

- Real analyses from the app's own backend. Highlighted places in `frontend/src/places.js` are chosen by `backend/scripts/rank_places.py` and checked by eye. Their teasers quote real hectares.
- Test locations: the Inland Empire, California (farmland → warehouses) and Stavanger, Norway (cloudy, subtle change).
- There are no testimonials, users, press or usage figures. Never invent any.

## Product Principles

1. **Show, then tell.** The imagery and change map carry the story, and the number confirms what people can already see.
2. **One honest number.** Lead with a single, repeatable figure, and never overstate it: say it's an estimate, name the years, and label coarse data.
3. **What you see is what we counted.** The stats describe exactly the square on screen. Nothing is measured off-screen.
4. **Real progress, real data.** Loading follows real events, and highlighted places are verified by the app's own analysis. Reject changes that are classification errors.
5. **Anywhere on Earth.** Nothing assumes a country, language of address, or region.

## Accessibility & Inclusion

- Target **WCAG 2.2 AA**: readable contrast on the dark design, full keyboard use, and screen-reader labels for the globe, map and controls.
- Respect **reduced motion**: when the person's system asks for it, the spinning globe, the turn-and-zoom transition and other animation must calm down or be replaced with simple fades.
- Change must not rely on color alone: the four change colors need text labels or stats beside them for people with color-vision differences.
- **Public deploy planned:** it must work for strangers on ordinary phones and desktops, including slow connections.
