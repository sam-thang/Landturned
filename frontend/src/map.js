// The detailed satellite map (MapLibre). MapLibre is large (about 1 MB), so it is only downloaded
// the first time a place is chosen, not when the landing page opens.

// The address of MapLibre's "worker" script (a helper that processes map data in the background).
// "?url" asks Vite for the file's address instead of its code, and makes Vite include the file in the build.
// MapLibre can't find this file on its own once Vite has repackaged MapLibre, so we tell it (see setWorkerUrl below).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
// Bring in the function that redraws the scale bar, from scalebar.js
import { updateScaleBar } from './scalebar.js';

// The web address pattern for Esri's satellite image tiles.
// {z} = zoom level, {y} = tile row, {x} = tile column. Note: Esri puts y before x.
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// The analysis area: everything within 1 km (1000 m) of the address
const RADIUS_METERS = 1000;
// How many meters one degree of latitude covers (about the same everywhere on Earth)
const METERS_PER_DEGREE = 111320;
// The longest we wait for imagery before showing the map anyway (8 seconds)
const MAX_WAIT_MS = 8000;
// Space in pixels to leave around the 2 × 2 km square when fitting it on screen
const FIT_PADDING = 24;

let map = null; // The MapLibre map, once it has been created (null until then)

// Work out the square that reaches RADIUS_METERS north, south, east, and west of a point.
// Returns [[west, south], [east, north]] in degrees, the "bounds" format MapLibre expects.
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

// Show the 2 × 2 km square around a place in the given container element.
// Creates the map the first time; after that, moves the existing map without animation.
// Returns a Promise that finishes when the imagery has loaded. "export" lets main.js use it.
export async function showPlace(container, lon, lat) {
  const bounds = siteBounds(lon, lat); // The square to show

  if (map === null) { // First time: download MapLibre and create the map
    const maplibre = await import('maplibre-gl'); // "Dynamic import": download MapLibre now, only when it's needed
    await import('maplibre-gl/dist/maplibre-gl.css'); // ...and its styles (buttons, attribution text)
    maplibre.setWorkerUrl(workerUrl); // Tell MapLibre where its worker script is (must happen before creating the map)
    map = new maplibre.MapLibreMap({ // Create the map (this fails with an error if the browser has no WebGL)
      container, // Draw inside this element
      bounds, // Start already framed on the square: no flying in from world view
      fitBoundsOptions: { padding: FIT_PADDING }, // Leave a little space around the square
      dragRotate: false, // North-up: no rotating with right-click drag (or Ctrl + drag)
      pitchWithRotate: false, // No tilting the map while dragging
      touchPitch: false, // No tilting with two fingers on touch screens
      maxPitch: 0, // Never allow any tilt: always look straight down, like a plan
      attributionControl: false, // Hide MapLibre's own white credit box; we show the imagery credit ourselves, in our style (see .map-credit in index.html)
      style: { // What the map shows: its data sources and how to draw them
        version: 8, // The version of MapLibre's style format
        sources: { // Where the map gets its data from
          satellite: { // Our one source, named "satellite"
            type: 'raster', // Ready-made images (pixels)
            tiles: [SATELLITE_TILES], // Where to download the image tiles from
            tileSize: 256, // Each tile is 256 × 256 pixels
            maxzoom: 19, // Esri has no sharper tiles past zoom 19
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', // Credit the imagery licence requires (displayed by our own .map-credit line in index.html)
          }, // End of the satellite source
        }, // End of the sources
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }], // Draw the satellite images as one layer
      }, // End of the style
    }); // End of creating the map
    map.touchZoomRotate.disableRotation(); // Two-finger pinch still zooms, but no longer twists the map
    map.keyboard.disableRotation(); // Keyboard arrows still pan, but Shift + arrows no longer rotate
    map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right'); // Zoom buttons only (no compass: the map is always north-up)
    map.on('move', () => updateScaleBar(map.getCenter().lat, map.getZoom())); // Whenever the map moves or zooms, redraw the scale bar
    map.on('resize', () => updateScaleBar(map.getCenter().lat, map.getZoom())); // ...and when the map changes size (e.g. a phone turned sideways), since the maximum bar length depends on the width
    updateScaleBar(map.getCenter().lat, map.getZoom()); // Draw the scale bar for the starting view
  } else { // The map already exists: move it straight to the new square
    map.fitBounds(bounds, { padding: FIT_PADDING, animate: false }); // Jump, don't fly (this also fires "move", which updates the scale bar)
  } // End of the create-or-move check

  await waitForIdle(); // Wait for the imagery to finish loading
} // End of showPlace
