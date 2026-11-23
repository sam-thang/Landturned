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
// The zoom range people can use (speed-up phase 6): zoom 12 shows the neighbourhood around the 2 × 2 km square (the square is
// then about 125 px across on a phone in California), zoom 17 is close enough to see single buildings. Outside this range the
// zoom buttons grey out (MapLibre disables them) and pinching stops.
const MIN_ZOOM = 12;
const MAX_ZOOM = 17;
// How far from the searched address people can pan: 10 km each way, a 20 x 20 km box. A new search moves the box;
// "Analyse this area" doesn't (so people can analyse anywhere near the address, but not hop further and further away).
const EXPLORE_RADIUS_M = 10000;

let map = null; // The MapLibre map, once it has been created (null until then)
let maplibre = null; // The MapLibre library itself, once downloaded (we need it again for the label marker)
let areaLabel = null; // The "ANALYSIS AREA" label on the map, once shown (null until then)
let findingTag = null; // The "FINDING EARLIER IMAGERY…" tag while the swipe's earlier photo is on its way (null otherwise)
let swipeHint = null; // The "◀ DRAG LEFT FOR LAND COVER" hint while the handle rests away from the left edge (null otherwise)
let hintLearned = false; // Becomes true once someone has brought the handle to the left edge themselves: the hint isn't needed any more (for this result; a new place or analysed area starts over)
let coloursMarker = null; // The "HIDE / SHOW LAND COVER" button pinned to the square's top-right corner, once shown (null until then)
let coloursOn = true; // Whether that button is ON (people can turn the colours off to see the plain imagery)
let coloursCorners = null; // The corners of the square the button belongs to, as [lon, lat]: top-left, top-right, bottom-right, bottom-left
let coloursButtonBelow = null; // Where the button is pinned: false = above the top-right corner, true = below the bottom-right corner, null = not yet

// Work out the square that reaches RADIUS_METERS north, south, east, and west of a point.
// Returns [[west, south], [east, north]] in degrees, the "bounds" format MapLibre expects.
// (People can pan and zoom freely beyond it, down to city level: they'll want to see what else changed nearby,
// and a later "Analyse this area" button will analyse wherever they've moved to.)
function siteBounds(lon, lat, radius = RADIUS_METERS) {
  const latStep = radius / METERS_PER_DEGREE; // The radius as degrees of latitude (1 km ≈ 0.009°)
  const latRadians = (lat * Math.PI) / 180; // The latitude converted from degrees to radians, which Math.cos needs
  const lonStep = radius / (METERS_PER_DEGREE * Math.cos(latRadians)); // The radius as degrees of longitude; degrees get shorter toward the poles, so divide by cos(latitude)
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
  map.setMaxBounds(null); // Lift the previous place's box first, so the jump below can go anywhere
  map.fitBounds(bounds, { padding: FIT_PADDING, animate: false, bearing: 0 }); // Jump, don't fly, to this square, north-up again (showChange turns it to grid-up later). A brand-new map is already framed, so this changes nothing then; it matters when two calls shared one creation: the later place wins. It also fires "move", which updates the scale bar
  map.setMaxBounds(siteBounds(lon, lat, EXPLORE_RADIUS_M)); // The new place's box: people can pan up to 10 km from it
  await waitForIdle(); // Wait for the imagery to finish loading
} // End of showPlace

// Show "Search another address to explore further." while the visible map touches the edge of the place's box (maxBounds),
// so people know why the map stops moving. Runs on every map move, but only moves people make themselves (dragging, zoom
// buttons, keys, pinching) change it: those carry the browser event that caused them ("originalEvent"). When the app frames a
// new result, the view may just reach the box's side on a wide screen, and the message would pop up unasked over the square.
function updateEdgeNote(event) {
  if (!event?.originalEvent) return; // Moved by the app, not by a person: leave the message as it is (a new result hides it, see showChange)
  const box = map.getMaxBounds(); // The box (MapLibre's LngLatBounds), or null if none is set yet
  const note = document.getElementById('map-edge-note'); // The message
  if (!box) { note.hidden = true; return; } // No box: nothing to say
  const view = map.getBounds(); // What's visible now, as west/south/east/north
  const margin = (box.getEast() - box.getWest()) * 0.005; // "Touching" = within 0.5% of the box's width (about 100 m)
  note.hidden = !( // Show it when any side of the view reaches the box's side:
    view.getWest() <= box.getWest() + margin || view.getEast() >= box.getEast() - margin || // west or east
    view.getSouth() <= box.getSouth() + margin || view.getNorth() >= box.getNorth() - margin // south or north
  ); // End of the edge check
} // End of updateEdgeNote

// Download MapLibre and create the map, framed on "bounds". Only showPlace calls this, and only once at a time.
async function createMap(container, bounds) {
  maplibre = await import('maplibre-gl'); // "Dynamic import": download MapLibre now, only when it's needed (kept for later use)
  await import('maplibre-gl/dist/maplibre-gl.css'); // ...and its styles (buttons, attribution text)
  maplibre.setWorkerUrl(workerUrl); // Tell MapLibre where its worker script is (must happen before creating the map)
  map = new maplibre.MapLibreMap({ // Create the map (this fails with an error if the browser has no WebGL)
    container, // Draw inside this element
    bounds, // Start already framed on the square: no flying in from world view
    fitBoundsOptions: { padding: FIT_PADDING }, // Leave a little space around the square
    minZoom: MIN_ZOOM, // Don't allow zooming out further than the neighbourhood (see MIN_ZOOM)
    maxZoom: MAX_ZOOM, // ...or in further than single buildings
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
  map.on('move', updateEdgeNote); // Whenever the map moves, check whether it has reached the edge of the place's 10 km box (first, so the "Analyse this area" button below knows whether that message is showing)
  map.on('move', updateAnalyseOffer); // ...whether to offer "Analyse this area" (and where)
  setUpProposedGrip(); // The dashed square's grip: drag it (or use the arrow keys) to choose the spot to analyse
  map.on('move', placeColoursButton); // ...and whether the "Hide land cover" button still fits beside the label
  map.on('movestart', () => clearTimeout(settleTimer)); // Moving again: cancel a waiting head start (clearTimeout stops a setTimeout before it runs)
  map.on('moveend', waitForSettledOffer); // Stopped moving: start counting towards the head start
} // End of createMap

// ---------- The change layer ----------

// How see-through the change colors are: 0 = invisible, 1 = solid. At 0.75 the ground still shows through a little.
const CHANGE_OPACITY = 0.75;
// How much the land outside the analysis square is darkened: 0 = not at all, 1 = black
const OUTSIDE_DIM = 0.65;

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
  hideFindingTag(); // And its "Finding … imagery" tag, if it's still waiting
  analysedCorners = null; // No analysis square any more...
  updateAnalyseOffer(); // ...so no "Analyse this area" offer either
} // End of clearChange

// ---------- The before/after swipe ----------

let swipe = null; // The swipe while it's on the map: { before, canvas, handle, corners, fraction }, or null

// Remove the swipe: its layer, its source, its handle, and the listener that keeps the handle in place
function clearSwipe() {
  hideSwipeHint(); // Its hint goes with it
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
const ANALYSE_LABEL = 'Analyze this area'; // The button's normal text (CSS shows it in capitals)

// ---------- The dashed square: where "Analyse this area" will analyse ----------
// While panning, the dashed square follows the map's centre (like "Search this area" on other maps). Once it's "pinned" it
// stays on its spot on the ground instead: after a zoom, after people drag it by its grip, or when it's placed next to the
// result because the map was zoomed out. Zoomed out, people can drag it onto anything they can see (all within the 10 km box).
let proposedSpot = null; // The dashed square's centre as [lon, lat] while it's offered, or null when it isn't
let proposedPinned = false; // true: it stays on its ground spot; false: it follows the map's centre
let proposedBeside = false; // true: placed next to the result automatically (zoomed out); re-placed on every move until someone grabs it
let lastZoom = null; // The map's zoom at the last move, to tell zooming from panning
const ZOOMED_OUT_SHARE = 0.4; // The result's square counts as "zoomed out" when it's narrower than 40% of the map

// The spot "Analyse this area" analyses, as { lon, lat }: the dashed square's centre (or the map's centre if there's none)
export function getAnalyseSpot() {
  const [lon, lat] = proposedSpot ?? keepInSafeBox(map.getCenter().toArray()); // toArray() gives [lng, lat]
  return { lon, lat }; // Our names
} // End of getAnalyseSpot

// Extra room kept between a new result's view and the 10 km box's edge, in metres: more than the 100 m that counts as
// "touching" the edge (updateEdgeNote), plus a little for the slight grid-up turn of the map
const EDGE_SLACK_M = 200;

// The part of the 10 km box where an analysed square's centre may go, so that the new result's view (the square plus the
// room around it, as showChange frames it) fits inside the box. Otherwise the box stops the map short: the square ends up
// against the screen's edge, and its label (top) or "Hide land cover" button (bottom) is cut off. The room around the square
// depends on the screen's shape: a tall phone shows more ground above and below the square than beside it.
// Hands back { west, east, south, north } in degrees, or null when there's no box.
function safeBox() {
  const bounds = map.getMaxBounds(); // The 10 km box, or null
  if (!bounds) return null; // No box: no limit
  const el = map.getContainer(); // The map's box on the page
  const side = Math.min(el.clientWidth, el.clientHeight) - 2 * FIT_PADDING; // The square's size on screen once a result is framed (the map's shorter side, less the padding)
  const metresPerPixel = (2 * RADIUS_METERS) / side; // How many metres one pixel covers then
  const northSouth = RADIUS_METERS + ((el.clientHeight - side) / 2) * metresPerPixel + EDGE_SLACK_M; // From the centre to the view's top/bottom edge, plus slack, in metres
  const eastWest = northSouth; // The same distance on the left and right, so the safe box is the 10 km box shrunk evenly on all four sides. (The labels sit above and below the square, so top and bottom are what matter; at the sides, a wide desktop map may stop a little short, which only moves the square sideways on screen)
  const middle = bounds.getCenter().lat * (Math.PI / 180); // The box's middle latitude, in radians (Math.cos needs radians)
  const lonStep = eastWest / (METERS_PER_DEGREE * Math.cos(middle)); // The east-west distance in degrees of longitude
  const latStep = northSouth / METERS_PER_DEGREE; // The north-south distance in degrees of latitude
  return { west: bounds.getWest() + lonStep, east: bounds.getEast() - lonStep, south: bounds.getSouth() + latStep, north: bounds.getNorth() - latStep }; // The box, shrunk on every side
} // End of safeBox

// Move a [lon, lat] point to the nearest spot inside safeBox (a point already inside stays where it is)
function keepInSafeBox([lon, lat]) {
  const safe = safeBox(); // The allowed area
  if (!safe) return [lon, lat]; // No box: anything goes
  return [Math.min(Math.max(lon, safe.west), safe.east), Math.min(Math.max(lat, safe.south), safe.north)]; // Clamp each number between its two limits
} // End of keepInSafeBox

// Is a [lon, lat] point inside safeBox?
function insideSafeBox(lngLat) {
  const [lon, lat] = keepInSafeBox(lngLat); // Where clamping would put it
  return lon === lngLat[0] && lat === lngLat[1]; // Unmoved = it was inside
} // End of insideSafeBox

// The lowest a dashed square may reach on screen, in map pixels: 6 px above the scale bar's backing, so it never touches it
function bottomLimit() {
  const marks = document.querySelector('.map-marks'); // The north arrow and scale bar group
  const mapTop = map.getContainer().getBoundingClientRect().top; // Where the map starts on the page
  return marks.getBoundingClientRect().top - mapTop - 6; // The group's top edge in map pixels, less a 6 px gap
} // End of bottomLimit

// The highest a dragged dashed square's top may go, in map pixels. Normally the map's top edge. But while "Search another
// address to explore further." shows (top middle), the square stops lower, so its "Analyse this area" button fits between
// that message and the square, instead of being hidden under the message.
function topLimit() {
  const note = document.getElementById('map-edge-note'); // The message
  if (note.hidden) return 0; // Not showing: the map's top edge
  const mapTop = map.getContainer().getBoundingClientRect().top; // Where the map starts on the page
  const button = document.getElementById('analyse-area'); // The button that sits above the dashed square
  return note.getBoundingClientRect().bottom - mapTop + 6 + button.offsetHeight + 5; // Below the message: a 6 px gap, the button, and the button's 5 px gap to the square
} // End of topLimit

// Is a [lon, lat] point on screen, at least "margin" pixels inside the map's edges?
function onScreen(lngLat, margin = 0) {
  const p = map.project(lngLat); // Where it is on screen, in pixels
  const box = map.getContainer(); // The map's box
  return p.x >= margin && p.y >= margin && p.x <= box.clientWidth - margin && p.y <= box.clientHeight - margin; // Inside all four edges?
} // End of onScreen

// Is a [lon, lat] point inside the result's analysis square?
function insideAnalysed(lngLat) {
  const box = screenBox(analysedCorners); // The square's edges on screen
  const p = map.project(lngLat); // The point on screen
  return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom; // Within all four edges?
} // End of insideAnalysed

// A spot for the dashed square right next to the result's square, on screen and inside the 10 km box: where it appears
// when people zoom out. Worked out on screen, because zoomed out the result's label is wider than its square: to the right of
// the square or its label (whichever ends further right), else below (leaving room for "Hide land cover"), to the left,
// or above (leaving room for the label). Hands back [lon, lat], or null if there's no room anywhere.
function spotBesideResult() {
  const box = screenBox(analysedCorners); // The result's square on screen
  const side = squareSidePixels(); // The dashed square's size on screen
  const mapLeft = map.getContainer().getBoundingClientRect().left; // Where the map starts on the page (labels are measured on the page)
  const labelRight = areaLabel ? areaLabel.getElement().getBoundingClientRect().right - mapLeft : box.right; // The result label's right end, in map pixels
  const gap = 16; // Space between the result (or its label) and the dashed square, in pixels
  const middleX = (box.left + box.right) / 2; // The result's middle, across...
  const middleY = (box.top + box.bottom) / 2; // ...and down
  const candidates = [ // Screen points for the dashed square's centre, in order of preference:
    [Math.max(box.right, labelRight) + gap + side / 2, middleY], // right of the square and its label
    [middleX, box.bottom + 66 + side / 2], // below, past the "Hide land cover" button (5 px gap + 19 px) and the dashed square's own "Analyse this area" button above it (6 px gap + 30 px + 5 px)
    [box.left - gap - side / 2, middleY], // left
    [middleX, box.top - 40 - side / 2], // above, past the result's label (about 25 px tall with its gap)
  ]; // End of the candidates
  for (const [x, y] of candidates) { // Try each in turn
    const spot = map.unproject([x, y]).toArray(); // That screen point on the ground, as [lon, lat]
    const clearOfMarks = y + side / 2 <= bottomLimit(); // Its bottom stays above the scale bar?
    if (onScreen(spot, side / 2) && clearOfMarks && insideSafeBox(spot)) return spot; // Fully on screen, clear of the scale bar, and far enough inside the box: use it
  } // End of the candidates loop
  return null; // No room
} // End of spotBesideResult

// Would a dashed square centred on this [lon, lat] (with its "Analyse this area" button above it) run into the result's
// square or its labels (the "ANALYSIS AREA" label above, the "Hide land cover" button below)?
function crowdsResult(lngLat) {
  const box = screenBox(analysedCorners); // The result's square on screen
  const half = squareSidePixels() / 2; // Half the dashed square's side
  const p = map.project(lngLat); // The dashed square's centre on screen
  const ROOM = 30; // Space taken by a label or button above or below a square, in pixels
  const across = p.x - half < box.right && p.x + half > box.left; // Do they share any width? (the labels sit within the square's width or close to it)
  const down = p.y - half - ROOM - 5 < box.bottom + ROOM && p.y + half > box.top - ROOM; // Do they share any height, counting the labels?
  return across && down; // Both: they crowd each other
} // End of crowdsResult

// The 2 x 2 km square's side on screen, in pixels, at the current zoom
function squareSidePixels() {
  // How many metres one screen pixel covers here. MapLibre's world is 512 pixels wide at zoom 0 and doubles with each zoom
  // level; a degree of longitude shrinks towards the poles by cos(latitude), and the Mercator map stretches by the same amount.
  const latitude = (map.getCenter().lat * Math.PI) / 180; // The centre's latitude, in radians
  const metresPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) / (512 * 2 ** map.getZoom()); // Metres per screen pixel
  return (2 * RADIUS_METERS) / metresPerPixel; // 2 km in screen pixels
} // End of squareSidePixels

// Decide where the dashed square is (or that it isn't offered): runs on every map move, before it's drawn
function placeProposedSpot() {
  const zoomed = lastZoom !== null && map.getZoom() !== lastZoom; // Did this move change the zoom?
  lastZoom = map.getZoom(); // Remember for next time
  if (!analysedCorners) { proposedSpot = null; return; } // No result on the map: nothing to offer
  if (proposedSpot && zoomed && !proposedBeside) proposedPinned = true; // Zooming keeps a square on its ground spot (it doesn't jump back to the middle)
  if (proposedBeside) { proposedSpot = null; proposedPinned = false; proposedBeside = false; } // Placed beside the result automatically: work it out afresh below (labels keep their pixel size while the map zooms)
  if (proposedSpot && proposedPinned && !onScreen(proposedSpot)) { proposedSpot = null; proposedPinned = false; proposedBeside = false; } // Pinned but panned off-screen: start over at the centre
  const rawCentre = map.getCenter().toArray(); // The map's centre as [lon, lat]
  const centre = keepInSafeBox(rawCentre); // ...near the box's edge, held back where a result would still fit
  const held = centre[0] !== rawCentre[0] || centre[1] !== rawCentre[1]; // Was it held back?
  const box = screenBox(analysedCorners); // The result's square on screen
  const zoomedOut = box.right - box.left < ZOOMED_OUT_SHARE * map.getContainer().clientWidth; // Is the result's square small on screen?
  // Not pinned: follow the centre (offered once it leaves the result's square). But zoomed out (or held back at the box's
  // edge), a square at the centre that runs into the result's labels is skipped: the placement below finds a clear spot.
  if (!proposedPinned) proposedSpot = insideAnalysed(centre) || ((held || zoomedOut) && crowdsResult(centre)) ? null : centre;
  if (!proposedSpot && zoomedOut) { // Nothing offered, but zoomed out:
    proposedSpot = spotBesideResult(); // offer a square right next to the result (re-placed on every move until someone grabs it)...
    proposedPinned = proposedSpot !== null; // ...staying put meanwhile...
    proposedBeside = proposedSpot !== null; // ...and marked as placed automatically
  } // End of the zoomed-out check
} // End of placeProposedSpot

// Move the dashed square to a screen point (dragging, or the arrow keys), kept on screen and inside the 10 km box
function moveProposedTo(x, y) {
  const box = map.getContainer(); // The map's box
  const half = Math.min(squareSidePixels() / 2, box.clientWidth / 2, box.clientHeight / 2); // Keep the whole square visible (when it fits)
  const cx = Math.min(Math.max(x, half), box.clientWidth - half); // Clamp across...
  const cy = Math.min(Math.max(y, topLimit() + half), Math.max(half, bottomLimit() - half)); // ...and down (its top leaves room for its button, its bottom stays above the scale bar)
  const lngLat = keepInSafeBox(map.unproject([cx, cy]).toArray()); // That screen point on the ground, as [lon, lat], kept far enough inside the 10 km box for a result to fit
  proposedSpot = lngLat; // The new spot...
  proposedPinned = true; // ...stays put on the ground from now on...
  proposedBeside = false; // ...because the person chose it (it's no longer re-placed automatically)
  updateAnalyseOffer(); // Redraw the dashed square and the button there
} // End of moveProposedTo

// The grip: drag the dashed square with a finger, pen or mouse, or move it with the arrow keys. Set up once, with the map.
function setUpProposedGrip() {
  const grip = document.getElementById('proposed-grip'); // The grip in the middle of the dashed square
  grip.addEventListener('pointerdown', (event) => { // Pressed on the grip:
    grip.setPointerCapture(event.pointerId); // Keep receiving its moves even if it slides off the small grip
    grip.classList.add('is-dragging'); // The closed-hand look
    event.stopPropagation(); // The map mustn't start panning
  }); // End of pointerdown
  grip.addEventListener('pointermove', (event) => { // It moves:
    if (!grip.hasPointerCapture(event.pointerId)) return; // Only while pressed (a mouse just hovering doesn't count)
    const rect = map.getContainer().getBoundingClientRect(); // Where the map is on the page
    moveProposedTo(event.clientX - rect.left, event.clientY - rect.top); // Move the square's centre under the pointer
  }); // End of pointermove
  const release = () => { // Let go:
    grip.classList.remove('is-dragging'); // Back to the open hand
    afterProposedMove(); // Check where it landed
  }; // End of release
  grip.addEventListener('pointerup', release); // Released
  grip.addEventListener('pointercancel', release); // Or interrupted
  grip.addEventListener('keydown', (event) => { // A key on the focused grip:
    const step = squareSidePixels() / 5; // 400 m per press
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }; // Each arrow's direction
    if (!(event.key in moves) || !proposedSpot) return; // Another key (or nothing to move): leave it alone
    event.preventDefault(); // Stop the page or map from also reacting
    const p = map.project(proposedSpot); // Where the square is now, on screen
    moveProposedTo(p.x + moves[event.key][0], p.y + moves[event.key][1]); // Move it one step
    afterProposedMove(); // Check where it landed
  }); // End of the keyboard listener
} // End of setUpProposedGrip

// After a drag or key move: back on the result's square -> no offer (there's nothing new to analyse); otherwise start the
// head start for the new spot (the archive lookup, see waitForSettledOffer)
function afterProposedMove() {
  if (proposedSpot && insideAnalysed(proposedSpot)) { proposedSpot = null; proposedPinned = false; proposedBeside = false; } // Dropped back on the result: the offer goes (zoomed out, it comes back beside the result)
  updateAnalyseOffer(); // Redraw (or hide)
  waitForSettledOffer(); // A new spot: start the head start shortly
} // End of afterProposedMove

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
    if (offered && analysingCenter === null && onSettled) onSettled(getAnalyseSpot()); // Yes, and no analysis running: hand over the dashed square's spot
  }, SETTLE_MS); // ...SETTLE_MS from now
} // End of waitForSettledOffer

// Start or end the "analysing" state. "center" is the spot being analysed as [lon, lat], or null when it's over.
// While it runs, the dashed square stays pinned to that spot (it moves with the ground if people pan), and the button
// says "Analysing…" and ignores presses. "label" is the button's text afterwards (normally "Analyse this area").
export function setAnalysing(center, label = ANALYSE_LABEL) {
  analysingCenter = center; // Remember the spot (or forget it)
  const button = document.getElementById('analyse-area'); // The button
  button.textContent = center ? 'Analyzing…' : label; // Its text
  button.setAttribute('aria-disabled', center ? 'true' : 'false'); // Tell screen readers it can't be pressed now. ("disabled" would also take keyboard focus away from it)
  updateAnalyseOffer(); // Redraw the dashed square and the button
} // End of setAnalysing

// Show or hide the "Analyse this area" button and the dashed square, after every map move.
// Rule: they appear when the map's centre is outside the analysis square. Zooming or looking around inside it never triggers them.
function updateAnalyseOffer() {
  if (!map) return; // No map yet (e.g. the first place was cancelled before it loaded): nothing to update
  const button = document.getElementById('analyse-area'); // The button
  const proposed = document.getElementById('proposed-square'); // The dashed square
  if (analysingCenter === null) placeProposedSpot(); // Not analysing: decide where the dashed square is (follow the centre, stay pinned, or none)
  const shown = analysingCenter !== null || proposedSpot !== null; // Offer it when there's a spot, and always while an analysis runs
  button.hidden = !shown; // The button
  proposed.hidden = !shown; // ...and the dashed square
  document.getElementById('proposed-grip').hidden = analysingCenter !== null; // No grip while analysing (that spot is fixed)
  if (!shown) return; // Nothing more to do
  const spot = map.project(analysingCenter ?? proposedSpot); // Where the dashed square's centre goes on screen: the spot being analysed, or else the offered spot
  proposed.style.left = `${spot.x}px`; // Its centre across...
  proposed.style.top = `${spot.y}px`; // ...and down (CSS moves it back by half its size)
  const side = squareSidePixels(); // 2 km in screen pixels
  proposed.style.width = `${side}px`; // The dashed square's width...
  proposed.style.height = `${side}px`; // ...and height

  // The button sits just above the dashed square's top-left corner, like the "ANALYSIS AREA" label on the solid square.
  // When that corner is off-screen (zoomed in, or a square almost as tall as the map), it stops EDGE_GAP px inside the map.
  const EDGE_GAP = 8; // The closest the button gets to the map's edge, in pixels
  const squareLeft = spot.x - side / 2; // The dashed square's left edge on screen
  const squareTop = spot.y - side / 2; // ...and its top edge
  const rightmost = map.getContainer().clientWidth - button.offsetWidth - EDGE_GAP; // The furthest right the button can start and still fit on the map
  button.style.left = `${Math.max(EDGE_GAP, Math.min(squareLeft, rightmost))}px`; // Level with the square's left edge, but never off the map's left or right side
  let top = Math.max(EDGE_GAP, squareTop - button.offsetHeight - 5); // Its bottom 5 px above the square's top edge, but never off-screen
  const note = document.getElementById('map-edge-note'); // "Search another address to explore further." (top middle, shown at the box's edge)
  if (!note.hidden) { // That message is showing: keep the button out from under it
    const mapRect = map.getContainer().getBoundingClientRect(); // Where the map is on the page
    const noteRect = note.getBoundingClientRect(); // Where the message is on the page
    const buttonLeft = parseFloat(button.style.left); // The button's left edge in map pixels (as set above)
    const across = buttonLeft < noteRect.right - mapRect.left && buttonLeft + button.offsetWidth > noteRect.left - mapRect.left; // Do they overlap side to side?
    if (across) top = Math.max(top, noteRect.bottom - mapRect.top + 6); // Yes: put the button 6 px below the message
  } // End of the message check
  button.style.top = `${top}px`; // Place it
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
  if (swipeHint) { // The "drag left" hint, when it's showing: hide it while it's wider than the square (zoomed far out), so it doesn't spill over the map
    const hint = swipeHint.getElement(); // The hint itself
    hint.style.visibility = hint.offsetWidth + 16 > box.right - box.left ? 'hidden' : 'visible'; // "visibility" keeps its width measurable while hidden
  } // End of the hint check
} // End of placeHandle

// Whether people asked their device for less motion ("reduce motion" in the accessibility settings)
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// How long the change colours take to fade out or in, in milliseconds (instant with reduced motion)
const COLOUR_FADE_MS = REDUCE_MOTION ? 0 : 400;
// Let go this close to the left edge (as a share of the square's width) and the handle snaps onto it, bringing the colours back
const SNAP = 0.03;

// Show or hide the change colours. The handle at the left edge is the result view (all 2023, with colours);
// anywhere else is the comparison view (two clean photos), so the colours don't cover the earlier imagery.
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
// The hint that the colours come back at the left edge. After the opening the handle rests in the middle with the colours
// hidden, and people wouldn't know how to get them back. Shown just inside the square's bottom-left corner while the handle
// rests away from the left edge, until someone brings it there themselves once.
function showSwipeHint() {
  if (!swipe || swipe.fraction === 0 || hintLearned || swipeHint) return; // No swipe, colours already shown, already learned, or already showing
  const hint = document.createElement('div'); // A new element
  hint.className = 'area-label swipe-hint'; // The map labels' look, drawn above the swipe's line (style.css)
  hint.textContent = '◀ DRAG LEFT FOR LAND COVER'; // What to do (short enough for a phone)
  swipeHint = new maplibre.Marker({ element: hint, anchor: 'bottom-left', offset: [8, -8] }) // Pin its bottom-left corner, 8 px inside the square
    .setLngLat(swipe.corners[3]) // ...to the square's bottom-left corner (corners go top-left, top-right, bottom-right, bottom-left)
    .addTo(map); // ...and put it on the map
} // End of showSwipeHint

// Remove the hint, if it's showing
function hideSwipeHint() {
  if (swipeHint) swipeHint.remove(); // Take it off the map
  swipeHint = null; // And forget it
} // End of hideSwipeHint

// Someone moved the handle themselves (dragging or with the keyboard) and let go: at the left edge they've found the
// colours, so the hint is learned; anywhere else, remind them
function afterHandMove() {
  if (swipe.fraction === 0) { // At the left edge:
    hintLearned = true; // They know now
    hideSwipeHint(); // No hint needed
  } else showSwipeHint(); // Away from the edge: show the hint (unless it's learned)
} // End of afterHandMove

function setSwipe(fraction) {
  swipe.fraction = Math.min(1, Math.max(0, fraction)); // Keep it between 0 and 1 (min and max cap it at both ends)
  setColoursShown(swipe.fraction === 0); // Colours only in the result view (handle at the left edge)
  const percent = Math.round(swipe.fraction * 100); // How much of the square shows 2017, in percent
  swipe.handle.setAttribute('aria-valuenow', percent); // Tell screen readers the slider's value...
  swipe.handle.setAttribute('aria-valuetext', percent === 0 // ...and what it means, in words
    ? 'All latest imagery, with the change colors' // At the left edge
    : `${percent}% earliest imagery, colors hidden`); // Anywhere else
  drawBeforePart(swipe.before, swipe.canvas, swipe.fraction); // Redraw the visible part of 2017
  const source = map.getSource('before'); // The 2017 source
  source.play(); // A canvas source only sends a new drawing to the map while "playing": switch that on...
  source.pause(); // ...and straight off again: pausing sends the latest drawing once, so nothing keeps running in between
  placeHandle(); // Move the handle line
  updateColoursButton(); // Show the "HIDE / SHOW LAND COVER" button only with the handle at the left edge
  if (swipe.fraction === 0) hideSwipeHint(); // Colours showing: the hint isn't needed
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
  if (REDUCE_MOTION) { setSwipe(0.5); showSwipeHint(); return; } // Less motion wanted: go straight to the end position, without moving, and show the hint
  if (!(await waitUnlessStopped(400, myMotion))) return; // A short moment on 2017 first (stop if interrupted)
  if (!(await moveHandle(0, SWEEP_MS, myMotion))) return; // Sweep right to left: 2023 replaces 2017 (the colours fade in at the edge)
  if (!(await waitUnlessStopped(COLOUR_HOLD_MS, myMotion))) return; // Let the colours stay
  if (await moveHandle(0.5, GLIDE_MS, myMotion)) showSwipeHint(); // Glide to the middle (the colours fade out as it leaves the edge), then show the hint
} // End of playOpening

// Just the glide to the middle: for a swipe that arrives late, while people are already looking at the result
export function glideToMiddle() {
  if (!swipe) return; // No swipe: nothing to do
  if (REDUCE_MOTION) { setSwipe(0.5); showSwipeHint(); return; } // Less motion wanted: jump there, and show the hint
  moveHandle(0.5, GLIDE_MS, motion).then((arrived) => { if (arrived) showSwipeHint(); }); // Glide, then show the hint (not if the glide was interrupted)
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

// Show "FINDING EARLIER IMAGERY…" just inside the square's top-left corner (where the swipe's year tag will sit), while the
// swipe's earlier photo is still on its way after the result is shown. No year in it: the archive's closest photo to 2017 can be
// from a few years either side; the swipe's own tag shows its real date once it's here. "corners" are the square's corners as
// [lon, lat]. Removed by hideFindingTag, showSwipe, or a new place.
export function showFindingTag(corners) {
  hideFindingTag(); // Never two at once
  const tag = document.createElement('div'); // A new element
  tag.className = 'area-label finding-tag'; // The map labels' look (style.css), plus a gentle pulse while it waits
  tag.textContent = 'FINDING EARLIER IMAGERY…'; // What it says, in capitals like the other map labels
  findingTag = new maplibre.Marker({ element: tag, anchor: 'top-left', offset: [8, 8] }) // Pin its top-left corner, 8 px inside the square
    .setLngLat(corners[0]) // ...to the square's top-left corner
    .addTo(map); // ...and put it on the map
} // End of showFindingTag

// Remove the "Finding … imagery" tag, if there is one
export function hideFindingTag() {
  clearTimeout(findingTagTimer); // Cancel a planned removal (endFindingTag), if any
  if (findingTag) findingTag.remove(); // Take it off the map
  findingTag = null; // And forget it
} // End of hideFindingTag

// When no earlier photo is coming: the tag says why ("text") for a few seconds, without the pulse, then disappears.
// A new place or a new analysis in the meantime removes it at once (via hideFindingTag or showFindingTag).
const FINDING_END_MS = 5000; // How long the last words stay, in milliseconds
let findingTagTimer = null; // The planned removal, so it can be cancelled
export function endFindingTag(text) {
  if (!findingTag) return; // No tag on the map (e.g. it was already removed): nothing to do
  const tag = findingTag.getElement(); // The tag's element on the page
  tag.textContent = text; // The new words, e.g. "NO EARLIER IMAGERY HERE"
  tag.classList.add('is-done'); // Stop the "still working" pulse (style.css)
  clearTimeout(findingTagTimer); // Never two planned removals
  findingTagTimer = setTimeout(hideFindingTag, FINDING_END_MS); // Remove it after a few seconds
} // End of endFindingTag

// Show the before/after swipe: the 2017 picture inside the square, left of a handle that starts at the left edge.
// "before" is what buildBeforeImage made, "corners" the square's corners (for the handle), "tags" the two year tags'
// text ({ before: "2017 · 21 OCT", after: "2023 · 1 FEB" }), "start" where the handle begins (0 = left edge, 1 = right edge).
// Call after showChange.
export function showSwipe(before, corners, tags, start = 0) {
  clearSwipe(); // Remove any earlier one first
  hideFindingTag(); // The earlier photo is here: no more "Finding … imagery" tag
  hintLearned = false; // A new result (a new place, or "Analyse this area"): show the "drag left" hint again after its opening
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
    afterHandMove(); // At the left edge: hint learned; elsewhere: show the hint
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
    afterHandMove(); // At the left edge: hint learned; elsewhere: show the hint
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
let baseTiles = null; // The archive tile address the map shows now, or null for Esri's current imagery (since speed-up phase 4 always null: the "after" photo is the current imagery)

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
  document.getElementById('map-edge-note').hidden = true; // A new result starts without "Search another address…" (it shows again once people pan to the box's edge)
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
  proposedSpot = null; // A new result: the dashed square starts over...
  proposedPinned = false; // ...following the map's centre
  proposedBeside = false; // (not placed beside anything yet)
  updateAnalyseOffer(); // Check it once now (the centre is inside the new square, so nothing is offered)

  await waitForIdle(); // Turning the map can reveal a little new ground at the edges: wait until its imagery has loaded too
} // End of showChange
