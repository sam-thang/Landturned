# Landturn: current state (2026-11-21)

A factual snapshot for performance advice. It's based on reading the code and on timings measured on 2026-11-21 (section 4). "Not checked" means I didn't verify it.

**Speed-up phases done:** Phase 1 (quick fixes) on 2026-11-21. The baseline timings stay in section 4, with each phase's re-measurement added below them.

## 1. Stack and structure

**Frontend:** Vite 8 dev server and bundler, plain JavaScript (ES modules), no framework.
- **MapLibre GL JS 6.18:** the satellite map. It's lazy-loaded the first time a place is chosen.
- **D3 7** with **topojson-client** and **world-atlas** (`land-50m.json`, bundled): the landing globe, drawn on a canvas.
- **`@vitejs/plugin-basic-ssl`:** HTTPS dev server, needed for geolocation on phones.
- **Fonts:** Space Grotesk and JetBrains Mono from Google Fonts.

**Backend:** Python 3.13, FastAPI with Uvicorn, managed with uv.
- **pystac-client** and **planetary-computer:** STAC search and URL signing.
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
| `frontend/src/api.js` | Calls to our backend (`/api/change`, `/api/timeline`, `/api/wayback`) and to Esri's identify service |
| `frontend/src/geocode.js` | Nominatim search and reverse geocoding |
| `frontend/src/globe.js` | D3 landing globe, hotspots, tap-to-pin |
| `frontend/src/results.js` | Result sentence, stats rows, small print |
| `frontend/src/loading.js` | Loading steps and progress bar |
| `frontend/src/places.js` | The 11 hotspots |
| `frontend/src/scalebar.js` | Scale bar |
| `frontend/how/`, `how.js`, `how.css` | "How this works" page, partly built |
| `backend/app/main.py` | API routes: `/api/health`, `/api/change`, `/api/timeline`, `/api/wayback`, `/api/imagery` |
| `backend/app/landcover.py` | STAC search, 200 × 200 px square read, class mapping, comparison, edge cleaning, stats |
| `backend/app/change_image.py` | Change grid → transparent PNG → base64 data URL |
| `backend/app/wayback.py` | Esri Wayback lookup: which archive versions and photo dates for "before" and "after", with a disk cache |
| `backend/app/imagery.py` | Sentinel-2 photo of the square. **The frontend no longer calls it.** |
| `backend/scripts/warm_wayback.py` | Pre-fills the Wayback cache for the 11 hotspots |
| `backend/scripts/rank_places.py`, `explore_fontana.py`, `method_patch.py` | Dev and analysis scripts, not part of the app |

## 2. Data sources

| Service | Endpoint / pattern | What we request | Called from |
|---|---|---|---|
| **Microsoft Planetary Computer STAC** | `https://planetarycomputer.microsoft.com/api/stac/v1`, collection `io-lulc-annual-v02` | Point-intersects search: every annual item covering the point (2017–2023 today) | Backend, `landcover.find_items_by_year` |
| **Impact Observatory annual LULC** (COGs on Azure Blob, signed URLs) | Item asset `data` (GeoTIFF, UTM, 10 m) | A windowed read of band 1: a **200 × 200 px** (2 × 2 km) square snapped to the file's pixel grid, class codes as uint8 | Backend, `landcover.read_square` |
| **Esri World Imagery tiles** (current) | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Raster tiles, max zoom 19. `tileSize` 128 on screens with DPR ≥ 2 (sharper, about 4× the tiles), else 256 | Browser, MapLibre (`map.js`) |
| **Esri World Imagery identify** | `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify` | Capture date of the current photo at the point (layer 0, about 1 km map extent, 400 × 400 display) | Browser, `api.js fetchPhotoDate` |
| **Esri Wayback config** | `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json` | The list of all archive versions (about 170 since 2016) | Backend, `wayback.versions` |
| **Esri Wayback tilemap** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{version}/16/{row}/{col}` | "Which version did this zoom-16 tile last change in?" Small JSON; chained requests walk backwards | Backend, `wayback.changed_versions` |
| **Esri Wayback metadata** | `{version metadataLayerUrl}/identify` | Photo capture date, resolution and source at the point (2 km extent, 800 px display), for about 15 candidate versions | Backend, `wayback.photo_in_once` |
| **Esri Wayback tiles** | `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{version}/{z}/{y}/{x}` | (a) the "after" version as the map's base imagery, through MapLibre; (b) "before" tiles at zoom 16 drawn into a canvas for the swipe | Browser, `map.js setBaseImagery`, `swipe.js buildBeforeImage` |
| **Nominatim (OpenStreetMap)** | `https://nominatim.openstreetmap.org/search` and `/reverse` | Search: `q`, `format=jsonv2`, `limit=1`. Reverse: `zoom=10` (city level) | Browser, `geocode.js` |
| **Google Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Two font families | Browser, `index.html` |
| **Sentinel-2 L2A** (Planetary Computer) | collection `sentinel-2-l2a` | Bands B04/B03/B02 and SCL, warped to the square's grid, JPEG | Backend, `imagery.py`. **Unused by the frontend.** |

## 3. What happens step by step

### a) Search from the landing page, up to the full result

1. **Browser → Nominatim search.** Sequential; everything else waits for it.
2. **These all start at the same moment, in parallel:**
   - **Browser:** the globe turns and zooms (1.6 s animation). MapLibre is downloaded if not yet loaded (lazy import), and the map is created hidden. **Esri current tiles** load.
   - **Browser → Esri identify:** the current photo date.
   - **Browser → `/api/change`.** The backend does, **in sequence**: STAC search, then read the first year's square, then read the last year's square, then compare, clean, compute stats and encode the PNG. It returns JSON with the PNG as a data URL.
   - **Browser → `/api/wayback`** (no years passed). The backend does, in sequence:
     1. STAC search, to learn the years.
     2. If the tile is cached: read the JSON file. Otherwise:
        - fetch the version list (memory cache, 24 h)
        - **two tilemap walks in parallel** (2017 window and 2023 window; each walk is sequential)
        - about 15 metadata identify calls **in parallel** (32 workers)
        - a **quick answer after about 5 s** (only if each year has a photo within 365 days of 1 July); the full answer finishes in the background and is saved
3. **When the Wayback answer arrives,** the frontend picks the "after" photo (`closerAfter`), using the identify date **only if it has already arrived**. Since Phase 1 nothing waits for identify; it gives up after 3 s. Without a date, the imagery line uses its dateless wording, and the swipe's right tag reads "LATEST" if the current imagery is the "after" photo.
4. **Browser:**
   - switches the base imagery to the archive "after" version (Esri Wayback tiles)
   - builds the 2017 canvas from about 25 zoom-16 Wayback tiles, all requested in parallel
   - waits for the map to be `idle`
5. **Browser:** draws the change layer, turns the map grid-up, adds the swipe at the right edge, fills the panel, crossfades from the globe, then plays the opening sweep (about 5.5 s of animation).
6. **Browser → `/api/timeline`.** This starts only after the reveal. The backend runs a STAC search, then reads **all 7 years in parallel** (7 COG windows), compares 2017 with each later year, and returns 6 answers including PNGs. The slider is greyed out until it arrives.

All imagery waits race a single **40 s deadline**. If it's hit, the result shows on current imagery with no swipe.

### b) "Analyse this area" after panning

1. **Head start:** once the map has been still for **0.5 s** (1.5 s before Phase 1) (counted from MapLibre `moveend`, so after inertia) with the offer visible, the browser sends `/api/wayback` for the map centre and throws the answer away. The backend shares a running lookup per tile, so a later request joins it.
2. **On press, in parallel:**
   - Nominatim reverse geocode
   - Esri identify
   - `/api/wayback`
   - `/api/change`
3. The same sequence as (a) steps 3–6, but **no globe and no map creation**. The old result stays dimmed until everything is ready, then switches at once.

### c) Moving the year slider

- **No network.** All years come from the one `/api/timeline` answer held in memory.
- On each `input` event it swaps the change PNG (`setUrl`) and re-renders the stats. Measured: under 1 ms to handle.
- The colour on/off filter re-processes the PNG on a canvas (`getImageData`) in the browser.
- It also sends the swipe handle back to the left edge.

### d) Before/after swipe imagery

- **"After" (right side):** the map's base raster source is switched to the chosen Wayback version's tile URL. MapLibre loads its tiles. If Esri's current photo is closer to mid-2023, there's no switch.
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
| **STAC search results** | **Not cached** | — | Repeated by `/api/change`, `/api/wayback` and `/api/timeline` for the same place (3 searches per place) |
| **Land-cover squares, change answers, timeline** | **Not cached** | — | Recomputed on every request; `/api/timeline` re-reads the 2 years `/api/change` just read |

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
- Every year the STAC search returns for the point: **2017–2023** for both test places (collection `io-lulc-annual-v02` ends at 2023).
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
- **`/api/wayback` is called without `from`/`to`,** so every call runs a STAC search, even when the answer is cached (about 1.5–2.4 s).
- **The same STAC search runs up to 3 times per place.** Results aren't cached.
- **`/api/change` reads its two years one after the other,** not in parallel. Nothing is cached, so repeat visits recompute.
- **`/api/timeline` starts only after the reveal** and re-reads all 7 years, including the 2 `/api/change` already read. The slider stays greyed out 3–5 s after the result.
- **A cold Wayback lookup takes 12–15 s,** mostly sequential tilemap steps and slow Esri metadata services. Only hotspots are pre-warmed.
- **The reveal waits for all archive tiles** (55–106 requests, 3–5 s), even on warm visits.
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

### Plan: switch to AWS and the newest year (not built; waiting for OK)

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
