// The long view: how a place turned since 1985, as one Landsat photo of the 15 × 15 km square around it every 5 years.
// Photos only: nothing here is measured. The photo fills the stage (the map stays underneath, untouched), and the panel
// shows the year scrubber, a play button and the title block. main.js opens and closes it (and switches the panel).

import { streamLongView } from './api.js'; // The request that brings the photos piece by piece
import { tagText } from './swipe.js'; // Writes a date as a map tag, e.g. "1995 · AUG 9" (the swipe's tags use it too)

// ---------- Settings ----------

const DEFAULT_SLOTS = [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]; // The slots shown before the backend's first piece names them (the backend's own list, backend/app/longview.py)
const PHOTO_PX = 500; // The backend's photos are 500 × 500 pixels (the square's outline is drawn in these pixels)
const SQUARE_M = 15000; // ...covering 15 × 15 km
const PLAY_STEP_MS = 1100; // While playing, each year stays this long (1.1 s): long enough to see what changed
const AUTOPLAY_DELAY_MS = 700; // Once every photo is in, a short pause on 1985 before playing starts on its own
const NARROW_STAGE_PX = 700; // Stages this narrow or narrower count as phones (the same width as the map's narrow rules)
const MARGIN_NARROW_PX = 12; // Space around the photo on phones...
const MARGIN_WIDE_PX = 28; // ...and on wide screens (the panel's inner margin, so the page's rhythm repeats)
const SCALE_LENGTHS_M = [1000, 2000, 5000]; // The scale bar shows one of these lengths: the longest that fits
const SCALE_MAX_PX = 160; // The longest the scale bar may be (the map's own scale bar uses the same limits)...
const SCALE_MAX_PX_NARROW = 100; // ...and on phones
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)'); // Did the person ask their device for less motion?

// ---------- The page's parts ----------

const view = document.getElementById('longview'); // The long view on the stage
const stage = view.parentElement; // The stage it covers
const frame = document.getElementById('longview-frame'); // The square photo area
const photos = document.getElementById('longview-photos'); // Where the photos are stacked
const empty = document.getElementById('longview-empty'); // The words shown in place of a photo
const squareTrack = document.querySelector('.longview-square-track'); // The analysis square's dark line...
const squareLine = document.querySelector('.longview-square-line'); // ...and its light line
const squareLabel = document.getElementById('longview-square-label'); // Its label
const tag = document.getElementById('longview-tag'); // The year tag in the photo's corner
const north = document.getElementById('longview-north'); // The north arrow
const scale = document.getElementById('longview-scale'); // The scale bar
const scaleMid = document.getElementById('longview-scale-mid'); // Its middle label
const scaleEnd = document.getElementById('longview-scale-end'); // Its end label
const kicker = document.getElementById('longview-kicker'); // The panel's small top line
const title = document.getElementById('longview-title'); // The panel's heading
const dateLabel = document.getElementById('longview-date'); // The shown photo's date and satellite
const yearOutput = document.getElementById('longview-year'); // The shown year, large
const play = document.getElementById('longview-play'); // The play button
const range = document.getElementById('longview-range'); // The year slider
const ticks = document.getElementById('longview-ticks'); // Its ticks
const note = document.getElementById('longview-note'); // One line about the loading or the shown photo
const progress = document.getElementById('longview-progress'); // The progress bar...
const progressFill = progress.querySelector('i'); // ...and its fill
const squareToggle = document.getElementById('longview-square-toggle'); // The "Analysis area" switch
const layersLabel = document.getElementById('longview-layers-label'); // Its "Show on photo" label
const layers = squareToggle.closest('ul'); // The list holding it

// ---------- State ----------

// The open long view, or null when it's closed: { place, analysisCorners, head, frames (slot -> frame), images (slot -> <img>),
// index (the shown slot's position), timer (while playing), controller (cancels the request), squarePixels }
let open = null;
// Long views already loaded during this visit, by rounded place, so opening the same one again is instant (and needs no download)
const loaded = new Map();
// Watches the stage's size while the long view is open, so the photo always fits (e.g. turning a phone)
const resizeWatcher = new ResizeObserver(() => layout());

// ---------- Opening and closing ----------

// Open the long view for a place: "analysisCorners" are the 2 × 2 km square's corners as [lon, lat] (or null if there's no
// square), "coordsText" the place's coordinates as text, for the panel's top line.
export function openLongView(place, analysisCorners, coordsText) {
  closeLongView(); // Close any earlier one first (stops its playing and its request)
  open = { place, analysisCorners, head: null, frames: new Map(), images: new Map(), index: 0, timer: null, controller: new AbortController(), squarePixels: null, coordsText }; // A fresh state
  photos.replaceChildren(); // No photos yet
  tag.textContent = ''; // No year tag yet
  squareTrack.removeAttribute('points'); // No square yet (it's drawn once the photos' corners are known)
  squareLine.removeAttribute('points'); // ...
  squareLabel.hidden = true; // ...and no label
  layersLabel.hidden = !analysisCorners; // The "Show on photo" switch only when there's a square to switch...
  layers.hidden = !analysisCorners; // ...(its state stays as the person left it, for the whole visit)
  buildTicks(DEFAULT_SLOTS); // The usual slots, until the backend says which
  setControlsReady(false); // Slider and play button wait for the photos
  writeHeading(DEFAULT_SLOTS); // "Fontana from 1985 to 2025" and the top line, with the usual slots until the backend says
  view.hidden = false; // Show the long view on the stage
  resizeWatcher.observe(stage); // Keep the photo fitted while it's open (this also runs layout once now)
  showIndex(0); // 1985 first ("Finding summer photos…" until it's here)
  load(open); // Fetch the photos (from this visit's memory, or the backend)
} // End of openLongView

// Close the long view: stop playing, cancel a request still running, and uncover the map
export function closeLongView() {
  if (!open) return; // Already closed
  stopPlaying(); // No more year changes
  open.controller.abort(); // Cancel the request if it's still coming in (the backend still finishes and saves the photos)
  open = null; // Forget it
  resizeWatcher.disconnect(); // Stop watching the stage's size
  view.hidden = true; // Uncover the map
} // End of closeLongView

// The heading and the top line, naming the real first and last slot (like the result sentence names the real years):
// the place's name underlined like in the result sentence, or "This place" for a spot without a name
function writeHeading(slots) {
  const [first, last] = [slots[0], slots.at(-1)]; // e.g. 1985 and 2025 ("at(-1)" = the last item)
  kicker.textContent = `${open.coordsText} · ${first} → ${last}`; // e.g. "34.0922° N, 117.4350° W · 1985 → 2025"
  const name = document.createElement('em'); // The name, in the result sentence's style (a thin underline)
  name.textContent = open.place.name ?? 'This place'; // Typed as text, never as HTML, so a name can't break the page
  title.replaceChildren(name, ` from ${first} to ${last}`); // e.g. "Fontana from 1985 to 2025"
} // End of writeHeading

// ---------- Loading the photos ----------

// Fetch the photos for an open long view: from this visit's memory if it was loaded before, otherwise from the backend,
// which sends each photo as soon as it's ready (all at once when it has them saved).
async function load(state) {
  const key = `${state.place.lat.toFixed(2)},${state.place.lon.toFixed(2)}`; // The backend rounds places to 0.01°, so this names the same photos
  const remembered = loaded.get(key); // Loaded before during this visit?
  if (remembered) { // Yes: use it, no download
    receiveHead(state, remembered.head); // The corners and slots
    for (const piece of remembered.frames) receiveFrame(state, piece); // Every photo
    return; // Done (receiveFrame noticed when the last one was in)
  } // End of the remembered case
  try { // Ask the backend:
    await streamLongView( // The photos, piece by piece
      state.place.lat, state.place.lon, // The place
      (head) => receiveHead(state, head), // First piece: corners and slots
      (piece) => receiveFrame(state, piece), // Each photo as it comes
      state.controller.signal, // Closing the long view cancels it
    ); // End of the request
  } catch (error) { // It failed (or was cancelled):
    if (state !== open) return; // Cancelled because the view was closed (or replaced): nothing to say
    console.error(error); // The details for the developer console (F12)
    note.textContent = "Couldn't load the photos right now. Close this view and try again in a moment."; // Say so plainly, with what to do
    progress.hidden = true; // No progress to show
    showIndex(open.index); // Refresh the shown year (it says what's missing)
    return; // Stop here
  } // End of the failure case
  if (state === open && state.frames.size === state.head?.slots.length) { // Every photo arrived (and the view is still open):
    loaded.set(key, { head: state.head, frames: [...state.frames.values()] }); // Remember them for this visit
  } // End of the remember step
} // End of load

// The first piece: the photos' corners (to line up the square and the north arrow) and the slots
function receiveHead(state, head) {
  if (state !== open) return; // Closed meanwhile: ignore
  state.head = head; // Keep it
  buildTicks(head.slots); // One tick per slot
  writeHeading(head.slots); // The heading with the real first and last slot
  drawSquare(); // The analysis square on the photos
  turnNorthArrow(head.corners); // The north arrow to true north
  showProgress(); // "0 of 9"
} // End of receiveHead

// A photo (or a year without one) has arrived
function receiveFrame(state, piece) {
  if (state !== open) return; // Closed meanwhile: ignore
  state.frames.set(piece.slot, piece); // Keep it, by slot
  if (piece.image) { // A real photo:
    const img = document.createElement('img'); // A new picture...
    img.src = piece.image; // ...from the backend's data URL
    img.alt = ''; // Decorative: the frame itself carries the description for screen readers (see showIndex)
    img.decoding = 'async'; // Decode it without holding up the page
    photos.append(img); // Stack it with the others (hidden until shown)
    state.images.set(piece.slot, img); // Keep it, by slot
  } // End of the photo case
  showProgress(); // "3 of 9"
  const slots = state.head?.slots ?? []; // The slots (known by now: the first piece always comes first)
  if (slots[state.index] === piece.slot) showIndex(state.index); // The shown year just arrived: show it
  if (state.frames.size === slots.length) everythingIn(state); // The last one: ready to play
} // End of receiveFrame

// The loading line and bar: real progress, one step per photo
function showProgress() {
  const total = open.head?.slots.length ?? 9; // How many photos there will be
  const count = open.frames.size; // How many are in
  progressFill.style.width = `${(count / total) * 100}%`; // The bar's fill
  if (count < total) note.textContent = `Finding summer photos · ${count} of ${total}`; // e.g. "Finding summer photos · 3 of 9"
} // End of showProgress

// Every photo is in: hide the progress, wake the controls, and play once from 1985 (unless the person asked for less motion)
function everythingIn(state) {
  progress.hidden = true; // No more progress to show
  setControlsReady(true); // Slider and play button work now
  showIndex(state.index); // Refresh the line under the slider (it no longer says "Finding…")
  if (reduceMotion.matches) return; // Less motion: stay on 1985; the play button is there
  setTimeout(() => { if (state === open && state.index === 0 && !state.timer) startPlaying(); }, AUTOPLAY_DELAY_MS); // A moment on 1985, then play (unless the person already moved the slider)
} // End of everythingIn

// Wake (or put to sleep) the slider and the play button
function setControlsReady(ready) {
  range.disabled = !ready; // The slider
  play.disabled = !ready; // The play button
  progress.hidden = ready; // The progress bar shows only while loading
  if (!ready) progressFill.style.width = '0%'; // An empty bar to start with
} // End of setControlsReady

// ---------- Showing a year ----------

// The slider's ticks: one per slot, labelled with the short year, e.g. "’85"
function buildTicks(slots) {
  range.max = slots.length - 1; // One slider step per slot
  ticks.replaceChildren(...slots.map((slot) => { // One tick per slot:
    const tick = document.createElement('span'); // A new element
    tick.textContent = `’${String(slot).slice(2)}`; // "’85": the apostrophe stands for the missing "19"
    return tick; // Hand it to replaceChildren
  })); // End of the ticks
} // End of buildTicks

// Show the slot at a position (0 = the first, 1985): its photo, the year tag, the panel's lines and the slider
function showIndex(index) {
  if (!open) return; // Closed: nothing to show
  open.index = index; // Remember it
  const slots = open.head?.slots ?? DEFAULT_SLOTS; // The slots (the usual ones until the backend says)
  const slot = slots[index]; // e.g. 1995
  const piece = open.frames.get(slot); // Its photo's details, if it has arrived
  for (const [imgSlot, img] of open.images) img.classList.toggle('is-shown', imgSlot === slot); // Show only this year's photo
  yearOutput.textContent = slot; // The big year
  range.value = index; // The slider's handle
  range.style.setProperty('--filled', `${(index / (slots.length - 1)) * 100}%`); // How much of the track is ink
  if (!piece || !piece.image) { // No photo to show (yet, or at all):
    const words = piece ? `No clear summer photo near ${slot}` : 'Finding summer photos…'; // Missing, or still coming
    empty.textContent = words; // Said in the frame
    empty.hidden = false; // Shown
    tag.textContent = ''; // No year tag
    dateLabel.textContent = piece ? 'No photo' : ''; // The panel's date line
    frame.setAttribute('aria-label', words); // What screen readers hear for the frame
    range.setAttribute('aria-valuetext', `${slot}: ${piece ? 'no photo' : 'loading'}`); // ...and for the slider
    if (piece && open.frames.size === slots.length) note.textContent = `No clear summer photo within two years of ${slot}.`; // Explain the gap (once loading is over)
    return; // Nothing more to show
  } // End of the no-photo case
  empty.hidden = true; // A photo: no words in the frame
  const longDate = new Date(`${piece.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); // e.g. "Aug 9, 1995" ("T00:00": local midnight, so the day doesn't shift)
  tag.textContent = `${tagText(piece.date)} · ${piece.satellite}`; // e.g. "1995 · AUG 9 · LANDSAT 5" (CSS shows it in capitals)
  dateLabel.textContent = `${longDate} · ${piece.satellite}`; // e.g. "Aug 9, 1995 · Landsat 5"
  frame.setAttribute('role', 'img'); // The frame is one picture for screen readers...
  frame.setAttribute('aria-label', `Satellite photo of the area, ${longDate}, ${piece.satellite}`); // ...described in words
  range.setAttribute('aria-valuetext', `${slot}: photo from ${longDate}`); // What screen readers say for the slider
  if (open.frames.size === slots.length) { // Loading is over, so the line under the slider is about the photo:
    note.textContent = piece.substituted ? `No clear summer photo in ${slot}, so this one is from ${piece.year}.` : ''; // Say when another year stood in (and nothing otherwise)
  } // End of the note
} // End of showIndex

// ---------- Playing ----------

// Start playing from the shown year to the last (from the first, if the last is shown)
function startPlaying() {
  if (!open || open.timer) return; // Closed, or already playing
  const last = Number(range.max); // The last position
  if (open.index >= last) showIndex(0); // At the end: start again from 1985
  play.classList.add('is-playing'); // The pause drawing
  play.setAttribute('aria-label', 'Pause'); // What screen readers say
  open.timer = setInterval(() => { // Every PLAY_STEP_MS:
    if (!open) return; // Closed meanwhile (closeLongView stops the timer too)
    if (open.index >= last) { stopPlaying(); return; } // At the last year: stop there
    showIndex(open.index + 1); // The next year
  }, PLAY_STEP_MS); // End of the timer
} // End of startPlaying

// Stop playing (the shown year stays)
function stopPlaying() {
  if (open?.timer) clearInterval(open.timer); // Stop the timer
  if (open) open.timer = null; // Forget it
  play.classList.remove('is-playing'); // The play drawing again
  play.setAttribute('aria-label', 'Play'); // What screen readers say
} // End of stopPlaying

// The "Analysis area" switch: show or hide the square and its label on the photo (playing carries on either way)
squareToggle.addEventListener('click', () => {
  const on = squareToggle.getAttribute('aria-pressed') !== 'true'; // The new state: the opposite of now
  squareToggle.setAttribute('aria-pressed', String(on)); // Tell screen readers (and CSS, which dims the row when off)
  frame.classList.toggle('square-off', !on); // Hide or show the square on the photo (style.css)
}); // End of the switch listener

play.addEventListener('click', () => { if (open?.timer) stopPlaying(); else startPlaying(); }); // The button plays or pauses
range.addEventListener('input', () => { stopPlaying(); showIndex(Number(range.value)); }); // Moving the slider (or arrow keys) stops playing and shows that year

// ---------- Fitting the photo, the square and the marks ----------

// Size the photo to the largest square that fits the stage, then place everything that depends on its size
function layout() {
  if (!open) return; // Closed: nothing to fit
  const narrow = stage.clientWidth <= NARROW_STAGE_PX; // A phone-sized stage?
  const margin = narrow ? MARGIN_NARROW_PX : MARGIN_WIDE_PX; // The space around the photo
  const side = Math.floor(Math.min(stage.clientWidth, stage.clientHeight) - 2 * margin); // The largest square that fits, in whole pixels
  frame.style.width = `${side}px`; // The photo's width...
  frame.style.height = `${side}px`; // ...and height
  placeSquareLabel(side); // The square's label follows the photo's size
  drawScaleBar(side, narrow); // So does the scale bar
} // End of layout

// Where a [lon, lat] point falls on the photo, in the photo's own pixels (0 to 500). The photo's corners are known as
// [lon, lat], and over 15 km the step from one to the other is straight enough to treat as a flat grid: so we find how far
// along the top edge (u) and down the left edge (v) the point is, by solving two small equations.
function toPhotoPixels([lon, lat], corners) {
  const [topLeft, topRight, , bottomLeft] = corners; // Three of the photo's corners (top-left, top-right, bottom-left)
  const ax = topRight[0] - topLeft[0]; // The top edge, east-west part...
  const ay = topRight[1] - topLeft[1]; // ...and north-south part
  const bx = bottomLeft[0] - topLeft[0]; // The left edge, east-west part...
  const by = bottomLeft[1] - topLeft[1]; // ...and north-south part
  const px = lon - topLeft[0]; // The point, from the top-left corner: east-west...
  const py = lat - topLeft[1]; // ...and north-south
  const det = ax * by - ay * bx; // The equations' "determinant" (never 0 for a real square)
  const u = (px * by - py * bx) / det; // How far along the top edge (0 = left edge, 1 = right edge)
  const v = (ax * py - ay * px) / det; // How far down the left edge (0 = top, 1 = bottom)
  return [u * PHOTO_PX, v * PHOTO_PX]; // In the photo's pixels
} // End of toPhotoPixels

// Draw the analysis square on the photo (its outline lives in the photo's own pixels, so it scales with the photo)
function drawSquare() {
  if (!open?.head || !open.analysisCorners) return; // Not known yet, or no square for this place
  const points = open.analysisCorners.map((corner) => toPhotoPixels(corner, open.head.corners)); // Its four corners on the photo
  const text = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '); // As SVG points, e.g. "233.1,240.5 ..."
  squareTrack.setAttribute('points', text); // The dark line...
  squareLine.setAttribute('points', text); // ...and the light one
  open.squarePixels = points; // Keep them, for the label
  squareLabel.hidden = false; // Show the label...
  placeSquareLabel(frame.clientWidth); // ...at the square's corner
} // End of drawSquare

// Put the square's label just above its top-left corner, at the photo's current size
function placeSquareLabel(side) {
  if (!open?.squarePixels) return; // No square yet
  const [x, y] = open.squarePixels[0]; // The top-left corner, in photo pixels
  squareLabel.style.left = `${(x / PHOTO_PX) * side}px`; // In screen pixels from the photo's left edge...
  squareLabel.style.top = `${(y / PHOTO_PX) * side}px`; // ...and top edge (CSS lifts the label above the corner)
} // End of placeSquareLabel

// Turn the north arrow to true north. The photos are "grid-up" (their up is the UTM grid's north), which differs from
// true north by a small angle (grid convergence: about 0.3° in California, about 3° in Stavanger), like the map.
function turnNorthArrow(corners) {
  const [topLeft, , , bottomLeft] = corners; // The photo's left edge runs from bottom-left up to top-left: that's grid north
  const latRadians = (topLeft[1] * Math.PI) / 180; // The latitude in radians, which Math.cos needs
  const dx = (topLeft[0] - bottomLeft[0]) * Math.cos(latRadians); // How far east grid north leans (degrees of longitude shrink toward the poles)
  const dy = topLeft[1] - bottomLeft[1]; // How far north it goes
  const gridBearing = (Math.atan2(dx, dy) * 180) / Math.PI; // Grid north's direction as a compass bearing (0 = true north, positive = east of it)
  north.style.transform = `rotate(${-gridBearing}deg)`; // In the photo, true north is turned the other way by the same angle
} // End of turnNorthArrow

// The scale bar: the longest of 1, 2 or 5 km that fits, drawn at the photo's scale (15 km across the photo's width)
function drawScaleBar(side, narrow) {
  const metersPerPixel = SQUARE_M / side; // How many meters one screen pixel covers on the photo
  const maxPixels = narrow ? SCALE_MAX_PX_NARROW : SCALE_MAX_PX; // The longest the bar may be
  let meters = SCALE_LENGTHS_M[0]; // Start with the shortest length
  for (const length of SCALE_LENGTHS_M) if (length / metersPerPixel <= maxPixels) meters = length; // Keep the longest that fits
  scale.style.width = `${meters / metersPerPixel}px`; // The bar, exactly that long on screen
  scaleMid.textContent = String(meters / 2000); // The middle label in km, e.g. "1"
  scaleEnd.textContent = `${meters / 1000} km`; // The end label, e.g. "2 km"
  scale.style.marginRight = `${scaleEnd.offsetWidth / 2}px`; // The end label hangs half past the bar's end: make room for it inside the backing
} // End of drawScaleBar
