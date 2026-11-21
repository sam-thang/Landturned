# Landturn: current state (2026-11-21)

A factual snapshot for performance advice. It's based on reading the code and on timings measured on 2026-11-21 (section 4). "Not checked" means I didn't verify it.

**Speed-up phases done:** Phase 1 (quick fixes), Phase 2 (land cover read from AWS, years to 2024) Phase 3 (one analysis request, land-cover disk cache) and Phase 4 (reveal sooner; the "after" photo is always the current imagery) on 2026-11-21. The baseline timings stay in section 4, with each phase's re-measurement added below them.

## 1. Stack and structure

**Frontend:** Vite 8 dev server and bundler, plain JavaScript (ES modules), no framework.
- **MapLibre GL JS 6.18:** the satellite map. It's lazy-loaded the first time a place is chosen.
- **D3 7** with **topojson-client** and **world-atlas** (`land-50m.json`, bundled): the landing globe, drawn on a canvas.
- **`@vitejs/plugin-basic-ssl`:** HTTPS dev server, needed for geolocation on phones.
- **Fonts:** Space Grotesk and JetBrains Mono from Google Fonts.

**Backend:** Python 3.13, FastAPI with Uvicorn, managed with uv.
- **pystac-client** and **planetary-computer:** STAC search and URL signing. Since Phase 2 only the unused Sentinel-2 endpoint uses them.
- **rasterio** (GDAL): windowed reads of Cloud-Optimized GeoTIFFs.
- **numpy:** pixel comparison.
- **Pillow:** writes the change PNG.

**Dev setup:** Vite proxies `/api/*` to `http://127.0.0.1:8000`. No production deployment is described in the repo; hosting is **unknown**.

**File map:**

| File | Role |
|---|---|
| `frontend/index.html` | The single page: landing panel, locating steps, result panel, map overlays |
| `frontend/src/main.js` | Flow control: search, globe pick, My location, the request plan (`startRequests`, `getImagery`, `showFinishedResult`), "Analyse this area", year slider, URL state |
| `frontend/src/map.js` | MapLibre map: base imagery, change layer, analysis square, label, swipe handle and opening animation, colour switches, "Analyse this area" offer and head start, land cover toggle |
| `frontend/src/swipe.js` | Builds the 2017 "before" picture from Esri archive tiles on a canvas, cut to the square |
| `frontend/src/api.js` | Calls to our backend (`/api/analysis`, `/api/wayback`) and to Esri's identify service |
| `frontend/src/geocode.js` | Nominatim search and reverse geocoding |
| `frontend/src/globe.js` | D3 landing globe, hotspots, tap-to-pin |
| `frontend/src/results.js` | Result sentence, stats rows, small print |
| `frontend/src/loading.js` | Loading steps and progress bar |
| `frontend/src/places.js` | The 11 hotspots |
| `frontend/src/scalebar.js` | Scale bar |
| `frontend/how/`, `how.js`, `how.css` | "How this works" page, partly built |
| `backend/app/main.py` | API routes: `/api/health`, `/api/analysis` (since Phase 3; replaces `/api/change` and `/api/timeline`), `/api/wayback`, `/api/imagery` |
| `backend/app/analysis.py` | Since Phase 3: reads all years in parallel, builds the main result plus every slider comparison, and keeps the land-cover disk cache |
| `backend/app/landcover.py` | Works out the land-cover file from the coordinates (grid zone + year), 200 × 200 px square read, class mapping, comparison, edge cleaning, stats |
| `backend/app/change_image.py` | Change grid → transparent PNG → base64 data URL |
| `backend/app/wayback.py` | Esri Wayback lookup: which archive versions and photo dates for "before" and "after", with a disk cache |
| `backend/app/imagery.py` | Sentinel-2 photo of the square. **The frontend no longer calls it.** |
| `backend/scripts/warm_wayback.py` | Pre-fills the Wayback cache for the 11 hotspots |
| `backend/scripts/rank_places.py`, `explore_fontana.py`, `method_patch.py` | Dev and analysis scripts, not part of the app |

## 2. Data sources

| Service | Endpoint / pattern | What we request | Called from |
|---|---|---|---|
| **Impact Observatory annual LULC on AWS Open Data** (since Phase 2; CC BY 4.0, bucket `io-10m-annual-lulc`, us-west-2) | `https://io-10m-annual-lulc.s3.amazonaws.com/{zone}_{year}.tif`, e.g. `11S_2024.tif`; the file name is computed from the coordinates (`landcover.grid_zone`), no catalog search | A windowed read of band 1: a **200 × 200 px** (2 × 2 km) square snapped to the file's pixel grid, class codes as uint8; 2017–2024. HEAD requests: one per server start (is a newer year out?), one per grid zone per server run (does the zone have data?) | Backend, `landcover.find_files_by_year`, `read_square`, `newest_year`, `years_in_zone` |
| ~~Microsoft Planetary Computer STAC + Azure COGs~~ | collection `io-lulc-annual-v02` | Used until Phase 2 (2017–2023 only). Its 2023 squares are identical to the AWS files | Not used for land cover any more |
| **Esri World Imagery tiles** (current) | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Raster tiles, max zoom 19. `tileSize` 128 on screens with DPR ≥ 2 (sharper, about 4× the tiles), else 256 | Browser, MapLibre (`map.js`) |
| **Esri World Imagery identify** | `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify` | Capture date of the current photo at the point (layer 0, about 1 km map extent, 400 × 400 display) | Browser, `api.js fetchPhotoDate` |
| **Esri Wayback config** | `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json` | The list of all archive versions (about 170 since 2016) | Backend, `wayback.versions` |
| **Esri Wayback tilemap** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{version}/16/{row}/{col}` | "Which version did this zoom-16 tile last change in?" Small JSON; chained requests walk backwards | Backend, `wayback.changed_versions` |
| **Esri Wayback metadata** | `{version metadataLayerUrl}/identify` | Photo capture date, resolution and source at the point (2 km extent, 800 px display), for about 15 candidate versions | Backend, `wayback.photo_in_once` |
| **Esri Wayback tiles** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{version}/{z}/{y}/{x}` | (a) the "after" version as the map's base imagery, through MapLibre; (b) "before" tiles at zoom 16 drawn into a canvas for the swipe | Browser, `map.js setBaseImagery`, `swipe.js buildBeforeImage` |
| **Nominatim (OpenStreetMap)** | `https://nominatim.openstreetmap.org/search` and `/reverse` | Search: `q`, `format=jsonv2`, `limit=1`. Reverse: `zoom=10` (city level) | Browser, `geocode.js` |
| **Google Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Two font families | Browser, `index.html` |
| **Sentinel-2 L2A** (Planetary Computer) | collection `sentinel-2-l2a` | Bands B04/B03/B02 and SCL, warped to the square's grid, JPEG; the clearest summer image of the requested year | Backend, `imagery.py`, via `/api/imagery?lat&lon&year`. **Unused by the frontend** (a fallback for old Esri imagery was tried and rejected, see section 4) |

## 3. What happens step by step

### a) Search from the landing page, up to the full result

1. **Browser → Nominatim search.** Sequential; everything else waits for it.
2. **These all start at the same moment, in parallel:**
   - **Browser:** the globe turns and zooms (1.6 s animation). MapLibre is downloaded if not yet loaded (lazy import), and the map is created hidden. **Esri current tiles** load.
   - **Browser → Esri identify:** the current photo date.
   - **Browser → `/api/analysis`** (since Phase 3).
     - **First, the cache key:** the backend works out the file names, then the square's position on the zone's grid. Both are instant once the zone is known; the zone facts are saved in `zones.json`, so a zone never seen before pays one HEAD request plus one file-header read, once ever.
     - **Saved square:** it reads the JSON file and is done.
     - **Otherwise:** it reads **all 8 years in parallel**, builds 7 comparisons (2017 → each later year; the last is the main result) with PNGs as data URLs, saves them, and returns them.
   - **Browser → `/api/wayback`** (no years passed). The backend does, in sequence:
     1. Work out the years (no STAC search since Phase 2).
     2. If the tile is cached: read the JSON file. Otherwise:
        - fetch the version list (memory cache, 24 h)
        - **two tilemap walks in parallel** (2017 window and last-year window, 2024 since Phase 2; each walk is sequential)
        - about 15 metadata identify calls **in parallel** (32 workers)
        - a **quick answer after about 5 s** (only if each year has a photo within 365 days of 1 July); the full answer finishes in the background and is saved
3. **Since Phase 4 the "after" photo is always Esri's current imagery.**
   - It must be from the last land-cover year (2024) or later, and the archive only holds older versions, so nothing newer exists.
   - The map never switches to archive tiles; `setBaseImagery(null)`.
   - The identify date is only used for the imagery line and the swipe's right tag ("LATEST" if it didn't come). Nothing waits for it.
4. **As soon as both answers are in** (`/api/analysis` and `/api/wayback`), in the browser, during the globe turn: the 2017 photo's zoom-16 tiles load (about 25–56, in parallel) and are drawn into a canvas (`startSwipe`).
5. **The reveal** happens when the land-cover answer, the map's tiles (`idle`) and the callout's minimum time are done. It does **not** wait for `/api/wayback`.
   - The change layer is drawn, the map turned grid-up, the panel and the year slider filled, then the crossfade.
   - **If the archive answer is already in** (saved places), the reveal allows up to 1.5 s for the 2017 tiles. When they're ready, the swipe starts at the right edge and the opening sweep plays.
   - **Otherwise:** "FINDING 2017 IMAGERY…" shows inside the square. When the 2017 photo is ready, the swipe is added at the left edge and glides to the middle, and screen readers hear "2017 imagery added". The base photo is never replaced.

The 2017 photo races a **40 s deadline** counted from the place being chosen. If it's hit, the tag disappears and the result has no swipe.

### b) "Analyse this area" after panning

1. **Head start:** once the map has been still for **0.5 s** (1.5 s before Phase 1) (counted from MapLibre `moveend`, so after inertia) with the offer visible, the browser sends `/api/wayback` for the map centre and throws the answer away. The backend shares a running lookup per tile, so a later request joins it.
2. **On press, in parallel:**
   - Nominatim reverse geocode
   - Esri identify
   - `/api/wayback`
   - `/api/analysis`
3. The same sequence as (a) steps 3–6, but **no globe and no map creation**. The old result stays dimmed until the land-cover answer and the map's tiles are ready (since Phase 4 it doesn't wait for the archive), then switches at once. The square's checklist is "Comparing land cover", then "Loading imagery".

### c) Moving the year slider

- **No network.** All years come from the one `/api/analysis` answer held in memory.
- On each `input` event it swaps the change PNG (`setUrl`) and re-renders the stats. Measured: under 1 ms to handle.
- The colour on/off filter re-processes the PNG on a canvas (`getImageData`) in the browser.
- It also sends the swipe handle back to the left edge.

### d) Before/after swipe imagery

- **"After" (right side):** the map's own base photo, Esri's current imagery (since Phase 4; before, an archive "after" version could replace it). Its tag shows the identify date, or "LATEST".
- **"Before" (left side):**
  - the zoom-16 Wayback tiles covering the square, all fetched in parallel (`crossOrigin = anonymous`)
  - drawn into one canvas and clipped to the square
  - added as a MapLibre canvas source (`animate: false`)
- **Dragging:** the visible part is redrawn and pushed with `play()`/`pause()` on each move. No network.

## 4. Timings

Measured 2026-11-21:
- **Setup:** desktop Chrome, headless, 1400 × 900, browser cache disabled, home connection, local backend.
- **Each figure is a single run,** so treat it as indicative.
- **"Cold"** means the Wayback answer for that tile wasn't on disk.

**Full search flow (submit → result shown):**

| Step | Fontana cold | Fontana warm | Stavanger cold |
|---|---|---|---|
| Nominatim search | 1.75 s | 0.72 s | 0.68 s |
| MapLibre code (3 files) | 0.4 s | 0.4 s | 0.4 s |
| Esri current tiles | 30 tiles, done 3.2 s after start | 30 tiles, 1.9 s | 25 tiles, 1.9 s |
| Esri identify (photo date) | **25.1 s, then failed** | 0.82 s | 0.82 s |
| `/api/change` | 7.8 s | 3.1 s | 5.5 s |
| `/api/wayback` | **15.1 s** | 1.75 s | **13.1 s** |
| Archive tiles (after imagery + 2017 swipe) | 55 tiles, 3.6 s | 55 tiles, 3.4 s | **106 tiles, 5.2 s** |
| **Result shown** | **32.1 s** | **8.8 s** | **20.7 s** |
| `/api/timeline` (starts after the reveal) | 4.6 s | 3.5 s | 4.0 s |
| Year slider usable | 36.1 s | 11.7 s | 24.3 s |
| Year slider move | 0.4 ms | 0.6 ms | 0.5 ms |

**"Analyse this area"** near Fontana (cold tile, pressed 2 s after the pan, so the head start hadn't fired yet):
- `/api/change` 3.1 s
- `/api/wayback` **12.2 s**
- reverse geocode 1.1 s, identify 0.26 s
- 25 archive tiles
- **New result 14.3 s after the press**
- Timeline +2.9 s after that

**Backend endpoints alone** (curl, after the runs above, so Wayback was warm; each called twice):

| Endpoint | Fontana | Stavanger | Notes |
|---|---|---|---|
| `/api/change` | 2.47 / 2.27 s | 1.65 / 1.67 s | The 2nd call is no faster: nothing is cached |
| `/api/timeline` | 3.30 / 2.67 s | 1.64 / 1.70 s | 5.3 KB / 10.5 KB |
| `/api/wayback` (cached answer) | 1.79 / 1.63 s | 1.65 / 1.64 s | Almost all of it is the STAC search |

**Backend building blocks** (Python, direct):

| Operation | Fontana | Stavanger |
|---|---|---|
| STAC search | 2.39 s | 1.48 s |
| One year's square read | 2.82 s (first), 1.37 s (second) | 1.44 s / 1.55 s |
| Reading a saved Wayback answer | 0.2 ms | 0.2 ms |

**Slowest steps, in order (baseline):**
1. **The cold Wayback lookup** (12–15 s): sequential tilemap walks plus slow metadata services.
2. **The Esri identify call when it stalls.** In the Fontana cold run it hung 25 s and **held the whole imagery step about 10 s past the Wayback answer**. *Fixed in Phase 1.*
3. **`/api/change`** (2–8 s): a STAC search plus two sequential COG reads.
4. **Archive tile loading** before the reveal (3–5 s, 55–106 tiles).
5. **`/api/timeline`** (3–5 s), which only starts after the reveal.

### After Phase 1 (identify timeout, 0.5 s head start)

Same setup and searches. "Cold" = the two saved Wayback answers were deleted first. Single runs.

| Step | Fontana cold | Fontana warm | Stavanger cold | Stavanger warm |
|---|---|---|---|---|
| Nominatim search | 0.68 s | 0.72 s | 0.53 s | 0.72 s |
| Esri identify | 0.78 s | 0.78 s | 0.75 s | 1.02 s |
| `/api/change` | 7.0 s | 3.3 s | 5.6 s | 1.9 s |
| `/api/wayback` | 14.0 s | 1.9 s | 10.9 s | 1.9 s |
| Archive tiles | 55, 3.5 s | 55, 3.6 s | 106, 5.3 s | 106, 5.4 s |
| **Result shown** | **19.7 s** (baseline 32.1 s) | **9.1 s** (8.8 s) | **18.1 s** (20.7 s) | **10.3 s** |
| Year slider usable | 23.7 s | 11.2 s | 22.0 s | 11.8 s |

- **Identify didn't stall in these runs,** so most of the Fontana cold difference against the baseline is the missing 25 s stall.
- **Forced stall test** (identify never answers, Stavanger warm): the app cancels identify after about 3 s, and the result appears at 8.7 s after page load, the normal time.
  - With the archive "after" photo also removed, the result appears at 4.0 s with the tag "LATEST" and the dateless imagery line.
- **"Analyse this area"** (Fontana area, new spot, pressed 2.0 s after the mouse was released):
  - the head start fired 1.5 s after release, which is 0.5 s after the map's glide ended
  - the new result appeared **15.5 s after the press**; `/api/wayback` took 12.3–13.5 s
  - Unexplained: the button's own `/api/wayback` request finished 1.7 s after the head-start request it should have joined. Not checked further.

### After Phase 2 (land cover from AWS, 2017–2024, no STAC search)

Same setup. Every Wayback answer was cold for the first runs: the saved answers are keyed to the last year, which is now 2024. Single runs.

| Step | Fontana cold | Fontana warm | Stavanger cold | Stavanger warm |
|---|---|---|---|---|
| `/api/change` | 3.8 s (Phase 1: 7.0 s) | 1.2 s | 3.8 s (5.6 s) | 0.08 s* |
| `/api/wayback` | 12.4 s | **0.08 s** (Phase 1: 1.9 s) | 9.8 s | **0.08 s** |
| Archive tiles | 55, 3.4 s | 55, 3.4 s | 56, 3.3 s | 106, 5.3 s |
| **Result shown** | **17.8 s** (19.7 s) | **8.5 s** (9.1 s) | **15.5 s** (18.1 s) | **10.3 s** (10.3 s) |
| `/api/timeline` | 2.2 s | 1.0 s | 1.9 s | 0.15 s* |
| Year slider usable | 19.7 s (23.7 s) | 8.9 s (11.2 s) | 16.9 s (22.0 s) | 11.1 s (11.8 s) |

* **The server remembers recent reads.** GDAL keeps recently read file blocks in the server process's memory, so repeat reads of the same square are very fast. This lasts until the server restarts; it isn't a deliberate cache.

**Endpoints at places this server hadn't read yet** (curl, 1st / 2nd call):

| Place | `/api/change` | `/api/timeline` |
|---|---|---|
| Riverside | 1.73 / 0.46 s | 0.97 / 0.78 s |
| Bergen | 1.68 / 0.49 s | 1.81 / 0.94 s |

Before Phase 2, `/api/change` took 1.6–2.5 s even on repeat.

**Year lookup cost:** the first request in a new grid zone costs one HEAD request (about 0.6 s). The newest-year check runs once in the background when the server starts.

**Observations from these runs:**
- **The quick Wayback answer can differ from the saved full one.**
  - Fontana's first visit showed a "before" photo from **20 Aug 2016**; the saved full answer (warm run) found **6 Aug 2017**.
  - This is allowed by the rule "within 365 days of 1 July", but the first visitor sees a worse match.
- **A same-photo switch happens when the photo date arrives late.**
  - Stavanger warm loaded 106 archive tiles and Stavanger cold only 56.
  - In the warm run the Wayback answer (0.08 s) arrived before Esri identify (0.9 s). Without the current photo's date, the app switched the base map to the archive version.
  - That version is the same photo as the current imagery (both 5 Sep 2024), so the extra tiles bring nothing new.
  - Phase 4 addresses this.

**Hotspot re-warm for 2017–2024** (`warm_wayback.py`, full answers, 3 at a time): **118 s for all 11**, 6–66 s each.
- **"After" photos:** most hotspots now have one from 2024. Exceptions:
  - Weda Bay: 9 Jun 2023
  - New Capital: 26 Jan 2025
  - Western Sydney: 24 Jul 2025
- **"Before" photos:** unchanged, e.g. Hasankeyf still 4 Jun 2013, the closest the archive has.

### After Phase 3 (one `/api/analysis` request, land-cover disk cache)

Same setup. "Cold": the saved land-cover and Wayback answers for both places were deleted, and the server had just restarted. Single runs.

| Step | Fontana cold | Fontana warm | Stavanger cold | Stavanger warm |
|---|---|---|---|---|
| `/api/analysis` | 3.8 s (Phase 2 `/api/change`: 3.8 s) | **0.08 s** | 3.5 s (3.8 s) | **0.08 s** |
| `/api/wayback` | 12.4 s | 0.08 s | 9.6 s | 0.08 s |
| Archive tiles | 55, 3.5 s | 55, 3.3 s | 56, 3.3 s | 81, 4.6 s |
| **Result shown** | **17.9 s** (Phase 2: 17.8 s) | **8.4 s** (8.5 s) | **15.1 s** (15.5 s) | **9.5 s** (10.3 s) |
| Year slider usable | **at the reveal** (19.7 s → 18.6 s*) | at the reveal | at the reveal | at the reveal |

* "Year slider ready" was logged 0.4–1.0 s after "result shown" only because the test script checks it after other checks. The slider is enabled in the same step that shows the result; there's no request left to wait for.

**Warm after a server restart** (memory empty, disk cache only):
- Fontana and Stavanger: `/api/analysis` 0.08 s; result shown at 8.4 s and 10.4 s (Stavanger loaded 106 archive tiles that time).
- **But** the very first request per grid zone after a restart took 1.3–1.6 s, even with the answer saved. Finding the cache file needs the zone's availability (a HEAD request) and its pixel grid (a file-header read), and both are held in memory only.

**New places, zone already known** (curl, 1st / 2nd call):

| Place | `/api/analysis` |
|---|---|
| Riverside | 2.22 s / **0.016 s** |
| Bergen | 2.36 s / **0.017 s** |

**Answer size:** 6–26 KB per place (7 comparisons with PNGs).

**Effect:** the result itself isn't faster on cold visits; the Wayback lookup still decides that. What changed:
- the slider is usable at the reveal (it used to be 1–5 s later)
- one request instead of two
- every repeat visit to a square, by anyone and after restarts, skips the land-cover reads

### After Phase 4 (reveal without waiting for the archive; "after" = current imagery)

Same setup. "Cold" = both saved answers deleted for the two places. **The server wasn't restarted, so its file reader still had those land-cover squares in memory;** a truly new square takes about 2–2.4 s for `/api/analysis` (Phase 3). That fits inside the globe's turn and callout time, so the reveal time hardly depends on it. Single runs; times from pressing Enter.

| Step | Fontana cold | Fontana warm | Stavanger cold | Stavanger warm |
|---|---|---|---|---|
| `/api/analysis` | 1.0 s | 0.08 s | 0.16 s | 0.09 s |
| `/api/wayback` (no longer delays the result) | 10.2 s | 0.08 s | 8.6 s | 0.09 s |
| **Result shown** | **4.7 s** (Phase 3: 17.9 s) | **4.9 s** (8.4 s) | **5.0 s** (15.1 s) | **5.3 s** (9.5 s) |
| Swipe | joins at **12.8 s** with a glide; "Finding 2017 imagery" tag until then | **at the reveal**, opening sweep plays | joins at **12.6 s** | **at the reveal**, opening sweep plays |
| Archive tiles | 25 (2017 photo only) | 25 | 56 | 56 |
| Year slider | at the reveal | at the reveal | at the reveal | at the reveal |

- **The reveal time (about 5 s) is now mostly the globe animation:** the 1.6 s turn, the callout's 1.2 s minimum and the 0.5 s hold, plus the map tiles.
- **The archive "after" tiles are gone** (Phase 3 loaded 55–106 archive tiles, now 25–56), which also removes the same-photo switch seen in Phase 2.
- **"Analyse this area" at a new spot near Fontana:** the result appeared **1.7 s after the press** (Phase 1: 15.5 s). The swipe joined at 12.1 s and glided to the middle; screen readers heard "2017 imagery added: drag the handle on the map to compare." No page errors.
- **Right-hand tags now show the current photo's date,** which can be later than the last land-cover year, e.g. Fontana "2026 · 23 MAY". That's by design: the "after" photo must be from 2024 or later.
- **A first attempt** started loading the 2017 tiles only at the reveal. The Stavanger warm swipe then arrived 0.6 s too late for the opening sweep. Moving the tile loading into `startRequests` (it starts when both answers are in, during the globe turn) fixed it.

### Old-imagery fallback (after Phase 4, 2026-11-21)

**Problem the user found:** at 9.4308° N, 105.3849° E (Mekong Delta) the swipe compared Apr 2016 with Dec 2017.
- Esri's current photo there is from **18 Dec 2017**, and every archive version up to May 2026 shows the same photo at the square's zoom.
- So no Esri photo from 2024 or later exists there.

**How common** (60 random land points, 56°S–72°N, uniform on the sphere, 59 with a date; fixed random seed):

| Esri's current photo from… | Share |
|---|---|
| 2024 or later | 61% |
| 2022–2023 | 17% |
| 2019–2021 | 10% |
| before 2019 | 12% (oldest 2012) |

Random land over-represents remote areas, so the share for real searches is probably lower; not measured.

**Tried and rejected: a Sentinel-2 fallback.**
- **What it did:** where Esri was too old, the square showed a 2024 Sentinel-2 photo (10 m) as the "after" photo.
- **Why it was dropped:** the user rejected it after seeing it; at 10 m the photo is so blurry that the land-cover colours can't be related to anything on it. Not committed.

**Built instead: a disclaimer, plus a swipe rule.**
- **The disclaimer:** where Esri's photo date is before 1 Jan of the last land-cover year, the panel shows a bordered note under the stats, **"OLDER SATELLITE PHOTO"**. For example: "Esri's newest photo of this place was taken on 18 December 2017, the most recent sharp satellite imagery available here. The colours compare 2017 with 2024, so changes after 2017 may not be visible in the photo."
  - If the date arrives after the reveal, the note is added then. Only panel text changes, never the photo.
- **The swipe rule:** the swipe is only shown when its two photos are **at least 2 years apart** (`MIN_SWIPE_YEARS`).

**Tests** (single runs, times from page load, no page errors, no Sentinel-2 request anywhere):

| Place | Esri's newest | Result shown | Disclaimer | Swipe |
|---|---|---|---|---|
| Mekong | 18 Dec 2017 | 5.5 s desktop / 4.0 s phone | shown | none (Apr 2016 vs Dec 2017: 1.7 years apart) |
| Shandong, China (35.5112, 116.9028) | 16 Nov 2019 | 4.2 s | shown ("changes after 2019 …") | 2017 · 22 SEPT \| 2019 · 16 NOV (2.2 years apart) |
| Stavanger | 5 Sep 2024 | 4.1 s | none | 2018 · 27 MAY \| 2024 · 5 SEPT |

## 5. Loading and caching

**Preloaded:**
- **Hotspots:** `warm_wayback.py` pre-fills the Wayback cache for the 11 hotspots. It must be re-run on the server at deploy (not done; no deploy exists yet).
- **Head start:** `/api/wayback` starts 0.5 s after the "Analyse this area" offer has settled.
- **Map during the globe turn:** MapLibre and the map start loading while the globe turns.
- **Parallel start:** all first-wave requests start at once when a place is chosen.
- **Fonts:** Google Fonts preconnect.

**Backend caches:**

| What | Where | Key | Lifetime |
|---|---|---|---|
| Wayback answer (before/after photo, date, tile URL) | Disk: `backend/cache/wayback/*.json` (70 files now) | `z16_{row}_{col}_{firstYear}_{lastYear}`: the zoom-16 Web Mercator tile of the point (about 500–600 m) plus years | Forever. Only the full answer is saved, not the 5 s quick answer |
| Wayback lookups in progress | Memory (`Future` per cache path) | Same path | While running; concurrent requests share one lookup |
| Wayback version list | Memory | — | 24 h |
| Sentinel-2 photo (unused endpoint) | Disk `cache/imagery` plus `lru_cache` | Lat/lon rounded to 5 decimals, plus year | Forever |
| ~~STAC search results~~ | — | — | No STAC search since Phase 2. The grid zone's availability and the newest year are remembered in memory while the server runs |
| **Land-cover analysis** (main result + every slider comparison, with PNGs) | Disk: `backend/cache/landcover/*.json` (since Phase 3) | `{zone}_c{column}_r{row}_{first}_{last}`: the square's snapped position on the zone's 10 m grid, plus the years, e.g. `11S_c22735_r67113_2017_2024`. The visitor's exact point isn't saved; it's added per request | Forever. A new data year changes the key |
| Grid-zone facts: has data (with the year checked), projection, pixel grid | Disk: `backend/cache/zones.json`, plus memory | Grid zone, e.g. `11S` | Forever. "Has data" is re-checked once when a newer year appears (since the Phase 3 follow-up) |

**Browser:**
- `/api/timeline` answers are kept in memory for the current place only.
- Tiles rely on the browser's HTTP cache. Esri's cache headers: **not checked**.
- No service worker, no `localStorage` data cache.

**Already done for speed:**
- **GDAL settings:** `GDAL_DISABLE_READDIR_ON_OPEN`, `GDAL_HTTP_MERGE_CONSECUTIVE_RANGES`, `GDAL_HTTP_MULTIPLEX`, `CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif`. Measured from about 2 s to about 0.4 s per file open.
- **Square grid** comes from STAC `proj:*` metadata.
- **Parallel reads:** timeline years in parallel; Wayback two-window walks in parallel, identify calls in parallel.
- **Wayback lookup:** 5 s quick answer, cached per tile.
- **Frontend:** MapLibre lazy-loaded; the change PNG is a data URL, so there's no extra request.

## 6. Current settings

**Analysis square:**
- 2 × 2 km (`HALF_SIZE_M = 1000`) = **200 × 200 px at 10 m** = 400 ha.
- Snapped to the land-cover file's UTM grid.
- The map is turned "grid-up" so the square sits straight.

**Map:**
- **Zoom:** `minZoom` 10 (about city level). `maxZoom` isn't set, so MapLibre's default applies (22); the imagery source's `maxzoom` is 19.
- **Pan:** no limits (no `maxBounds`, on purpose).
- **Fitting:** 36 px padding.
- **No rotation or pitch** for users.

**Globe zoom:** 1–4.

**Land-cover years:**
- **2017–2024** (since Phase 2): every year from `FIRST_YEAR` 2017 to the newest year found on AWS (`NEWEST_KNOWN_YEAR` = 2024; a newer year is picked up automatically after a server restart).
- A grid zone without files (e.g. open ocean) has no years.
- The main result compares the first and last year. The slider compares the first year with each later year.

**Edge cleaning:** a 3 × 3 morphological opening per change colour (drops changes narrower than about 30 m).

**Imagery date matching:**
- **Candidates:** for each year Y, the archive versions published between 1 Jan Y and 31 Dec Y+2, plus the last change before that window.
- **Choice:** the photo whose capture date is **closest to 1 July Y**.
- **Quick answer:** accepted only if each year's photo is within 365 days of 1 July.
- **"After" vs current imagery:** the archive "after" photo is only used if it's closer to 1 July of the last year than Esri's current photo. Otherwise the map keeps the current imagery and the tag shows its date.
- **Tags** show the photo's own date (for example "2017 · 21 OCT"; Stavanger's "before" is 27 May 2018).

**Timeouts and limits:**
- 40 s imagery limit (frontend)
- 30 s per Esri request (backend)
- 8 s map idle wait
- 5 s Wayback quick answer
- 3 s Esri identify (photo date) timeout, never waited on
- 0.5 s head-start settle time

## 7. Known problems and unfinished work

**Performance and robustness:**
- ~~**The Esri identify call has no timeout.**~~ Fixed in Phase 1: a 3 s timeout, and nothing waits for it.
- ~~**`/api/wayback` runs a STAC search on every call.**~~ Fixed in Phase 2: no STAC search; a cached answer now takes 0.08 s.
- **Places with old Esri imagery** (about 4 in 10 random land points): no sharp photo from the last land-cover year exists. The panel shows an "OLDER SATELLITE PHOTO" disclaimer, and the swipe is hidden when its photos are under 2 years apart.
- **Weda Bay hotspot, decision pending:** with 2024 data its biggest change is built (93.7 ha), not cleared (now 23.1 ha). Its teaser and red type still show the 2017–2023 figure (30 ha cleared).
- **Old Wayback cache files:** 70 files keyed `…_2017_2023` in `backend/cache/wayback/` are no longer used.
- ~~**`/api/change` reads its two years one after the other; nothing cached.**~~ Fixed in Phase 3: all years in parallel, saved on disk.
- ~~**`/api/timeline` starts only after the reveal.**~~ Fixed in Phase 3: merged into `/api/analysis`.
- ~~**After a server restart, the first request per grid zone costs about 1.3 s.**~~ Fixed in the Phase 3 follow-up: zone facts are saved in `zones.json`. Measured right after a restart: Fontana 0.012 s, Bergen 0.002 s. Only a zone never seen before pays once: Stavanger 1.6 s, because its zone had been deleted for the test.
- **A cold Wayback lookup takes 12–15 s,** mostly sequential tilemap steps and slow Esri metadata services. Only hotspots are pre-warmed.
- ~~**The reveal waits for all archive tiles.**~~ Fixed in Phase 4: the reveal waits for neither the archive answer nor its tiles; only the 2017 photo's tiles load (25–56), for the swipe.
- **The backend still finds an archive "after" photo** (its tilemap walk and identify calls) that the app no longer uses since Phase 4. Phase 5 can drop it.
- **The head start only helps** if the user waits at least 0.5 s after the map stops moving (including its glide); before Phase 1 it was 1.5 s.
- **Nominatim:** the browser calls it directly with no custom User-Agent and no rate limiting in code. Usage-policy compliance: **not checked**.

**Data quality:**
- Impact Observatory labels flicker between years at quiet rural spots, giving implausible colours. A "change must persist two years" filter is parked.
- Some places have no archive photo within a year of 2017; the tag then shows the real year (for example 2014 in London).

**Unused code:**
- `/api/imagery` (Sentinel-2) and its cache: no longer called by the frontend.
- `glideToMiddle` in `map.js`: exported but no longer called.

**Unfinished:**
- **Landing hints, agreed but not built:** a colour key in the globe's corner, and a "click / tap any spot to analyse it" caption.
- "How this works" page: skeleton and data only.
- Not built yet: the long-view era (GLC_FCS30D, 1985–2016), the share screen, and the "new construction sites" stat.
- **No production deployment or build** has been checked.

## Phase 2 findings: land-cover years (2026-11-21, research only, no code changed)

**Source checked:** Impact Observatory's public AWS Open Data bucket `s3://io-10m-annual-lulc`, read over HTTPS at `https://io-10m-annual-lulc.s3.amazonaws.com/` with no account. Bucket region: not checked.

**Years:**
- 2017–2023, plus **2024** (757 files, uploaded 2025-06-23).
- **No 2025**: none among all 5,902 objects.

**File naming:** `{UTM zone}{latitude band}_{year}.tif`, e.g. `11S_2024.tif` (Fontana, Ontario Ranch), `32V_2024.tif` (Stavanger), `33U_2024.tif` (Giga Berlin).
- One file per MGRS grid zone (6° × 8°) per year, 90–160 MB each.
- These are the same tiles Planetary Computer serves: its item IDs are `11S-2023`, `32V-2023`, …

**Format** (checked on `11S_2024.tif`):
- EPSG:32611 (UTM), 10 m pixels, uint8, nodata 0
- LZW compression, 512 × 512 internal tiles, overviews 2–32: a cloud-optimised GeoTIFF that supports windowed reads, like today
- no version tags in the file

**Same dataset:** the 2023 square read from AWS is **pixel-for-pixel identical** to the Planetary Computer 2023 square, at Fontana and at Stavanger. 2017–2022 weren't compared.

**Method consistency of 2024** (share of pixels whose category changed, year to year):

| Place | 2022→2023 | 2023→2024 |
|---|---|---|
| Ontario Ranch | 7.5% | 6.1% |
| Giga Berlin | 10.4% | 1.7% |
| Stavanger | 1.3% | 1.4% |
| Fontana | 0.1% | 0.1% |

No jump suggests a method change. The known 2019–2021 flip (Stavanger, Berlin, 23–35%) is in the old years too.

**Effect on results:**

| Place | 2017→2023 | 2017→2024 |
|---|---|---|
| Ontario Ranch, built | 187.9 ha | 192.5 ha |
| Ontario Ranch, gained | 2.7 ha | 5.5 ha |
| Giga Berlin, built | 160.1 ha | 156.8 ha |
| Stavanger, built | 4.9 ha | 3.6 ha |

**Read speed from here** (one run each):

| Read | AWS | Planetary Computer |
|---|---|---|
| Open + square | 0.6–0.9 s (first open of a session: 1.75 s) | 1.5–2.7 s, plus a 1.5–2.4 s STAC search |

AWS needs no URL signing.

**Can the file be computed from coordinates, skipping STAC?** Yes:
- **Zone:** `floor((lon + 180) / 6) + 1`.
- **Band letter:** from `"CDEFGHJKLMNPQRSTUVWX"[floor((lat + 80) / 8)]`, where X covers 72–84°N.
- **Exceptions:**
  - Norway's `32V` covers 3–12°E (`31V` doesn't exist).
  - Svalbard uses `31X`, `33X`, `35X`, `37X` (`32X`, `34X`, `36X` don't exist).
- **Checked:** `32V`, `33X`, `35X`, `37X`, `33U`, `22X`, `19H`, `01C` exist. `31V`, `31X`, `32X`, `60X` return 404, so a missing file must count as "no data here".
- **Not covered** by MGRS zones: south of 80°S and north of 84°N.

**Existing limitation (also true today):** each file covers one grid zone. A square that straddles a zone boundary reads only one file; the rest is filled with 0 and reported as "no data". Not measured how often this happens.

### Plan: switch to AWS and the newest year (BUILT 2026-11-21, see section 4 "After Phase 2")

1. **Read from AWS instead of Planetary Computer** (`landcover.py`).
   - Build the file URL from the coordinates (`grid_zone(lat, lon)` plus the year).
   - Drop the STAC search and the signing.
   - Keep `read_square` as it is; it already opens a file by URL and reads a window.
2. **The year list:**
   - A constant `YEARS = 2017…2024` in one place.
   - On server start, a quick check (HEAD request) for one file of the year after the last. If it exists, that year is added automatically when Impact Observatory publishes 2025.
   - Per place, a year whose file returns 404 is skipped. The main result compares the first and last year that exist there.
3. **The main result compares 2017 → 2024,** and the slider gets a 2024 stop. All text already takes its years from the answer, so the sentence, small print and tags follow on their own.
4. **Knock-on updates:**
   - The source line ("Impact Observatory annual land cover, 10 m, AWS Open Data")
   - README, the method page brief, and "How this works" mentions of Planetary Computer
   - **Hotspot teasers**, which quote 2017–2023 hectares and must be re-measured
   - Wayback cache keys include the last year (`…_2017_2024`), so the hotspots must be re-warmed (`warm_wayback.py`). The "after" photo is then matched to mid-2024.
5. **Not in this plan:**
   - other land-cover datasets
   - zone-boundary stitching (above)
   - Sentinel-2 `/api/imagery`, which still uses Planetary Computer STAC but is unused
6. **Licence:** Impact Observatory's maps are CC BY 4.0 on Planetary Computer. The licence and attribution wording for the AWS copy and for 2024: not checked; to confirm before switching.

## 8. Git status

- **Branch:** `main`, in sync with `origin/main` (last push `dab77d9`).
- **Uncommitted changes:** none, apart from this new file `docs/STATUS.md` (untracked).

**Last 10 commits:**

| Commit | Message |
|---|---|
| `dab77d9` | Keep the analysis square clear of the scale bar on short screens by lowering the scale bar, not zooming out |
| `ee263d1` | Make the small map lettering readable (11 px on the map, 10 px minimum on phones) |
| `c6aa0bc` | Redraw the map's zoom buttons in the drawing style |
| `4031330` | Say the square is 400 ha, keep the land cover button clear of the label, and focus the result sentence instead of New place |
| `30ddc3c` | Show each change's share of the square, and clarify cleared vs green space lost |
| `7ba18d0` | Answer the archive imagery lookup after about 5 s with the closest photos so far, finishing and saving the full answer in the background |
| `3822346` | Make the dimmed result panel inert while a new area is analysed, so the keyboard can't change it either |
| `2e8ab8b` | Show the analysis steps inside the dashed square, and announce them to screen readers |
| `362e8f0` | Show the imagery lookup as two real loading steps on the globe |
| `602e9a6` | Reveal the result once, with the imagery and before/after swipe ready, instead of swapping the imagery afterwards |
