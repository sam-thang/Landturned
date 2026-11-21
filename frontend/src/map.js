// The detailed satellite map (MapLibre). MapLibre is large (about 1 MB), so it is only downloaded
// the first time a place is chosen, not when the landing page opens.

// The address of MapLibre's "worker" script (a helper that processes map data in the background).
// "?url" asks Vite for the file's address instead of its code, and makes Vite include the file in the build.
// MapLibre can't find this file on its own once Vite has repackaged MapLibre, so we tell it (see setWorkerUrl below).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
// Bring in the function that redraws the scale bar, from scalebar.js
import { updateScaleBar } from './scalebar.js';
// Bring in the function that draws the visible part of the 2017 picture, from swipe.js
import { drawBeforePart } from './swipe.js';

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
// Space in pixels to leave around the 2 × 2 km square when fitting it on screen (enough room for the "ANALYSIS AREA" label
// above it). Kept small so the square shows as big as possible; the scale bar sits low enough to stay clear of it (style.css .map-marks).
const FIT_PADDING = 36;
// The furthest people can zoom out: zoom 10 shows roughly a whole city, where the 2 × 2 km square is still visible as a small box
const MIN_ZOOM = 10;

let map = null; // The MapLibre map, once it has been created (null until then)
let maplibre = null; // The MapLibre library itself, once downloaded (we need it again for the label marker)
let areaLabel = null; // The "ANALYSIS AREA" label on the map, once shown (null until then)
let coloursMarker = null; // The "HIDE / SHOW LAND COVER" button pinned to the square's top-right corner, once shown (null until then)
let coloursOn = true; // Whether that button is ON (people can turn the colours off to see the plain imagery)
let coloursCorners = null; // The corners of the square the button belongs to, as [lon, lat]: top-left, top-right, bottom-right, bottom-left
let coloursButtonBelow = null; // Where the button is pinned: false = above the top-right corner, true = below the bottom-right corner, null = not yet

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
  map.on('move', updateAnalyseOffer); // Whenever the map moves or zooms, check whether to offer "Analyse this area"
  map.on('move', placeColoursButton); // ...and whether the "Hide land cover" button still fits beside the label
  map.on('movestart', () => clearTimeout(settleTimer)); // Moving again: cancel a waiting head start (clearTimeout stops a setTimeout before it runs)
  map.on('moveend', waitForSettledOffer); // Stopped moving: start counting towards the head start
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
  if (coloursMarker) coloursMarker.remove(); // The same for the "HIDE / SHOW LAND COVER" button
  coloursMarker = null; // And forget it
  clearSwipe(); // And the previous place's before/after swipe, if there is one
  analysedCorners = null; // No analysis square any more...
  updateAnalyseOffer(); // ...so no "Analyse this area" offer either
} // End of clearChange

// ---------- The before/after swipe ----------

let swipe = null; // The swipe while it's on the map: { before, canvas, handle, corners, fraction }, or null

// Remove the swipe: its layer, its source, its handle, and the listener that keeps the handle in place
function clearSwipe() {
  if (map.getLayer('before-layer')) map.removeLayer('before-layer'); // The 2017 layer (layers go first...)
  if (map.getSource('before')) map.removeSource('before'); // ...then its source)
  if (swipe) { // A swipe was shown:
    swipe.handle.remove(); // Take the handle off the page
    map.off('move', placeHandle); // Stop moving it with the map
    stopSwipeMotion(); // Stop any motion
    const container = map.getContainer(); // The map's box
    container.removeEventListener('pointerdown', stopSwipeMotion, true); // Remove the "stop the motion" listeners (removing needs the same function and "true")
    container.removeEventListener('wheel', stopSwipeMotion, true); // (the next swipe adds them again)
    container.removeEventListener('keydown', stopSwipeMotion, true); // ...all three
  } // End of the swipe check
  swipe = null; // Forget it
} // End of clearSwipe

// Where a square's edges are on screen right now, as pixel positions in the map's box. "corners" are its four corners as [lon, lat].
function screenBox(corners) {
  const [topLeft, topRight, , bottomLeft] = corners.map((c) => map.project(c)); // "project" turns [lon, lat] into screen pixels
  return { left: topLeft.x, right: topRight.x, top: topLeft.y, bottom: bottomLeft.y }; // Grid-up, so the edges are straight: one x per side, one y per top/bottom
} // End of screenBox

// Where the swipe's square is on screen right now
function squareOnScreen() {
  return screenBox(swipe.corners); // The analysis square's edges
} // End of squareOnScreen

// ---------- "Analyse this area": offered when the map's centre leaves the analysis square ----------

let analysedCorners = null; // The analysis square now on the map (its four corners), or null when there's none
let analysingCenter = null; // While "Analyse this area" runs: the spot being analysed as [lon, lat]; otherwise null
const EARTH_CIRCUMFERENCE_M = 40075016.686; // The Earth's circumference at the equator, in metres
const ANALYSE_LABEL = 'Analyse this area'; // The button's normal text (CSS shows it in capitals)

// The map's centre right now, as { lon, lat }: the spot "Analyse this area" analyses
export function getMapCenter() {
  const { lng, lat } = map.getCenter(); // MapLibre calls longitude "lng"
  return { lon: lng, lat }; // Our name for it is "lon"
} // End of getMapCenter

// The head start: once "Analyse this area" is offered and the map has stayed still for a moment, main.js can start the
// slow archive-imagery lookup for that spot in the background, so less of the wait comes after the press.
const SETTLE_MS = 500; // How long the map must stay still first, in milliseconds (a pan that keeps going triggers nothing; half a second is enough to tell a pause from a drag)
let settleTimer = null; // The waiting timer, so moving again can cancel it
let onSettled = null; // What main.js wants done then (a function that gets the map's centre), or null

// Tell the map what to do when the offer has settled: "callback" gets the map's centre as { lon, lat }
export function onOfferSettled(callback) {
  onSettled = callback; // Remember it
} // End of onOfferSettled

// The map stopped moving: wait SETTLE_MS, then, if the offer is still showing and nothing is being analysed, call back
function waitForSettledOffer() {
  clearTimeout(settleTimer); // Forget any earlier wait
  settleTimer = setTimeout(() => { // After the wait:
    const offered = !document.getElementById('analyse-area').hidden; // Is "Analyse this area" showing?
    if (offered && analysingCenter === null && onSettled) onSettled(getMapCenter()); // Yes, and no analysis running: hand over the centre
  }, SETTLE_MS); // ...SETTLE_MS from now
} // End of waitForSettledOffer

// Start or end the "analysing" state. "center" is the spot being analysed as [lon, lat], or null when it's over.
// While it runs, the dashed square stays pinned to that spot (it moves with the ground if people pan), and the button
// says "Analysing…" and ignores presses. "label" is the button's text afterwards (normally "Analyse this area").
export function setAnalysing(center, label = ANALYSE_LABEL) {
  analysingCenter = center; // Remember the spot (or forget it)
  const button = document.getElementById('analyse-area'); // The button
  button.textContent = center ? 'Analysing…' : label; // Its text
  button.setAttribute('aria-disabled', center ? 'true' : 'false'); // Tell screen readers it can't be pressed now. ("disabled" would also take keyboard focus away from it)
  updateAnalyseOffer(); // Redraw the dashed square and the button
} // End of setAnalysing

// Show or hide the "Analyse this area" button and the dashed square, after every map move.
// Rule: they appear when the map's centre is outside the analysis square. Zooming or looking around inside it never triggers them.
function updateAnalyseOffer() {
  if (!map) return; // No map yet (e.g. the first place was cancelled before it loaded): nothing to update
  const button = document.getElementById('analyse-area'); // The button
  const proposed = document.getElementById('proposed-square'); // The dashed square
  const box = analysedCorners && screenBox(analysedCorners); // The analysis square on screen (if there is one)
  const container = map.getContainer(); // The map's box
  const x = container.clientWidth / 2; // The centre of the map's box: across...
  const y = container.clientHeight / 2; // ...and down
  const outside = box !== null && (x < box.left || x > box.right || y < box.top || y > box.bottom); // Is the centre outside the square?
  const shown = outside || analysingCenter !== null; // Offer it then, and always while an analysis runs
  button.hidden = !shown; // The button
  proposed.hidden = !shown; // ...and the dashed square
  if (!shown) return; // Nothing more to do
  const spot = analysingCenter ? map.project(analysingCenter) : { x, y }; // Where the dashed square's centre goes: the spot being analysed, or else the map's centre
  proposed.style.left = `${spot.x}px`; // Its centre across...
  proposed.style.top = `${spot.y}px`; // ...and down (CSS moves it back by half its size)
  // How many metres one screen pixel covers here. MapLibre's world is 512 pixels wide at zoom 0 and doubles with each zoom
  // level; a degree of longitude shrinks towards the poles by cos(latitude), and the Mercator map stretches by the same amount.
  const latitude = (map.getCenter().lat * Math.PI) / 180; // The centre's latitude, in radians
  const metresPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) / (512 * 2 ** map.getZoom()); // Metres per screen pixel
  const side = (2 * RADIUS_METERS) / metresPerPixel; // 2 km in screen pixels
  proposed.style.width = `${side}px`; // The dashed square's width...
  proposed.style.height = `${side}px`; // ...and height

  // The button sits just above the dashed square's top-left corner, like the "ANALYSIS AREA" label on the solid square.
  // When that corner is off-screen (zoomed in, or a square almost as tall as the map), it stops EDGE_GAP px inside the map.
  const EDGE_GAP = 8; // The closest the button gets to the map's edge, in pixels
  const squareLeft = spot.x - side / 2; // The dashed square's left edge on screen
  const squareTop = spot.y - side / 2; // ...and its top edge
  button.style.left = `${Math.max(EDGE_GAP, squareLeft)}px`; // Level with the square's left edge, but never off-screen
  button.style.top = `${Math.max(EDGE_GAP, squareTop - button.offsetHeight - 5)}px`; // Its bottom 5 px above the square's top edge, but never off-screen
} // End of updateAnalyseOffer

// Put the handle where it belongs: "fraction" of the way across the square, as tall as the square.
// Runs on every map move too, because panning and zooming move the square on screen.
function placeHandle() {
  const box = squareOnScreen(); // The square's edges on screen
  const x = box.left + (box.right - box.left) * swipe.fraction; // The handle's position across
  swipe.handle.style.transform = `translate(${x}px, ${box.top}px)`; // Move it there ("translate" shifts an element without re-laying-out the page)
  swipe.handle.style.height = `${box.bottom - box.top}px`; // As tall as the square
  const room = 12; // Space a tag needs between itself and the square's edge, in pixels
  const [beforeTag, afterTag] = swipe.handle.querySelectorAll('.swipe-tag'); // The two year tags
  // "visibility: hidden" makes a tag invisible but keeps its size, so offsetWidth stays its real width. (With "display: none" the
  // width would read 0 while hidden: it would always "fit", show again, not fit, hide again... and flicker near the edges.)
  beforeTag.style.visibility = x - box.left < beforeTag.offsetWidth + room ? 'hidden' : 'visible'; // Hide the 2017 tag when it wouldn't fit left of the line (e.g. the handle near the left edge)
  afterTag.style.visibility = box.right - x < afterTag.offsetWidth + room ? 'hidden' : 'visible'; // Hide the 2023 tag when it wouldn't fit right of the line
} // End of placeHandle

// Whether people asked their device for less motion ("reduce motion" in the accessibility settings)
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// How long the change colours take to fade out or in, in milliseconds (instant with reduced motion)
const COLOUR_FADE_MS = REDUCE_MOTION ? 0 : 400;
// Let go this close to the left edge (as a share of the square's width) and the handle snaps onto it, bringing the colours back
const SNAP = 0.03;

// Show or hide the change colours. The handle at the left edge is the result view (all 2023, with colours);
// anywhere else is the comparison view (two clean photos), so the colours don't cover the 2017 imagery.
// The colours only show when "shown" AND the "HIDE / SHOW LAND COVER" button is set to show them.
function setColoursShown(shown) {
  if (!map.getLayer('change-layer')) return; // No colours on the map (no change data): nothing to do
  map.setPaintProperty('change-layer', 'raster-opacity-transition', { duration: COLOUR_FADE_MS, delay: 0 }); // Fade, rather than switch, when the see-through value changes
  map.setPaintProperty('change-layer', 'raster-opacity', shown && coloursOn ? CHANGE_OPACITY : 0); // Fully see-through when hidden
} // End of setColoursShown

// Keep the "HIDE / SHOW LAND COVER" button up to date: its words, and whether it shows at all.
// It only shows in the result view (handle at the left edge, or no swipe yet): elsewhere the colours are hidden anyway.
function updateColoursButton() {
  if (!coloursMarker) return; // No button on the map: nothing to do
  const button = coloursMarker.getElement(); // The button itself (a Marker's element)
  button.hidden = Boolean(swipe && swipe.fraction > 0); // Hidden while the handle is away from the left edge
  button.textContent = coloursOn ? 'Hide land cover' : 'Show land cover'; // Says what pressing will do (CSS turns it into capitals)
  placeColoursButton(); // Its words (and so its width) may have changed: check where it fits
} // End of updateColoursButton

// Pin the button above the square's top-right corner, opposite the "ANALYSIS AREA" label, when both fit side by side;
// otherwise (a phone, or the map zoomed out so the square is small) just below the square's bottom-right corner.
// Runs when the button changes and whenever the map moves, because zooming changes how wide the square is on screen.
function placeColoursButton() {
  if (!coloursMarker || !areaLabel) return; // No button or label on the map: nothing to place
  const button = coloursMarker.getElement(); // The button itself
  if (button.hidden) return; // Hidden: its place doesn't matter now (it's checked again when it shows)
  if (coloursButtonBelow === null) pinColoursButton(false); // Never placed: put it on the map first (above), so it has a measurable width
  const box = screenBox(coloursCorners); // The square's edges on screen right now
  const needed = areaLabel.getElement().offsetWidth + button.offsetWidth + 12; // Label + button + a 12 px gap, in pixels
  const below = needed > box.right - box.left; // Don't both fit along the top edge?
  if (below !== coloursButtonBelow) pinColoursButton(below); // Move it only when the answer changes
} // End of placeColoursButton

// Pin the button to a corner: below = true puts its top-right corner 5 px under the square's bottom-right corner,
// false puts its bottom-right corner 5 px above the top-right corner. A Marker's anchor is fixed when it's made, so make a new one.
function pinColoursButton(below) {
  const button = coloursMarker.getElement(); // The button (it moves to the new Marker)
  coloursMarker.remove(); // Take the old Marker off the map
  coloursMarker = new maplibre.Marker({ element: button, anchor: below ? 'top-right' : 'bottom-right', offset: below ? [1, 5] : [1, -5] }) // The corner of the button to pin, nudged 5 px away from the line
    .setLngLat(coloursCorners[below ? 2 : 1]) // The square's bottom-right corner (corners go top-left, top-right, bottom-right, bottom-left) or top-right one
    .addTo(map); // ...and put it on the map
  coloursButtonBelow = below; // Remember where it is
} // End of pinColoursButton

// Turn the colours on or off with the "HIDE / SHOW LAND COVER" button (or turn them back on from elsewhere)
function setColoursOn(on) {
  coloursOn = on; // Remember the choice
  setColoursShown(!swipe || swipe.fraction === 0); // Fade the colours (they still only show in the result view)
  updateColoursButton(); // Update the button's word and state
} // End of setColoursOn

// Move the handle to a new fraction (0 = left edge, all 2023; 1 = right edge, all 2017) and redraw the 2017 part
function setSwipe(fraction) {
  swipe.fraction = Math.min(1, Math.max(0, fraction)); // Keep it between 0 and 1 (min and max cap it at both ends)
  setColoursShown(swipe.fraction === 0); // Colours only in the result view (handle at the left edge)
  const percent = Math.round(swipe.fraction * 100); // How much of the square shows 2017, in percent
  swipe.handle.setAttribute('aria-valuenow', percent); // Tell screen readers the slider's value...
  swipe.handle.setAttribute('aria-valuetext', percent === 0 // ...and what it means, in words
    ? 'All latest imagery, with the change colours' // At the left edge
    : `${percent}% earliest imagery, colours hidden`); // Anywhere else
  drawBeforePart(swipe.before, swipe.canvas, swipe.fraction); // Redraw the visible part of 2017
  const source = map.getSource('before'); // The 2017 source
  source.play(); // A canvas source only sends a new drawing to the map while "playing": switch that on...
  source.pause(); // ...and straight off again: pausing sends the latest drawing once, so nothing keeps running in between
  placeHandle(); // Move the handle line
  updateColoursButton(); // Show the "HIDE / SHOW LAND COVER" button only with the handle at the left edge
} // End of setSwipe

// ---------- The swipe's motion: the opening sequence and the glide ----------

const SWEEP_MS = 2500; // The opening sweep from all 2017 (right edge) to all 2023 (left edge): slow enough to watch the land change
const COLOUR_HOLD_MS = 2000; // How long the colours stay before the handle moves on, so people take in the result
const GLIDE_MS = 1000; // The glide to the middle
let motion = 0; // A number that changes whenever motion must stop: each animation remembers the number it started with

// Stop any motion at once: the handle stays where it is. Runs when people touch, click, zoom or press a key on the map.
export function stopSwipeMotion() {
  motion += 1; // A new number: running animations notice they're out of date and stop
} // End of stopSwipeMotion

// Wait some time, unless the motion is stopped meanwhile. Gives true if the wait finished, false if it was stopped.
function waitUnlessStopped(ms, myMotion) {
  return new Promise((resolve) => setTimeout(() => resolve(myMotion === motion), ms)); // After the wait, check whether we're still the current motion
} // End of waitUnlessStopped

// Move the handle smoothly to "target" (a fraction) over "ms" milliseconds. Gives true when it got there, false if it was stopped.
function moveHandle(target, ms, myMotion) {
  const start = swipe.fraction; // Where the handle starts
  const begin = performance.now(); // When it starts (a precise clock, in milliseconds)
  return new Promise((resolve) => { // A Promise we finish ourselves
    function step(now) { // One animation frame ("now" = the time of this frame)
      if (myMotion !== motion || !swipe) return resolve(false); // Stopped, or the swipe was removed: stop here
      const t = Math.min(1, (now - begin) / ms); // How far through the move we are: 0 at the start, 1 at the end
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // "Ease in and out": start slowly, speed up, slow down at the end (like a hand moving)
      setSwipe(start + (target - start) * eased); // Move the handle (this also fades the colours in or out)
      if (t < 1) requestAnimationFrame(step); // Not there yet: do the next frame when the screen is ready to draw again
      else resolve(true); // Arrived
    } // End of step
    requestAnimationFrame(step); // The first frame
  }); // End of the Promise
} // End of moveHandle

// The opening sequence, for a swipe shown with the handle at the right edge (all 2017): sweep to the left edge (all 2023),
// let the colours fade in and stay a moment, then glide to the middle for the side-by-side comparison.
export async function playOpening() {
  if (!swipe) return; // No swipe: nothing to play
  const myMotion = motion; // The motion number this sequence belongs to
  if (REDUCE_MOTION) return setSwipe(0.5); // Less motion wanted: go straight to the end position, without moving
  if (!(await waitUnlessStopped(400, myMotion))) return; // A short moment on 2017 first (stop if interrupted)
  if (!(await moveHandle(0, SWEEP_MS, myMotion))) return; // Sweep right to left: 2023 replaces 2017 (the colours fade in at the edge)
  if (!(await waitUnlessStopped(COLOUR_HOLD_MS, myMotion))) return; // Let the colours stay
  await moveHandle(0.5, GLIDE_MS, myMotion); // Glide to the middle (the colours fade out as it leaves the edge)
} // End of playOpening

// Just the glide to the middle: for a swipe that arrives late, while people are already looking at the result
export function glideToMiddle() {
  if (!swipe) return; // No swipe: nothing to do
  if (REDUCE_MOTION) return setSwipe(0.5); // Less motion wanted: jump there
  moveHandle(0.5, GLIDE_MS, motion); // Glide
} // End of glideToMiddle

// Back to the result view (the year slider uses this, so its changing colours can be seen): colours on, stop any motion,
// handle to the left edge
export function resetSwipe() {
  if (!swipe) { // No swipe (yet):
    setColoursOn(true); // just make sure the colours are on
    return; // Nothing else to do
  } // End of the no-swipe case
  coloursOn = true; // Colours on (setSwipe below fades them in and updates the button)
  stopSwipeMotion(); // Stop any motion
  setSwipe(0); // Left edge: all latest imagery, colours on
} // End of resetSwipe

// Show the before/after swipe: the 2017 picture inside the square, left of a handle that starts at the left edge.
// "before" is what buildBeforeImage made, "corners" the square's corners (for the handle), "tags" the two year tags'
// text ({ before: "2017 · 21 OCT", after: "2023 · 1 FEB" }), "start" where the handle begins (0 = left edge, 1 = right edge).
// Call after showChange.
export function showSwipe(before, corners, tags, start = 0) {
  clearSwipe(); // Remove any earlier one first
  const canvas = document.createElement('canvas'); // The drawing the map shows: the visible part of 2017
  canvas.width = before.canvas.width; // The same size as the full 2017 picture...
  canvas.height = before.canvas.height; // ...so the same four corners fit it
  map.addSource('before', { type: 'canvas', canvas, coordinates: before.coordinates, animate: false }); // A canvas pinned to the map; "animate: false" = only update when we say so
  map.addLayer({ id: 'before-layer', type: 'raster', source: 'before', paint: { 'raster-fade-duration': 0 } }, 'change-layer'); // Draw it above the 2023 imagery and below the change colours ("change-layer" = insert before that layer)

  const handle = document.createElement('div'); // The handle: a line with a grip in the middle
  handle.className = 'swipe-handle'; // Its styles (style.css)
  handle.innerHTML = '<span class="swipe-grip" aria-hidden="true"></span>'; // The grip you grab (decorative, so screen readers skip it)
  for (const [side, text] of [['before', tags.before], ['after', tags.after]]) { // The two year tags, left then right:
    const tag = document.createElement('span'); // A small label
    tag.className = `swipe-tag swipe-tag-${side}`; // Its styles: shared, plus which side of the line it sits on
    tag.textContent = text; // e.g. "2017 · 21 OCT" ("textContent" sets plain text, never HTML)
    handle.appendChild(tag); // Put it on the handle, so it moves with the line
  } // End of the tags loop
  map.getContainer().appendChild(handle); // Put it over the map, outside the part MapLibre listens to, so dragging it doesn't pan the map

  swipe = { before, canvas, handle, corners, fraction: 0 }; // Remember everything; start at the left edge (all 2023)
  handle.addEventListener('pointerdown', (event) => { // A finger, pen or mouse presses on the handle:
    handle.setPointerCapture(event.pointerId); // Keep receiving its moves even if it slides off the thin handle
    handle.classList.add('is-dragging'); // Style it as grabbed
  }); // End of pointerdown
  handle.addEventListener('pointermove', (event) => { // It moves:
    if (!handle.hasPointerCapture(event.pointerId)) return; // Only while pressed (a mouse just hovering doesn't count)
    const box = squareOnScreen(); // The square's edges on screen
    const x = event.clientX - map.getContainer().getBoundingClientRect().left; // The pointer's position across the map's box
    setSwipe((x - box.left) / (box.right - box.left)); // How far across the square that is, as a fraction
  }); // End of pointermove
  const release = () => { // Let go:
    handle.classList.remove('is-dragging'); // Back to the normal look
    if (swipe.fraction > 0 && swipe.fraction < SNAP) setSwipe(0); // Very close to the left edge: snap onto it, so the colours come back
  }; // End of release

  // Keyboard and screen readers: the handle is a slider ("role" tells screen readers what it is) that the keyboard can reach
  handle.tabIndex = 0; // Reachable with the Tab key
  handle.setAttribute('role', 'slider'); // Announced as a slider
  handle.setAttribute('aria-label', 'Compare satellite imagery: earliest on the left, latest on the right'); // What it controls
  handle.setAttribute('aria-valuemin', '0'); // Its lowest value (left edge)
  handle.setAttribute('aria-valuemax', '100'); // Its highest value (right edge)
  handle.addEventListener('keydown', (event) => { // A key is pressed while the handle has focus:
    const moves = { ArrowLeft: swipe.fraction - 0.05, ArrowRight: swipe.fraction + 0.05, Home: 0, End: 1 }; // Where each key takes the handle (5 % steps)
    if (!(event.key in moves)) return; // Another key: leave it alone
    event.preventDefault(); // Stop the page or map from also reacting (e.g. arrows panning the map)
    const next = moves[event.key]; // The new position
    setSwipe(next < 0.01 ? 0 : next); // Move there (landing just above 0 after several steps counts as the left edge)
  }); // End of the keyboard listener
  handle.addEventListener('pointerup', release); // Released
  handle.addEventListener('pointercancel', release); // Or interrupted (e.g. the browser took over the touch)
  map.on('move', placeHandle); // Keep the handle on the square while the map pans or zooms
  stopSwipeMotion(); // A new swipe: any earlier motion is over
  const container = map.getContainer(); // The map's box (the handle is inside it too)
  container.addEventListener('pointerdown', stopSwipeMotion, true); // Any touch or click on the map or handle stops the motion ("true" = catch it on its way in, before MapLibre)
  container.addEventListener('wheel', stopSwipeMotion, true); // ...and so does scroll-zooming
  container.addEventListener('keydown', stopSwipeMotion, true); // ...and any key on the map or handle
  setSwipe(start); // Draw the starting state and place the handle
} // End of showSwipe

// Switch the map's satellite imagery: "tiles" is an archive version's tile address (from /api/wayback), or null for
// Esri's current imagery. Only where the tiles come from changes, so the map, its layers and the view stay as they are.
export function setBaseImagery(tiles) {
  const source = map && map.getSource('satellite'); // The imagery source, if the map exists yet
  if (!source || (tiles ?? null) === baseTiles) return; // No map yet, or it already shows these tiles: nothing to change (a reload would only flicker)
  source.setTiles([tiles ?? SATELLITE_TILES]); // Load tiles from the new address ("??" = the current imagery if none is given)
  baseTiles = tiles ?? null; // Remember what the map shows now
} // End of setBaseImagery
let baseTiles = null; // The archive tile address the map shows now, or null for Esri's current imagery

// Wait until the map's imagery has loaded and been drawn (at most MAX_WAIT_MS), e.g. after setBaseImagery
export function waitForImagery() {
  map.triggerRepaint(); // Ask for one more drawing, so "idle" comes even if nothing changed (otherwise we'd wait the full MAX_WAIT_MS)
  return waitForIdle(); // Then wait for "idle": every tile loaded and drawn
} // End of waitForImagery

// Swap the change picture for another comparison of the same place (the year slider), without rebuilding anything:
// the image source just gets a new picture at the same corners, so there's no flicker and the map doesn't move.
// "change" is one comparison from the /api/analysis answer, for the place already shown by showChange.
export function swapChange(change) {
  shownPicture = { url: change.image.url, corners: change.image.corners }; // Remember the backend's picture (unfiltered)
  drawChange(); // Put it on the map, without the switched-off colours
} // End of swapChange

// ---------- The colour switches: hiding some change colours ----------

// The exact colour of each change type in the backend's PNG, as [red, green, blue] (the same as COLORS in backend/app/change_image.py).
// PNG is "lossless": it stores every pixel exactly, so a "newly built" pixel is always exactly this orange, never a near-orange.
const CHANGE_RGB = {
  built: [0xff, 0xa0, 0x1f], // Orange #ffa01f
  cleared: [0xff, 0x5a, 0x4f], // Red #ff5a4f
  gained: [0x4f, 0xd9, 0x8a], // Green #4fd98a
  water: [0x3d, 0xb8, 0xf5], // Blue #3db8f5
}; // End of the colours
let shownTypes = Object.keys(CHANGE_RGB); // The change types switched on (at first all four: ['built', 'cleared', 'gained', 'water'])
let shownPicture = null; // The backend's change picture now on the map: { url, corners }, or null
let drawNumber = 0; // Counts the drawings, so an older one that finishes late can't replace a newer one

// Load a picture from an address (here a data URL), and hand it back when it's ready
function loadImage(url) {
  return new Promise((resolve, reject) => { // A Promise we finish ourselves
    const image = new Image(); // A new, empty picture
    image.onload = () => resolve(image); // Loaded: hand it back
    image.onerror = reject; // Failed: report the error
    image.src = url; // Start loading
  }); // End of the Promise
} // End of loadImage

// Put the change picture on the map with only the switched-on colours. With all four on, the backend's PNG is used as it is;
// otherwise the browser copies it onto a canvas and makes every pixel of a switched-off colour see-through.
async function drawChange() {
  const source = map && map.getSource('change'); // The change picture's source, if the map and the picture exist
  if (!source || !shownPicture) return; // Nothing on the map yet: nothing to draw
  const myNumber = ++drawNumber; // This drawing's number ("++" adds 1 first, then uses the new value)
  const { url, corners } = shownPicture; // The picture and its corners
  if (shownTypes.length === Object.keys(CHANGE_RGB).length) { // All four colours on:
    source.updateImage({ url, coordinates: corners }); // The original picture, no filtering needed
    return; // Done
  } // End of the all-on case

  const image = await loadImage(url); // Turn the PNG's data URL into a picture we can draw (takes a moment)
  if (myNumber !== drawNumber) return; // A newer drawing started meanwhile (e.g. the year slider moved on): let that one win
  const canvas = document.createElement('canvas'); // A drawing surface, not on the page
  canvas.width = image.width; // As big as the picture (200 x 200: one pixel per 10 m)
  canvas.height = image.height; // ...
  const context = canvas.getContext('2d', { willReadFrequently: true }); // Its drawing tools ("willReadFrequently" tells the browser we'll read the pixels back)
  context.drawImage(image, 0, 0); // Copy the picture onto it
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height); // Read all its pixels: a long list of numbers, 4 per pixel (red, green, blue, alpha)
  const hidden = Object.keys(CHANGE_RGB).filter((type) => !shownTypes.includes(type)).map((type) => CHANGE_RGB[type]); // The colours to hide, e.g. [[255, 90, 79]]
  const data = pixels.data; // The numbers themselves
  for (let i = 0; i < data.length; i += 4) { // Each pixel (4 numbers at a time)
    if (hidden.some(([r, g, b]) => data[i] === r && data[i + 1] === g && data[i + 2] === b)) data[i + 3] = 0; // A hidden colour: alpha 0 = fully see-through
  } // End of the pixels loop
  context.putImageData(pixels, 0, 0); // Put the changed pixels back on the canvas
  source.updateImage({ url: canvas.toDataURL(), coordinates: corners }); // Hand the filtered picture to the map (as a PNG data URL)
} // End of drawChange

// Choose which change colours the map shows, e.g. ['built', 'gained'] (from the stats rows' switches).
// The colours only show with the swipe's handle at the left edge, so a change sends the handle back there: otherwise
// pressing a switch would seem to do nothing. Works before the map exists too (then it's only remembered).
export function setShownChanges(types) {
  shownTypes = types; // Remember the choice (it stays for every year of this place)
  if (!coloursOn || (swipe && swipe.fraction > 0)) resetSwipe(); // Colours hidden (button OFF, or handle away from the edge): show them again, so the change can be seen
  drawChange(); // Redraw the picture with the chosen colours
} // End of setShownChanges

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
  shownPicture = { url: change.image.url, corners }; // Remember the backend's picture, for the colour switches
  drawChange(); // If some colours are switched off, redraw without them (with all on, this changes nothing)
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
  const hectares = (2 * RADIUS_METERS) ** 2 / 10000; // The square's area: 2000 m × 2000 m = 4,000,000 m², and 1 ha = 10,000 m², so 400 ha ("**" = to the power of)
  label.textContent = `ANALYSIS AREA · 2 × 2 KM · ${hectares} HA`; // What it says, e.g. "ANALYSIS AREA · 2 × 2 KM · 400 HA" (the stats' percentages are shares of this)
  areaLabel = new maplibre.Marker({ element: label, anchor: 'bottom-left', offset: [-1, -5] }) // Pin the label's bottom-left corner, nudged 5 px up so it sits just above the line
    .setLngLat(corners[0]) // ...to the square's top-left corner
    .addTo(map); // ...and put it on the map

  // The "HIDE / SHOW LAND COVER" button just above the top-right corner, in the same lettering as the label opposite it.
  // Its words say what pressing does (a verb reads as "press me"), and screen readers read those same words.
  coloursOn = true; // A new result starts with the colours on
  const button = document.createElement('button'); // A real button: reachable with Tab, pressed with Enter or Space
  button.type = 'button'; // A plain button (not one that sends a form)
  button.className = 'colours-toggle'; // Its styles (style.css); its words are filled in by updateColoursButton below
  button.addEventListener('click', () => setColoursOn(!coloursOn)); // Each press flips it ("!" = the opposite)
  coloursCorners = corners; // The square it belongs to
  coloursButtonBelow = null; // Not placed yet (placeColoursButton decides: above or below the square)
  coloursMarker = new maplibre.Marker({ element: button }); // A Marker holding the button; placeColoursButton pins it to a corner
  updateColoursButton(); // Fill in its words and state, and place it

  analysedCorners = corners; // Remember the square, for the "Analyse this area" check
  updateAnalyseOffer(); // Check it once now (the centre is inside the new square, so nothing is offered)

  await waitForIdle(); // Turning the map can reveal a little new ground at the edges: wait until its imagery has loaded too
} // End of showChange
