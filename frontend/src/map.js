// The detailed satellite map (MapLibre). MapLibre is large (about 1 MB), so it is only downloaded
// the first time a place is chosen, not when the landing page opens.

// The address of MapLibre's "worker" script (a helper that processes map data in the background).
// "?url" asks Vite for the file's address instead of its code, and makes Vite include the file in the build.
// MapLibre can't find this file on its own once Vite has repackaged MapLibre, so we tell it (see setWorkerUrl below).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
// Bring in the function that redraws the scale bar, from scalebar.js
import { updateScaleBar } from './scalebar.js';

// The web address pattern for Esri's satellite image tiles: the sharp photo the map shows by default.
// {z} = zoom level, {y} = tile row, {x} = tile column. Note: Esri puts y before x.
// Its photos are recent and often taken in a different year than the land-cover maps, so the change colours won't
// line up perfectly with it (the result's small print says so).
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// How big MapLibre should treat each satellite tile, in CSS pixels. Sharp screens (phones, "Retina" laptops) have 2 or more
// physical pixels per CSS pixel ("device pixel ratio"). Telling MapLibre the tiles are 128 instead of 256 makes it load tiles
// one zoom level more detailed for the same view: sharper imagery, at the cost of about 4 times as many tiles.
const TILE_SIZE = window.devicePixelRatio >= 2 ? 128 : 256; // "? :" picks 128 if the ratio is 2 or more, otherwise 256
// The map's background colour where no tiles have loaded yet: the page's near-black (Night Sheet, --bg in tokens.css).
const SHEET_COLOR = '#0a0c0f';
// The analysis area: everything within 1 km (1000 m) of the address
const RADIUS_METERS = 1000;
// How many meters one degree of latitude covers (about the same everywhere on Earth)
const METERS_PER_DEGREE = 111320;
// The longest we wait for imagery before showing the map anyway (8 seconds)
const MAX_WAIT_MS = 8000;
// Space in pixels to leave around the 2 × 2 km square when fitting it on screen (enough room for the "ANALYSIS AREA" label above it)
const FIT_PADDING = 36;
// The furthest people can zoom out: zoom 10 shows roughly a whole city, where the 2 × 2 km square is still visible as a small box
const MIN_ZOOM = 10;

let map = null; // The MapLibre map, once it has been created (null until then)
let maplibre = null; // The MapLibre library itself, once downloaded (we need it again for the label marker)
let areaLabel = null; // The "ANALYSIS AREA" label on the map, once shown (null until then)

// Work out the square that reaches RADIUS_METERS north, south, east, and west of a point.
// Returns [[west, south], [east, north]] in degrees, the "bounds" format MapLibre expects.
// (People can pan and zoom freely beyond it, down to city level: they'll want to see what else changed nearby,
// and a later "Analyse this area" button will analyse wherever they've moved to.)
function siteBounds(lon, lat) {
  const latStep = RADIUS_METERS / METERS_PER_DEGREE; // 1 km as degrees of latitude (≈ 0.009°)
  const latRadians = (lat * Math.PI) / 180; // The latitude converted from degrees to radians, which Math.cos needs
  const lonStep = RADIUS_METERS / (METERS_PER_DEGREE * Math.cos(latRadians)); // 1 km as degrees of longitude; degrees get shorter toward the poles, so divide by cos(latitude)
  return [ // The square's corners:
    [lon - lonStep, lat - latStep], // south-west corner
    [lon + lonStep, lat + latStep], // north-east corner
  ]; // End of the corners
} // End of siteBounds

// Wait until MapLibre has loaded and drawn everything, or until MAX_WAIT_MS has passed, whichever comes first
function waitForIdle() {
  return new Promise((resolve) => { // A Promise we finish ourselves by calling "resolve"
    const timer = setTimeout(resolve, MAX_WAIT_MS); // Safety net: stop waiting after 8 seconds
    map.once('idle', () => { // "idle" = all tiles loaded and drawn; "once" = listen just one time
      clearTimeout(timer); // Tiles are ready, so cancel the safety net
      resolve(); // Done waiting
    }); // End of the idle listener
  }); // End of the Promise
} // End of waitForIdle

// The map's creation while it is under way (a Promise), or null when no creation is running.
// Creating the map starts with downloading MapLibre (about 1 MB), and "map" stays null until that is done.
// Without this, a second showPlace during the download (cancel, then quickly pick another place) would also
// see "no map yet" and build a second map in the same box. With it, the second call waits for the same creation.
let mapCreation = null;

// Show the 2 × 2 km square around a place in the given container element.
// Creates the map the first time; after that, moves the existing map without animation.
// Returns a Promise that finishes when the imagery has loaded. "export" lets main.js use it.
export async function showPlace(container, lon, lat) {
  const bounds = siteBounds(lon, lat); // The square to show

  if (map === null) { // No map yet:
    if (mapCreation === null) { // ...and nobody is creating one right now:
      mapCreation = createMap(container, bounds).finally(() => { mapCreation = null; }); // start creating it; when it's over (worked or failed), forget the job, so a failed attempt can be tried again later
    } // End of the start-creating check
    await mapCreation; // Wait for the creation (ours, or the one already running). If it fails, the error goes to main.js as before
  } // End of the no-map check
  map.fitBounds(bounds, { padding: FIT_PADDING, animate: false, bearing: 0 }); // Jump, don't fly, to this square, north-up again (showChange turns it to grid-up later). A brand-new map is already framed, so this changes nothing then; it matters when two calls shared one creation: the later place wins. It also fires "move", which updates the scale bar
  await waitForIdle(); // Wait for the imagery to finish loading
} // End of showPlace

// Download MapLibre and create the map, framed on "bounds". Only showPlace calls this, and only once at a time.
async function createMap(container, bounds) {
  maplibre = await import('maplibre-gl'); // "Dynamic import": download MapLibre now, only when it's needed (kept for later use)
  await import('maplibre-gl/dist/maplibre-gl.css'); // ...and its styles (buttons, attribution text)
  maplibre.setWorkerUrl(workerUrl); // Tell MapLibre where its worker script is (must happen before creating the map)
  map = new maplibre.MapLibreMap({ // Create the map (this fails with an error if the browser has no WebGL)
    container, // Draw inside this element
    bounds, // Start already framed on the square: no flying in from world view
    fitBoundsOptions: { padding: FIT_PADDING }, // Leave a little space around the square
    minZoom: MIN_ZOOM, // Don't allow zooming out further than city level
    dragRotate: false, // North-up: no rotating with right-click drag (or Ctrl + drag)
    pitchWithRotate: false, // No tilting the map while dragging
    touchPitch: false, // No tilting with two fingers on touch screens
    maxPitch: 0, // Never allow any tilt: always look straight down, like a plan
    bearingSnap: 0, // Turn off MapLibre's "snap to north": by default, after any drag it snaps a map turned less than 7° back to exactly north, which undid our small grid-up turn
    attributionControl: false, // Hide MapLibre's own white credit box; we show the imagery credit ourselves, in our style (see .map-credit in index.html)
    style: { // What the map shows: its data sources and how to draw them
      version: 8, // The version of MapLibre's style format
      sources: { // Where the map gets its data from (the change colours are added per place, in showChange)
        satellite: { // The sharp Esri photo, named "satellite"
          type: 'raster', // Ready-made images (pixels)
          tiles: [SATELLITE_TILES], // Where to download the image tiles from
          tileSize: TILE_SIZE, // Each tile is really 256 × 256 pixels, but on sharp screens we show it at 128 CSS pixels (see TILE_SIZE above)
          maxzoom: 19, // Esri has no sharper tiles past zoom 19
        }, // End of the satellite source
      }, // End of the sources
      layers: [ // What is drawn, bottom to top:
        { id: 'sheet', type: 'background', paint: { 'background-color': SHEET_COLOR } }, // A plain dark background, seen only before tiles arrive
        { id: 'satellite-layer', type: 'raster', source: 'satellite' }, // The Esri photo
      ], // End of the layers
    }, // End of the style
  }); // End of creating the map
  map.touchZoomRotate.disableRotation(); // Two-finger pinch still zooms, but no longer twists the map
  map.keyboard.disableRotation(); // Keyboard arrows still pan, but Shift + arrows no longer rotate
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right'); // Zoom buttons only (no compass: the map is always north-up)
  map.on('move', () => updateScaleBar(map.getCenter().lat, map.getZoom())); // Whenever the map moves or zooms, redraw the scale bar
  map.on('resize', () => updateScaleBar(map.getCenter().lat, map.getZoom())); // ...and when the map changes size (e.g. a phone turned sideways), since the maximum bar length depends on the width
  updateScaleBar(map.getCenter().lat, map.getZoom()); // Draw the scale bar for the starting view
  map.on('rotate', updateNorthArrow); // Whenever the map's turn (bearing) changes, turn the north arrow to match
} // End of createMap

// ---------- The change layer ----------

// How see-through the change colors are: 0 = invisible, 1 = solid. At 0.75 the ground still shows through a little.
const CHANGE_OPACITY = 0.75;
// How much the land outside the analysis square is darkened: 0 = not at all, 1 = black
const OUTSIDE_DIM = 0.55;

// Remove the previous place's change picture, mask, outline, and label, if there are any
function clearChange() {
  for (const id of ['site-mask-layer', 'change-layer', 'site-casing-layer', 'site-outline-layer']) { // Our layers (what's drawn)...
    if (map.getLayer(id)) map.removeLayer(id); // ...remove each one if it exists
  } // End of the layers loop
  for (const id of ['site-mask', 'change', 'site-outline']) { // Our sources (the data behind the layers)...
    if (map.getSource(id)) map.removeSource(id); // ...remove each one if it exists (layers must go first, sources second)
  } // End of the sources loop
  if (areaLabel) areaLabel.remove(); // Take the old label off the map
  areaLabel = null; // And forget it
} // End of clearChange

// Swap the change picture for another comparison of the same place (the year slider), without rebuilding anything:
// the image source just gets a new picture at the same corners, so there's no flicker and the map doesn't move.
// "change" is one /api/timeline (or /api/change) answer for the place already shown by showChange.
export function swapChange(change) {
  const source = map && map.getSource('change'); // The change picture's source, if the map and the picture exist
  if (source) source.updateImage({ url: change.image.url, coordinates: change.image.corners }); // Replace the picture in place
} // End of swapChange

// ---------- Grid-up: turn the map so the analysis square sits straight ----------

// Turn the north arrow so it always points to true north, whatever the map's turn.
// MapLibre's "bearing" is the compass direction at the top of the screen (in degrees, clockwise from north).
// If the map is turned by some bearing, true north is that many degrees the other way, so the arrow turns by minus the bearing.
function updateNorthArrow() {
  const arrow = document.querySelector('.north-arrow'); // The north arrow drawing
  arrow.style.transform = `rotate(${-map.getBearing()}deg)`; // Turn it by minus the bearing (CSS rotate: positive = clockwise)
} // End of updateNorthArrow

// Work out how much the analysis square is tilted, as a map bearing that would make it sit straight.
// The square comes from the UTM grid, whose "up" is turned slightly from true north ("grid convergence").
function gridBearing(corners) {
  const [topLeft, topRight] = corners; // The two top corners, as [lon, lat]
  const latRadians = (topLeft[1] * Math.PI) / 180; // The latitude in radians, which Math.cos needs
  const dx = (topRight[0] - topLeft[0]) * Math.cos(latRadians); // How far right the top edge goes (degrees of longitude shrink toward the poles, so multiply by cos(latitude))
  const dy = topRight[1] - topLeft[1]; // How far up the top edge goes (positive = the right end is further north)
  const tilt = (Math.atan2(dy, dx) * 180) / Math.PI; // The top edge's angle in degrees (atan2 turns "right dx, up dy" into an angle; positive = tilted counter-clockwise)
  return -tilt; // Turning the map clockwise by the tilt levels the edge, which in MapLibre's terms is a bearing of minus the tilt
} // End of gridBearing

// Draw the backend's change picture on the map, plus the dimmed outside, the outline, and the label,
// and turn the map so the square sits straight ("grid-up").
// "change" is the backend's answer, or null if there is none (then only the old drawing is removed).
// Returns a Promise that finishes when the turned map has loaded all its imagery.
export async function showChange(change) {
  clearChange(); // Remove the previous place's drawing first
  if (!change) return; // No change data: leave the map north-up, without a change layer

  const corners = change.image.corners; // The square's four corners as [lon, lat]: top-left, top-right, bottom-right, bottom-left

  // Turn the map and fit the square on screen again. cameraForBounds works out the center and zoom
  // that fit a box with the given bearing and padding; jumpTo moves there at once (no animation).
  const lons = corners.map((c) => c[0]); // All four longitudes
  const lats = corners.map((c) => c[1]); // All four latitudes
  const box = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]; // The smallest north-up box around the square: [[west, south], [east, north]]
  map.jumpTo(map.cameraForBounds(box, { bearing: gridBearing(corners), padding: FIT_PADDING })); // Turn and fit (this fires "rotate", which turns the north arrow)

  // The "mask": a huge dark shape covering the whole world, with the square cut out as a hole.
  // Everything outside the square is dimmed, so the analyzed area stands out (like the site on a planning drawing).
  // In GeoJSON, a polygon's first ring is its outline and any further rings are holes.
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]; // The whole map (Web Mercator stops at about 85° north and south)
  map.addSource('site-mask', { // The mask's data
    type: 'geojson', // GeoJSON data
    data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, [...corners, corners[0]]] } }, // The world, with the square as a hole
  }); // End of the mask source
  map.addLayer({ // Draw the mask:
    id: 'site-mask-layer', // The layer's name
    type: 'fill', // A filled area
    source: 'site-mask', // Using the mask source
    paint: { 'fill-color': '#0a0c0f', 'fill-opacity': OUTSIDE_DIM }, // The page's near-black (--bg), partly see-through
  }); // End of the mask layer

  // The change picture: an "image" source is a single picture pinned to four corners on the map.
  // Giving all four corners (not just a box) lets MapLibre turn the picture slightly, matching the UTM grid (see backend/app/landcover.py).
  map.addSource('change', { type: 'image', url: change.image.url, coordinates: corners }); // The PNG (as a data URL) and where it goes
  map.addLayer({ // Draw that picture:
    id: 'change-layer', // The layer's name
    type: 'raster', // A picture made of pixels
    source: 'change', // Using the source above
    paint: { // How it looks:
      'raster-opacity': CHANGE_OPACITY, // Slightly see-through
      'raster-resampling': 'nearest', // "Nearest neighbour": when zoomed in, each 10 m pixel stays a crisp square instead of being blurred
      'raster-fade-duration': 0, // Appear at once (it's revealed by the crossfade anyway)
    }, // End of the paint settings
  }); // End of the change layer

  // The outline of the analysis square, as GeoJSON (the standard text format for map shapes).
  // A polygon's ring must end where it starts, so the first corner is repeated at the end.
  map.addSource('site-outline', { // The outline's data
    type: 'geojson', // GeoJSON data
    data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } }, // One square shape
  }); // End of the outline source
  map.addLayer({ // First a dark "casing" under the outline, so the line stays visible over bright ground as well as dark:
    id: 'site-casing-layer', // The layer's name
    type: 'line', // Only the edge, not a filled area
    source: 'site-outline', // Using the outline source
    paint: { 'line-color': '#0a0c0f', 'line-width': 3.5, 'line-opacity': 0.6 }, // A wider, dark, partly see-through line
  }); // End of the casing layer
  map.addLayer({ // Then the outline itself, on top of the casing:
    id: 'site-outline-layer', // The layer's name
    type: 'line', // Only the edge, not a filled area
    source: 'site-outline', // Using the outline source
    paint: { 'line-color': '#e6e9ee', 'line-width': 1.5 }, // Solid off-white (--ink), a little thicker than before
  }); // End of the outline layer

  // The label just above the square's top-left corner. A "Marker" is a normal HTML element pinned to a map position,
  // so it uses our own fonts and styles (see .area-label in style.css).
  const label = document.createElement('div'); // A new, empty element
  label.className = 'area-label'; // Give it the label styles
  label.textContent = 'ANALYSIS AREA · 2 × 2 KM'; // What it says
  areaLabel = new maplibre.Marker({ element: label, anchor: 'bottom-left', offset: [-1, -5] }) // Pin the label's bottom-left corner, nudged 5 px up so it sits just above the line
    .setLngLat(corners[0]) // ...to the square's top-left corner
    .addTo(map); // ...and put it on the map

  await waitForIdle(); // Turning the map can reveal a little new ground at the edges: wait until its imagery has loaded too
} // End of showChange
