# Landturned: current state (2026-11-24)

**Live at https://landturned.com** (renamed from Landturn on 2026-11-23; Render's own address landturn.onrender.com also works). Naming rule: "Landturned" in text, lowercase "landturned" only in URLs, file names and code. The Render service `landturn`, its disk `landturn-cache` and the setting `LANDTURN_CACHE_DIR` keep the old name on purpose (see `CLAUDE.md`).

**Deployed 2026-11-23 on Render** from `render.yaml`: one Python web service in Oregon (`0.5c-512mb`, about $7/month) with a 1 GB disk at `/var/data` (`LANDTURN_CACHE_DIR=/var/data/cache`, about $0.25/month); FastAPI serves the built site and `/api`; started by `backend/start.sh` (one process, `GDAL_CACHEMAX=64`); Geoapify key as a Render secret. Hotspots warmed with `cd backend && uv run --no-sync python -m scripts.warm_wayback` in Render's Shell. Live timings (2026-11-23): hotspot result with swipe 4.5-6.3 s (mostly the globe animation), Analyze this area 0.3-2.3 s, a new place's analysis 1.6 s cold / 0.6 s repeat.

A factual snapshot for performance advice. It's based on reading the code and on timings measured on 2026-11-21 (section 4). "Not checked" means I didn't verify it.

**Updated 2026-11-24:** the **long view** is built ("See how it turned since 1985 →": one Landsat photo of the 15 × 15 km square every 5 years, photos only), with its own backend module, a streamed `/api/longview`, a disk cache and pre-made photos for the hotspots (section 8, end).

**Updated 2026-11-23 (later):** the place buttons follow a measured order (`BUTTON_ORDER` in `places.js`), Hidroituango replaced Cajamar, the Geoapify key is locked to Render's servers, and the map now says why the earlier imagery didn't come (section 8, end).

**Updated 2026-11-23:** address search and place names moved from Nominatim (called from the browser) to **Geoapify through our backend** (sections 2, 3, 5 and 8). The timing tables in section 4 were measured with Nominatim and are kept as measured.

**Updated 2026-11-22:** no speed changes since Phase 6. New since then (section 8): the landing hints, the map credits, the full "How this works" page, and American English for all user-facing text. The UI button is now labelled "Analyze this area"; the older sections below keep the name it had when they were written.

**Speed-up phases done:** Phase 1 (quick fixes), Phase 2 (land cover read from AWS, years to 2024), Phase 3 (one analysis request, land-cover disk cache), Phase 4 (reveal sooner; the "after" photo is always the current imagery) Phase 5 (faster before-only archive lookup, zoom-14 cache) and Phase 6 (map limits) on 2026-11-21. The baseline timings stay in section 4, with each phase's re-measurement added below them.

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
| `frontend/src/geocode.js` | Address search and place names, through our backend (`/api/search`, `/api/place-name`); passes on "busy" / "daily-limit" / "unavailable" |
| `frontend/src/globe.js` | D3 landing globe, hotspots, tap-to-pin |
| `frontend/src/results.js` | Result sentence, stats rows, small print |
| `frontend/src/loading.js` | Loading steps and progress bar |
| `frontend/src/places.js` | The 12 hotspots, and `BUTTON_ORDER`: the order of the place buttons |
| `frontend/src/scalebar.js` | Scale bar |
| `frontend/src/longview.js` | The long view: loads the photos as they stream in, shows one year at a time with the analysis square, north arrow and scale bar on the photo, the year scrubber and play button |
| `frontend/how/`, `how.js`, `how.css` | "How this works" page: seven numbered SVG diagrams drawn by `how.js`, plus data and credits (section 8) |
| `backend/app/main.py` | API routes: `/api/health`, `/api/analysis` (since Phase 3; replaces `/api/change` and `/api/timeline`), `/api/wayback`, `/api/imagery`, `/api/longview` (streamed) |
| `backend/app/longview.py` | The long view: Landsat Collection 2 Level-2 search on Planetary Computer, the clearest summer scene per 5-year slot at the place (QA_PIXEL), the 500 × 500 px true-color crop, and its disk cache |
| `backend/app/analysis.py` | Since Phase 3: reads all years in parallel, builds the main result plus every slider comparison, and keeps the land-cover disk cache |
| `backend/app/landcover.py` | Works out the land-cover file from the coordinates (grid zone + year), 200 × 200 px square read, class mapping, comparison, edge cleaning, stats |
| `backend/app/geocoding.py` | Since 2026-11-23: the Geoapify relay: secret key from `backend/.env`, answers saved on disk for all visitors, at most 5 requests/s and 2,900/day for the whole site |
| `backend/app/change_image.py` | Change grid → transparent PNG → base64 data URL |
| `backend/app/wayback.py` | Esri Wayback lookup: which archive versions and photo dates for "before" and "after", with a disk cache |
| `backend/app/imagery.py` | Sentinel-2 photo of the square. **The frontend no longer calls it.** |
| `backend/scripts/warm_wayback.py` | Pre-fills the Wayback cache for the hotspots |
| `backend/scripts/warm_longview.py` | Pre-fills the long view for the hotspots, on this computer or on the live site (`uv run python -m scripts.warm_longview https://landturned.com`) |
| `backend/scripts/longview_test.py` | Draws a place's nine long-view photos side by side as one contact sheet, for checking by eye |
| `backend/scripts/rank_places.py`, `explore_fontana.py`, `method_patch.py` | Dev and analysis scripts, not part of the app |

## 2. Data sources

| Service | Endpoint / pattern | What we request | Called from |
|---|---|---|---|
| **Impact Observatory annual LULC on AWS Open Data** (since Phase 2; CC BY 4.0, bucket `io-10m-annual-lulc`, us-west-2) | `https://io-10m-annual-lulc.s3.amazonaws.com/{zone}_{year}.tif`, e.g. `11S_2024.tif`; the file name is computed from the coordinates (`landcover.grid_zone`), no catalog search | A windowed read of band 1: a **200 × 200 px** (2 × 2 km) square snapped to the file's pixel grid, class codes as uint8; 2017–2024. HEAD requests: one per server start (is a newer year out?), one per grid zone per server run (does the zone have data?) | Backend, `landcover.find_files_by_year`, `read_square`, `newest_year`, `years_in_zone` |
| ~~Microsoft Planetary Computer STAC + Azure COGs~~ | collection `io-lulc-annual-v02` | Used until Phase 2 (2017–2023 only). Its 2023 squares are identical to the AWS files | Not used for land cover any more |
| **Esri World Imagery tiles** (current) | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Raster tiles, max zoom 19. `tileSize` 128 on screens with DPR ≥ 2 (sharper, about 4× the tiles), else 256 | Browser, MapLibre (`map.js`) |
| **Esri World Imagery identify** | `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify` | Capture date of the current photo at the point (layer 0, about 1 km map extent, 400 × 400 display) | Browser, `api.js fetchPhotoDate` |
| **Esri Wayback config** | `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json` | The list of all archive versions (about 170 since 2016) | Backend, `wayback.versions` |
| **Esri Wayback tilemap** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{version}/16/{row}/{col}` | "Which version did this zoom-16 tile last change in?" Small JSON; chained requests walk backwards, since Phase 5 only around the first year (2016–2019) | Backend, `wayback.changed_versions` |
| **Esri Wayback metadata** | `{version metadataLayerUrl}/identify` | Photo capture date, resolution and source at the point (2 km extent, 800 px display), since Phase 5 only for the 4–6 candidate versions around the first year (about 15 before) | Backend, `wayback.photo_in_once` |
| **Esri Wayback tiles** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{version}/{z}/{y}/{x}` | (a) the "after" version as the map's base imagery, through MapLibre; (b) "before" tiles at zoom 16 drawn into a canvas for the swipe | Browser, `map.js setBaseImagery`, `swipe.js buildBeforeImage` |
| **Geoapify geocoding** (since 2026-11-23; free plan: 3,000 credits/day, 5 requests/s; OpenStreetMap data, ODbL) | `https://api.geoapify.com/v1/geocode/search` and `/reverse` | Search: `text`, `limit=1`, `format=json`. Reverse: `type=city`, point rounded to 3 decimals (about 100 m). Key in `backend/.env` (git-ignored) | Backend, `geocoding.py`, via `/api/search` and `/api/place-name` |
| ~~**Nominatim (OpenStreetMap)**~~ | `nominatim.openstreetmap.org` | Used until 2026-11-23 from the browser. Dropped for a public site: its limit of 1 request/s counts for the whole app, and its policy threatens bans for heavy use | Not used any more |
| **Google Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Two font families | Browser, `index.html` |
| **Sentinel-2 L2A** (Planetary Computer) | collection `sentinel-2-l2a` | Bands B04/B03/B02 and SCL, warped to the square's grid, JPEG; the clearest summer image of the requested year | Backend, `imagery.py`, via `/api/imagery?lat&lon&year`. **Unused by the frontend** (a fallback for old Esri imagery was tried and rejected, see section 4) |

## 3. What happens step by step

### a) Search from the landing page, up to the full result

1. **Browser → `/api/search` → Geoapify** (since 2026-11-23; Nominatim before). Sequential; everything else waits for it. A repeated search is answered from the backend's disk memory in a few ms.
2. **These all start at the same moment, in parallel:**
   - **Browser:** the globe turns and zooms (1.6 s animation). MapLibre is downloaded if not yet loaded (lazy import), and the map is created hidden. **Esri current tiles** load.
   - **Browser → Esri identify:** the current photo date.
   - **Browser → `/api/analysis`** (since Phase 3).
     - **First, the cache key:** the backend works out the file names, then the square's position on the zone's grid. Both are instant once the zone is known; the zone facts are saved in `zones.json`, so a zone never seen before pays one HEAD request plus one file-header read, once ever.
     - **Saved square:** it reads the JSON file and is done.
     - **Otherwise:** it reads **all 8 years in parallel**, builds 7 comparisons (2017 → each later year; the last is the main result) with PNGs as data URLs, saves them, and returns them.
   - **Browser → `/api/wayback`** (no years passed). The backend does, in sequence:
     1. Work out the years (no STAC search since Phase 2).
     2. Since Phase 5 it looks up **only the earlier ("before") photo** (`wayback.before_photo`). If the zoom-14 tile is cached: read the JSON file. Otherwise:
        - fetch the version list (memory cache, 24 h)
        - **one tilemap walk** (versions published 2017–2019 plus the change just before; sequential, 2–5 s). Asking all 73 versions of 2016–2019 at once was measured and was not faster (3.9–5.9 s).
        - the 4–6 candidates' photo dates asked **all at once**
        - **Early answer:** the first photo within half a year of 1 July, or after 6 s the closest so far if it's within a year.
        - **Saved answer:** the lookup still waits for every candidate, then saves the **best photo of all**. So the first visitor sees a good photo early, and everyone after gets the best one.
3. **Since Phase 4 the "after" photo is always Esri's current imagery.**
   - It must be from the last land-cover year (2024) or later, and the archive only holds older versions, so nothing newer exists.
   - The map never switches to archive tiles; `setBaseImagery(null)`.
   - The identify date is only used for the imagery line and the swipe's right tag ("LATEST" if it didn't come). Nothing waits for it.
4. **As soon as both answers are in** (`/api/analysis` and `/api/wayback`), in the browser, during the globe turn: the 2017 photo's zoom-16 tiles load (about 25–56, in parallel) and are drawn into a canvas (`startSwipe`).
5. **The reveal** happens when the land-cover answer, the map's tiles (`idle`) and the callout's minimum time are done. It does **not** wait for `/api/wayback`.
   - The change layer is drawn, the map turned grid-up, the panel and the year slider filled, then the crossfade.
   - **If the archive answer is already in** (saved places), the reveal allows up to 1.5 s for the 2017 tiles. When they're ready, the swipe starts at the right edge and the opening sweep plays.
   - **Otherwise:** "FINDING EARLIER IMAGERY…" shows inside the square (no year: the archive's closest photo to 2017 can be a few years either side). When the earlier photo is ready, the swipe is added at the left edge and glides to the middle, and screen readers hear "Earlier imagery added". (Until 2026-11-21 it said "FINDING 2017 IMAGERY…".) The base photo is never replaced.

The 2017 photo races a **40 s deadline** counted from the place being chosen. If it's hit, the tag disappears and the result has no swipe.

### b) "Analyse this area" after panning

1. **Head start:** once the map has been still for **0.5 s** (1.5 s before Phase 1) (counted from MapLibre `moveend`, so after inertia) with the offer visible, the browser sends `/api/wayback` for the map centre and throws the answer away. The backend shares a running lookup per tile, so a later request joins it.
2. **On press, in parallel:**
   - place name: `/api/place-name` → Geoapify (Nominatim before 2026-11-23)
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
  - Unexplained at the time: the button's own `/api/wayback` request finished 1.7 s after the head-start request it should have joined. **Re-checked in Phase 5:** both now finish at the same moment, probably because the per-request STAC search (removed in Phase 2) ran before a request could join.

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

### After Phase 5 (before-only archive lookup, early answer + best answer saved, zoom-14 cache)

**The lookup on its own** (Python, 9 places, first lookup; the old full answers were saved by Phase 4):
- before the change: 3.8–64 s
- **after: 2.6–9.8 s**
- **the same 2017 photo as the old full answer at all 9**

**Two rejected variants, measured on the way:**
- **"Ask the likeliest 2–3 versions first".**
  - **What happened:** which archive services are slow (12–60 s) has nothing to do with which one holds the right photo; e.g. Cajamar's likeliest version took 12.6 s to answer.
  - **Why it was dropped:** waiting for whole rounds cost up to 64 s.
- **"Take the closest photo after 6 s and save it".**
  - **What happened:** three hotspots got photos 4–6 years off (Renaissance Dam Dec 2011 instead of Feb 2016, Weda Bay Apr 2012 instead of Apr 2018, Hasankeyf Jan 2011 at 2.5 m instead of Jun 2013 at 0.5 m), and Fontana's saved photo became Aug 2016 instead of Aug 2017.
  - **The fix:** answer early, but save the best of all.

**Hotspots re-warmed** under the new key: 33 s for all 11. The saved photos match the original full answers at all 11.

**Neighbour sharing:** a second spot inside the same zoom-14 tile (2.0 km wide near Ontario) answered in **6 ms**.

**App runs** (same setup, the two places' saved answers deleted, server restarted; single runs; times from pressing Enter):

| | Fontana cold | Fontana warm | Stavanger cold | Stavanger warm |
|---|---|---|---|---|
| `/api/wayback` | 6.5 s (Phase 4: 10.2 s) | 0.08 s | 9.7 s (8.6 s) | 0.08 s |
| Result shown | 4.9 s | 5.0 s | 4.6 s | 5.1 s |
| **Swipe joins** | **9.3 s** (12.8 s) | at the reveal | **13.7 s** (12.6 s) | at the reveal |
| 2017 photo | 6 Aug 2017 | 6 Aug 2017 | 27 May 2018 | 27 May 2018 |

Esri's archive services vary a lot from run to run, so single-run differences of a few seconds aren't meaningful. The reliable gains:
- a third as many questions (one walk, 4–6 photo dates)
- no 60 s waits
- neighbours sharing answers

**"Analyse this area" with the head start:** the result appeared 1.2 s after the press. The head-start and button requests for `/api/wayback` finished together at 7.52 s.

**Also in this round:** a hint **"◀ DRAG LEFT FOR LAND COVER"** inside the square's bottom-left corner.
- It's shown once the handle rests away from the left edge (after the opening or a late swipe).
- It's hidden while the colours show, and gone for the visit once someone brings the handle to the left edge themselves.
- It's drawn above the handle's line.

### Phase 6 (map limits)

**Zoom range 12–17** (`MIN_ZOOM`, `MAX_ZOOM` in `map.js`; was 10 to unlimited).
- MapLibre disables the zoom button that can't go further, and our style fades it (checked at both limits, desktop and phone size). Phones pinch-zoom within the same range.
- **At zoom 12** the square is 127 px across (Ontario's latitude):
  - The 44 px handle and its grip fit, and "Hide land cover" sits below the square.
  - The "ANALYSIS AREA · 2 × 2 KM · 400 HA" label is wider than the square and reaches the screen edge on a 390 px phone; it could be cut off on narrower phones (not checked).
- **At zoom 17** the square is about 4,000 px across, so its label and "Hide land cover" are off-screen until people pan or zoom out. Nothing breaks.

**Pan box: 10 km around the searched address** (`maxBounds`, `EXPLORE_RADIUS_M = 10000`, a 20 × 20 km box).
- A new search (or globe pick) moves the box; checked by searching Stavanger after Ontario Ranch in the same visit. "Analyse this area" doesn't move it.
- **"Search another address to explore further."** appears top-centre while the visible map touches the box (within 0.5% of its width), and hides when panning back. Screen readers announce it (`role="status"`).
  - At the opening zoom it appeared after about 6 km of panning west (desktop and phone).
- **Not checked:** on very wide screens near the equator, the zoom-12 view (about 19 m per pixel) can be wider than 20 km. MapLibre then zooms in to keep the view inside the box, so the effective minimum zoom there is a little above 12.
- This replaces the earlier "no pan limit" rule, at the user's request.

**Tile size on sharp screens (DPR 2), measured, not changed:**

| | 128 (current) | 256 |
|---|---|---|
| Desktop 1400 × 900: Esri tiles | 99 (zoom 17) | 30 (zoom 16) |
| Desktop: data | 1.8 MB | 0.6 MB |
| Desktop: last tile | 6.9 s | 3.7 s |
| Desktop: result shown | 8.3 s | 5.5 s (the reveal waits for the map's tiles) |
| Phone 390 × 844: Esri tiles | 16 | 4 |
| Phone: result shown | 4.1 s | 4.5 s |

- **Sharpness:** same crops, plain photo, full resolution. At 128 roof vents, trucks and cars are visible; at 256 they're soft.
- **Kept at 128** pending the user's choice: crisp imagery is a project rule.

**Fontana and Stavanger runs:** the analysis, archive and reveal paths didn't change in Phase 6, so the Phase 5 timings still apply.

**After Phase 6 (user feedback):**
- **Outside the square:** dimmed a bit more (`OUTSIDE_DIM` 0.55 → 0.65).
- **Map labels:** solid near-black backings instead of 70–85% see-through (area label, year tags, "Hide land cover", "Analyse this area", hint, edge message). The scale bar and credit stay see-through.
- **The draggable dashed square.**
  - **The problem:** zoomed out, the 10 km box holds the whole view, so the screen centre (where the dashed square sat) could only move about 2 km sideways. Spots visible to the left or right of the result couldn't be analysed.
  - **Now, while panning:** the dashed square follows the centre, as before.
  - **While zooming:** it stays on its ground spot.
  - **Zoomed out** (result square under 40% of the map's width): it appears next to the result on its own, measured on screen so it clears the result's label (right, else below, left, above). It's re-placed on every move until grabbed.
  - **Dragging:** an off-white grip with a four-way arrow (44 px touch area; arrow keys move it 400 m). It can't leave the screen or the 10 km box. Dropped on the result, the offer goes (zoomed out, it comes back beside the result). Panned off-screen, it returns to the centre.
  - **"Analyse this area"** analyses the dashed square's spot (`getAnalyseSpot`). The head start begins on release.
  - **Tested:** desktop, zoomed fully out, dragged to the top-left of the view and analysed → 34.0195° N, 117.6462° W (about 5 km north-west of Ontario Ranch). Arrow keys moved it 50 px. No overlaps with the result's label on desktop or phone. No page errors.
  - **Phone at zoom 12 (fixed):** the "below" spot now leaves room for both "Hide land cover" and the dashed square's own button (66 px gap), and no dashed square may reach lower than 6 px above the scale bar. On a 390 × 844 phone the dashed square now appears above the result.
  - **Analysing near the box's edge (fixed):** a dashed square's centre is held inside a "safe box": the 10 km box shrunk by 1 km plus the room around a framed result (worked out from the map's height) plus 200 m, the same distance on all four sides (user's choice). So a new result near the edge is framed fully, and its label (top) and "Hide land cover" (bottom) are no longer cut off. Tested at the north and south edges on phone and desktop. The edge message no longer shows right after such a result.
  - **Edge message only on people's own moves:** with equal margins, a wide desktop view can just reach the box's side after a new result. The message now changes only on moves people make (MapLibre's `originalEvent`), and a new result hides it.
  - **"Analyse this area" at the right edge (fixed):** the button no longer runs off the map when the dashed square is dragged to the far right.
  - **Done 2026-11-22:** the "How this works" page's diagram 07 shows the 20 × 20 km box and the limit for the dashed square's centre.
  - **Edge message vs "Analyse this area" (fixed):** while "Search another address to explore further." shows, a dragged dashed square stops below it, with room for its button, and the button is pushed below the message if they would overlap.
  - **Zoomed out, the centre square under the result (fixed):** when zoomed out (or held back at the edge), a centre-following square that would run into the result's labels is replaced by the beside-the-result placement.
- **The "drag left for land cover" hint** hides while it's wider than the result's square (zoomed far out).

## 5. Loading and caching

**Preloaded:**
- **Long view:** `warm_longview.py` makes the hotspots' Landsat photos in advance; after a deploy it's run against the live site (it asks `/api/longview` like a browser does).
- **Hotspots:** `warm_wayback.py` pre-fills the Wayback cache for the hotspots. Run on the server at deploy (2026-11-23). Hidroituango, added later, was filled by visiting it on the live site.
- **Head start:** `/api/wayback` starts 0.5 s after the "Analyse this area" offer has settled.
- **Map during the globe turn:** MapLibre and the map start loading while the globe turns.
- **Parallel start:** all first-wave requests start at once when a place is chosen.
- **Fonts:** Google Fonts preconnect.

**Backend caches:**

| What | Where | Key | Lifetime |
|---|---|---|---|
| Wayback answer (the earlier photo: date, source, resolution, tile URL) | Disk: `backend/cache/wayback/z14_*.json` | Since Phase 5 `z14_{row}_{col}_{firstYear}`: the zoom-14 Web Mercator tile (about 2.4 km at the equator, 2.0 km near Ontario, 1.2 km in Norway) plus the first year, so neighbouring squares share it. The photo is the one at the first lookup's point; at a few spots another patch of the photo mosaic shows at the exact centre | Forever. The best photo of all candidates is saved, even when an early answer was shown first |
| Geoapify answers (search and place names) | Disk: `backend/cache/geocoding/{hash}.json`, plus today's request count in `usage.json` | Search: the text, lower-case, spaces tidied. Place name: the point rounded to 3 decimals | Forever (failed requests aren't saved). The count restarts each UTC day |
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
- **Zoom:** 12–17 since Phase 6 (was `minZoom` 10, no `maxZoom`); the imagery source's `maxzoom` is 19.
- **Pan:** since Phase 6 a 20 × 20 km box (10 km each way) around the searched address (`maxBounds`). A new search moves it; "Analyse this area" doesn't.
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
- **Tags** show the photo's own date, in American order since 2026-11-22 (for example "2017 · OCT 21"; Stavanger's "before" is 27 May 2018). The small print's dates read "May 23, 2026".

**Timeouts and limits:**
- 40 s imagery limit (frontend)
- 30 s per Esri request (backend)
- 8 s map idle wait
- Wayback early answer: the first photo within 183 days of 1 July, or after 6 s the closest within 365 days (the best of all is saved)
- 3 s Esri identify (photo date) timeout, never waited on
- 0.5 s head-start settle time

## 7. Known problems and unfinished work

**Performance and robustness:**
- ~~**The Esri identify call has no timeout.**~~ Fixed in Phase 1: a 3 s timeout, and nothing waits for it.
- ~~**`/api/wayback` runs a STAC search on every call.**~~ Fixed in Phase 2: no STAC search; a cached answer now takes 0.08 s.
- **Places with old Esri imagery** (about 4 in 10 random land points): no sharp photo from the last land-cover year exists. The panel shows an "OLDER SATELLITE PHOTO" disclaimer, and the swipe is hidden when its photos are under 2 years apart.
- ~~**Weda Bay hotspot, decision pending.**~~ Decided (commit `4f1f0ad`): Weda Bay is orange, "94 ha built", and Kīlauea's 2018 lava (77.7 ha cleared) is the red place.
- **Old Wayback cache files:** the 117 files keyed `z16_…` (Phase 2–4 keys, incl. 70 keyed `…_2017_2023`) in `backend/cache/wayback/` are no longer used and could be deleted.
- ~~**`/api/change` reads its two years one after the other; nothing cached.**~~ Fixed in Phase 3: all years in parallel, saved on disk.
- ~~**`/api/timeline` starts only after the reveal.**~~ Fixed in Phase 3: merged into `/api/analysis`.
- ~~**After a server restart, the first request per grid zone costs about 1.3 s.**~~ Fixed in the Phase 3 follow-up: zone facts are saved in `zones.json`. Measured right after a restart: Fontana 0.012 s, Bergen 0.002 s. Only a zone never seen before pays once: Stavanger 1.6 s, because its zone had been deleted for the test.
- **A cold Wayback lookup takes 12–15 s,** mostly sequential tilemap steps and slow Esri metadata services. Only hotspots are pre-warmed.
  - **Slow days:** on 2026-11-23 most of Esri's photo-date questions hit the 30 s limit (New Capital and Ontario Ranch), so a new spot's earlier photo took 30 s or more (the backend asks twice, so up to about 65 s). A plain `query` on one metadata layer was no faster (1–24 s). The page now waits up to 2 minutes for it (was 40 s).
- ~~**The reveal waits for all archive tiles.**~~ Fixed in Phase 4: the reveal waits for neither the archive answer nor its tiles; only the 2017 photo's tiles load (25–56), for the swipe.
- ~~**The backend still finds an archive "after" photo.**~~ Dropped in Phase 5.
- **The head start only helps** if the user waits at least 0.5 s after the map stops moving (including its glide); before Phase 1 it was 1.5 s.
- ~~**Nominatim usage policy.**~~ Solved 2026-11-23 by switching to Geoapify through the backend (one shared limit, shared memory, key kept on the server).
- ~~**Geoapify key.**~~ Done 2026-11-23: a fresh key is the Render secret, and it only works from Render's Oregon outbound ranges (`74.220.48.0/24`, `74.220.56.0/24`, entered as two regex IP filters in Geoapify's dashboard). Tested live: new searches and place names still work. Render's ranges are shared with other Render services in that region. Local development needs its own unrestricted key in `backend/.env`.

**Data quality:**
- Impact Observatory labels flicker between years at quiet rural spots, giving implausible colours. A "change must persist two years" filter is parked.
- Some places have no archive photo within a year of 2017; the tag then shows the real year (for example 2014 in London).

**Unused code:**
- `/api/imagery` (Sentinel-2) and its cache: no longer called by the frontend.
- `glideToMiddle` in `map.js`: exported but no longer called.

**Unfinished:**
- ~~**Landing hints.**~~ Built (`4f1f0ad`, `b3c1452`): a colour key and the caption "Pick any spot on land to see how it turned."
- ~~"How this works" page: skeleton and data only.~~ Built 2026-11-22 (section 8).
- ~~The long view~~ built 2026-11-24, as photos only (section 8, end). Not built yet: measured land cover for 1985–2016 (GLC_FCS30D, maybe later), the share screen, and the "new construction sites" stat.
- **No production deployment or build** has been checked.

## 8. Since the speed-up phases (2026-11-21 to 2026-11-22)

None of this changes request flow or timings.

**Landing** (`4f1f0ad`, `b3c1452`):
- a colour key: one dimmed line on desktop, under the globe on phones
- the caption "Pick any spot on land to see how it turned."
- a water note for taps on the sea
- Kīlauea is the red place, and Weda Bay turned orange

**Credits** (`15adc2d`):
- the map credit reads "Powered by Esri · Imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community"
- a visible Nominatim / OpenStreetMap credit under the search box and in the result's small print
- short phones keep the result panel at least 330 px tall

**"How this works" page** (`/how/`; `ae549ef` to `1b74753`).
- **How it's drawn:** seven numbered plates, each an SVG drawn by `how.js`, so the drawings follow the app's own rules.
- **Shared logic:** `changeType` is the JS copy of the backend's `compare()`. The edge-cleaning diagram runs the same 3 × 3 opening as `remove_thin_changes`, checked against the backend: 36 changed pixels in, 20 out.
- **Live years:** the years come from a new `/api/years`.

| Plate | Shows |
|---|---|
| 01 | From address to answer: six steps |
| 02 | The square, in pixels: 2 km → 200 × 200 pixels → one 10 m pixel |
| 03 | Impact Observatory's 9 classes merged into our 5, plus "no data", with a muted land-cover palette (`--lc-*` in `tokens.css`) |
| 04 | Which color a change gets: four before/after 4 × 4 pixel-grid cards, plus a "No color" line and the "green space lost" callout |
| 05 | Cleaning the edges: raw → shrink → grow back, with pixel counts computed from the grids |
| 06 | Why it's an estimate: wrong labels (Impact Observatory's published "over 75%" average accuracy, linked to the AWS Registry page), fuzzy edges, clouds, 10 m pixels, photo vs map dates |
| 07 | Where you can look: the 20 × 20 km box, the dashed square, and the limit for its centre |

Then a "Data and credits" section.

**American English** (`3eeb60b`, 2026-11-22):
- **Spelling:** all user-facing text, including screen-reader labels, uses American spelling: color, analyze, meter, center, labeled, neighborhood, anymore.
- **Dates:** in American order, "May 23, 2026" and "2017 · OCT 21". The `toLocaleDateString` calls in `results.js` and `swipe.js` now use `en-US`.
- **Not renamed:** code names such as `analyse-area`, `colours-toggle` and `coloursOn`, and code comments.
- **The rule** is in `CLAUDE.md`.

**`CLAUDE.md`** (`6ab79d6`): the data-eras table now names AWS as the land-cover source (2017–2024).

**Credits and caption** (`1ee87e6`, `0e41e6b`, 2026-11-22): the OpenStreetMap credit left the landing page; the globe caption got its survey-mark icon and fade; hotspot rings stop short of the caption; the phone panel minimum is 290 px.

**Address search through Geoapify** (2026-11-23).
- **Why:** Nominatim allows 1 request/s for the whole app, so a public launch could get the site banned; a queue in front of it would make visitors wait at busy moments.
- **How:** the browser asks `/api/search` and `/api/place-name`; `backend/app/geocoding.py` asks Geoapify with the key from `backend/.env`, saves every answer on disk for all visitors, spaces requests 0.2 s apart (5/s), answers "busy" if a visitor would wait over 3 s, and stops at 2,900 requests per UTC day ("daily-limit"). The search shows a message for each.
- **Tested:** with a pretend Geoapify, 12 searches at once were all answered 0.2 s apart; 25 at once gave 16 answers and 9 immediate "busy"; the daily limit stops new searches while saved answers still work. With the real key: Fontana 2.3 s, place name 1.2 s, the repeat 0.006 s; Stavanger named; open ocean gives no name. The browser sends no requests to Nominatim or Geoapify.
- **Credits** (Geoapify's free plan and OpenStreetMap both require one near the information, not only on a credits page): "Place names: Geoapify · © OpenStreetMap contributors" in the result's small print; the How page's "Data and credits"; nothing on the landing page; the map's credit line names only the imagery.
- **Cost:** free plan. Next step if the site gets busy: Geoapify's paid plan (about $59/month for 10,000 requests/day, checked 2026-11-23).

**Hotspot button order** (`360c188`, `2fcb3a0`, `cd5cd41`, 2026-11-23).
- **Why:** on a phone only the first two or three place buttons show without scrolling, so the strongest examples go first.
- **How it was ranked:** every hotspot measured with the app's own analysis (first vs last year, its 2 × 2 km square). Score = changed share of the square × how much one change type dominates × how much of it sits in solid patches of 1 ha or more × (1 − no-data share), minus a penalty for label flicker (a pixel's label changes in a middle year and back). Then each before/after swipe was checked by eye; Weda Bay moved down (scattered colors, hazy photo).
- **Order:** New Capital, Giga Texas, Ho Chi Minh City, Renaissance Dam, Hasankeyf, Giga Berlin, Ontario Ranch, Hidroituango, Western Sydney, Kīlauea, Marker Wadden, Weda Bay. It lives in one list, `BUTTON_ORDER` in `places.js`; a place missing from it still gets a button, at the end. The globe's dots don't depend on it.
- **Hidroituango replaced Cajamar** (only 14% of its square changed). Hidroituango, Colombia: forested Cauca canyon → reservoir, 167.9 ha new water, at 7.0824, -75.7389. The user picked that square by eye: its 2018 "before" photo shows green forest, while the script's best square (150.5 ha) showed flood mud. The 10 other South American candidates tested are in `rank_places.py` (Chancay: a third no data; Añelo: scattered blobs, green on bare desert).
- **Kept:** Weda Bay (user's choice); Kīlauea, the only red place.

**When the earlier imagery doesn't come** (`efbda37`, 2026-11-23).
- **Before:** after 40 s the "FINDING EARLIER IMAGERY…" label just vanished, which looked like a bug.
- **Now:** the page waits up to 2 minutes. If no earlier photo comes, the label says why for 5 s without its pulse: "EARLIER IMAGERY TOOK TOO LONG" (time ran out) or "NO EARLIER IMAGERY HERE" (none found, or under 2 years older than the current photo). Screen readers hear the same. A new place or analysis removes it at once.
- **Tested:** in the dev app with a faked archive (never answers / answers "none"), desktop and 390 px phone: right message, gone after 5 s, no page errors.

**The long view** (branch `long-view`, 2026-11-23 to 24; merged 2026-11-24).
- **What people see:** "See how it turned since 1985 →" under the result sentence. The photo takes the map's place on the stage (the map stays underneath, untouched and inert) and the panel switches to the long view's: the year scrubber (’85 to ’25) with a play button, a title block ("Photos only · 30 m · not measured", area, season, source), and small print with the USGS credit. It plays once from 1985 on opening (not with reduced motion). "← Back to map", Escape and the browser's Back button close it (a `view=long` history step).
- **Data:** Landsat Collection 2 Level-2 on Planetary Computer (`landsat-c2-l2`): Landsat 5, 8 and 9, and Landsat 7 only before its 31 May 2003 fault; **Tier 1 only** (a Tier 2 Stavanger scene was 50 km off). Summer only (May–Sep north, Nov–Mar south, any month in the tropics).
- **Choosing the photo:** for each slot (1985, 1990 … 2025) the slot year first, then ±1 and ±2 years. In each year the 8 least-cloudy scenes are checked at the place itself with QA_PIXEL (no data, near cloud, cirrus, cloud, shadow); "clear" = at most 2% of the square hidden. The main WRS-2 path/row is the one whose scenes are centered closest to the place. Without any clear scene, the least hidden one is used.
- **Photos as delivered:** pixels are copied unchanged (nearest) when the scene's UTM zone matches the square's; only the app's fixed display stretch is applied. Tried and **dropped** (user's rule: photos as is, fast, any location): a haze score and a Landsat 8/9 blue-color fix. So some frames show haze, and Landsat 8/9 frames show a few yellow specks next to bright roofs (from USGS's own processing).
- **Speed:** catalog searches ask only for the slot year's summer, filter Tier 1 / satellite / cloud on the server and ask only for the fields used (12 s → about 3 s); a stuck search gets a backup request after 6 s; the nine slots run at the same time. The answer is streamed (one line per photo), so the panel shows real progress.
- **Cache:** `cache/longview/<lat>_<lon>/<slot>.jpg` + `.json`, center rounded to 0.01° (about 1 km), so nearby addresses share; about 600 KB per place (about 1,500 places on the 1 GB disk). Old slots are kept forever; a slot reaching the present (2025) is remade after 30 days; a missing slot isn't saved.

| Measured (dev, 2026-11-24) | Time |
|---|---|
| A place seen before | 0.1 s backend, under 1 s in the browser |
| A new place | 13–25 s (Planetary Computer's catalog sometimes stalls; before the backup request: 34–59 s) |
| All 12 hotspots warmed, 3 at a time | 93 s |

- **Hotspots:** 10 of 12 have all nine years. Kīlauea has 6 (no scene at all near 1985, 1995 and 2010; its 2000 slot is a 1999 photo 24% under cloud) and Weda Bay 7, both cloudy tropical places; the panel says when a year has no photo.

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

## 9. Git status

- **Branch:** `main`, in sync with `origin/main` (last push: this update, 2026-11-23).
- **Uncommitted changes:** none, apart from this update to `docs/STATUS.md`.

**Last 10 commits:**

| Commit | Message |
|---|---|
| `3eeb60b` | American English for all user-facing text and dates in American order; CLAUDE.md rule |
| `6ab79d6` | CLAUDE.md: land cover is read from the AWS Registry of Open Data (2017–2024), not Planetary Computer |
| `1b74753` | How this works: diagram 07, where you can look; plate 06 tweaks (3 × 3 mislabelled field, published accuracy with source link) |
| `3a1f422` | How this works: diagram 06, why it's an estimate |
| `0e3a573` | How this works: diagram 05, cleaning the edges, worked out with the backend's 3 × 3 opening |
| `aa88a6e` | How this works: diagram 04 as example cards with before/after pixel grids; land-cover category palette |
| `2527b94` | How this works: diagram 03, Impact Observatory's 9 classes merged into our 5 |
| `15adc2d` | Credits: "Powered by Esri" and Vantor on the map; visible OpenStreetMap/Nominatim credit; short phones keep the panel at least 330 px tall |
| `ae549ef` | How this works: diagrams 01 (address to answer) and 02 (the square, in pixels) |
| `b3c1452` | Calmer landing: globe caption, one-line key on desktop, water note for sea taps, bigger globe on phones |
