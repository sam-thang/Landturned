// Bring in tools from D3: the globe projection, a "path" drawer, the latitude/longitude grid,
// a function that measures the distance between two places on the globe,
// a function that finds the in-between points on the shortest route between two places,
// an "easing" curve that makes movements start and end gently,
// and a test that tells whether a point lies inside a shape (we use it to check "is this tap on land?")
import { geoOrthographic, geoPath, geoGraticule10, geoDistance, geoInterpolate, easeCubicInOut, geoContains } from 'd3';
// Bring in our list of hotspot places from places.js
import { PLACES } from './places.js';
// Bring in the tool that unpacks TopoJSON (the compact map format) into shapes D3 can draw
import { feature } from 'topojson-client';
// Bring in the world's land outlines (Natural Earth, 1:50 million scale, the more detailed version) from the world-atlas package
import landTopology from 'world-atlas/land-50m.json';

// Unpack the land outlines from TopoJSON into normal shapes ("GeoJSON")
const land = feature(landTopology, landTopology.objects.land);
// Make the grid of latitude and longitude lines, one line every 10 degrees
const graticule = geoGraticule10();

// Where the globe faces when the page opens: the western Atlantic, showing the Americas and the edge of Europe and Africa
const START_VIEW = { lon: -60, lat: 20 };

// How fast the globe spins by itself, in degrees per millisecond (0.004 = 4° per second, one full turn in 90 seconds)
const SPIN_SPEED = 0.004;
// How long the globe must rest untouched before the slow spin starts again, in milliseconds (2.5 seconds)
const SPIN_PAUSE_MS = 2500;
// How long the slow spin takes to speed up gently from standstill to full speed, in milliseconds (1.5 seconds)
const SPIN_EASE_MS = 1500;

// ---------- "Feel" settings for flinging the globe (tune these by trying them on a phone) ----------
// Friction: a flung globe loses half its speed every this many milliseconds. Bigger = it coasts longer.
// How far a fling coasts = its speed × half-life ÷ 0.69, so with the numbers below the longest coast is about 70°.
const FRICTION_HALF_LIFE_MS = 250;
// The fastest a fling can spin the globe, in degrees per millisecond (0.2 = 200° per second, about half a turn per second).
// On a phone the globe is small, so even a gentle swipe reaches this limit: this number decides how "whippy" flings feel.
const MAX_FLING_SPEED = 0.2;
// Below this speed (degrees per millisecond) a coasting globe counts as stopped
const STOP_SPEED = 0.002;
// A globe turning faster than this (degrees per millisecond) counts as "moving": pressing it only catches it, it's not a tap.
// It's 5 times the slow spin, so tapping a hotspot on the slowly spinning globe still works.
const CATCH_SPEED = SPIN_SPEED * 5;
// If the finger rests this long (milliseconds) before letting go, there's no fling: the globe was being held still
const HOLD_STILL_MS = 80;
// ---------- Zooming the globe ----------
// The smallest and biggest zoom people can choose: 1 = the whole globe fits, 4 = four times bigger (about one continent)
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
// How strongly one scroll of the mouse wheel zooms: bigger = faster. A typical wheel click (100 "pixels") zooms about 22%.
const WHEEL_ZOOM_SPEED = 0.002;
// The furthest the globe can be tilted north or south, in degrees, so it can't flip upside down
const MAX_TILT = 70;
// True if the user has asked their computer to reduce motion (an accessibility setting)
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How long the globe takes to turn to a chosen place, in milliseconds (1.6 seconds).
// "export" lets main.js use it too, so the progress bar can fill in step with the turn.
export const TURN_MS = 1600;
// How far (in pixels) the pointer may move between press and release and still count as a click, not a drag
const CLICK_TOLERANCE = 3;

// How long one hotspot "pulse" (a ring growing and fading) takes, in milliseconds
const PULSE_MS = 1800;
// For people who turned on "reduce motion": the ring doesn't pulse but stays still at this point of the pulse
// (0.45 = about 10 px across and half faded), so it still marks a highlighted place, just calmly
const STILL_PULSE = 0.45;
// How close (in pixels) the mouse must be to a hotspot to count as hovering over it
const HOVER_RADIUS = 18;
// Hotspots further than this from the center of the view are on the back of the globe and not drawn.
// Measured in radians (an angle unit: 1.5 radians ≈ 86°; the globe's visible edge is at 90°).
const MAX_VISIBLE_DISTANCE = 1.5;

// ---------- The pin (the tapped spot), drawn as a survey mark: a circle with a cross through it ----------
const PIN_RING = 6; // Radius of the circle, in pixels
const PIN_GAP = 2.5; // The cross's arms start this far from the center, leaving the exact spot open
const PIN_ARM = 11; // ...and end this far out, a little beyond the circle
const PIN_INK = 'rgba(240, 244, 248, 0.95)'; // Off-white, like the coastlines but stronger; the four colors are kept for change types
const PIN_HALO = '#0c1015'; // The ocean color, drawn wide underneath to cut a clean gap through coastlines and grid lines
// ---------- The water note ----------
const WATER_NOTE_MS = 2000; // How long "That's water. Tap the land." stays up, in milliseconds (2 seconds)
const WATER_NOTE_GAP = 12; // How far above the tapped spot the note's bottom edge sits, in pixels (clear of the fingertip)
const TOUCH = window.matchMedia('(pointer: coarse)').matches; // True on touch screens (the main pointer is a finger), so the note says "tap", else "click"

const CAPTION_ROOM = 38; // Phones: the strip at the top of the globe area kept for the caption, in pixels (14 px gap + the line + a gap below)

// How big the globe is (its radius in pixels at zoom 1) in a globe area "width" x "height" pixels.
// Wide screens: 40% of the shorter side, which leaves the big stage calm space around it.
// Phones (narrower than 900 px, the same line style.css uses): 45%, as the key is gone there, but never so big that the
// globe's top reaches into the caption strip.
function globeRadius(width, height) {
  const shorter = Math.min(width, height); // The shorter side of the globe area
  if (window.innerWidth >= 900) return shorter * 0.4; // Wide screens: 40%
  return Math.min(shorter * 0.45, height / 2 - CAPTION_ROOM); // Phones: 45%, or less if the caption needs the room
} // End of globeRadius

// Below this stage width (in pixels) the pin card sits above the mark instead of beside it.
// Must match the "@container (max-width: 700px)" rules in style.css, where the callout's label moves above its ring the same way.
const COMPACT_WIDTH = 700;

// Read the four change colors from the CSS tokens in style.css, so each color is defined in one place only
// We read them when drawing, not once at page load: on phones, Safari sometimes runs our code before the stylesheet
// is applied, and an early read gives empty text. A canvas ignores an empty color and reuses its last one, which
// turned the rings grey and the dots invisible.
const changeColors = {}; // Colors we've read successfully, e.g. { built: '#ffa01f' }; starts empty
function changeColor(type) {
  if (!changeColors[type]) { // Not read yet, or the last read came back empty:
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--${type}`).trim(); // Read the token, e.g. "--built", from the <html> element; trim() removes spaces around it
    if (value) changeColors[type] = value; // Keep it only if it's real, so an empty read is tried again next frame
  } // End of the read check
  return changeColors[type] || '#ffffff'; // The color, or plain white until the stylesheet is ready (never empty)
} // End of changeColor

// Keep a latitude within the allowed tilt, so the globe never flips upside down
function limitTilt(lat) {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, lat)); // Not below -70°, not above 70°
} // End of limitTilt

// Draw the globe on the given canvas, with a teaser box for hovered hotspots.
// "onSelectPlace" is a function to call when the user clicks a hotspot.
// "pinCard" is the card shown beside a tapped spot; the globe moves it so it follows the pin.
// "onPinChange" is a function to call when the pin moves or goes away; it gets the spot as [lon, lat], or null when cleared.
// "waterNote" is the small "That's water. Tap the land." box shown beside an ocean tap.
// Returns an object with a turnTo function, so other code can tell the globe where to look.
// "export" lets main.js use this function.
export function startGlobe(canvas, teaser, pinCard, onSelectPlace, onPinChange, waterNote) {
  const context = canvas.getContext('2d'); // The "2D context" is the set of drawing tools for the canvas
  const projection = geoOrthographic() // The orthographic projection: the Earth as seen from far out in space
    .clipAngle(90) // Hide everything more than 90° from the center, i.e. the far side of the globe
    .precision(0.6); // How closely curved lines are followed (smaller = smoother but slower)
  const path = geoPath(projection, context); // A drawer that turns map shapes into lines on our canvas, using the projection
  const view = { ...START_VIEW, zoom: 1 }; // The current view: a copy of START_VIEW ("..." copies it) plus a zoom factor (1 = whole globe)
  let visibleHotspots = []; // The hotspots drawn in the last frame, with their screen positions, for hover checks
  let hoveredPlace = null; // The place the mouse is currently over, or null for none
  let turn = null; // The turn in progress, or null when not turning
  let focused = false; // True once a place has been chosen; the globe then stops spinning by itself
  let pin = null; // The tapped spot as [lon, lat], or null when there is no pin; the globe doesn't spin while a pin is set
  let interactive = true; // False while the app is busy (e.g. zooming to a place): dragging, hovering, and clicking are ignored
  let visible = true; // False while the globe is hidden behind the map; then we skip drawing to save battery

  // Match the canvas's pixel size to its size on screen, then redraw
  function resize() {
    const ratio = window.devicePixelRatio || 1; // Sharp screens (e.g. Retina) have 2 or more real pixels per CSS pixel
    const rect = canvas.getBoundingClientRect(); // The canvas's current size on screen
    canvas.width = Math.round(rect.width * ratio); // Give the canvas enough real pixels to look sharp...
    canvas.height = Math.round(rect.height * ratio); // ...in both directions
    context.setTransform(ratio, 0, 0, ratio, 0, 0); // Scale the drawing tools so we can keep using screen sizes in our code
    draw(); // Redraw at the new size
  } // End of resize

  // Paint the whole globe. "time" (milliseconds) drives the hotspot pulse; if it's not given, use the current time.
  // Set the projection to the current view (size, zoom, and turn), so it matches what's on screen right now
  function aimProjection() {
    const width = canvas.clientWidth; // The canvas width on screen, in CSS pixels
    const height = canvas.clientHeight; // The canvas height on screen
    const radius = globeRadius(width, height) * view.zoom; // Globe radius: its size at zoom 1 (see globeRadius), times the zoom factor
    projection
      .translate([width / 2, height / 2]) // Put the globe's center in the middle of the canvas
      .scale(radius) // Make the globe this many pixels in radius
      .rotate([-view.lon, -view.lat]); // Turn the globe so our view point faces us (D3 rotates the Earth, hence the minus signs)
    return { width, height, radius }; // Hand back the sizes, for drawing
  } // End of aimProjection

  // The place on Earth [lon, lat] under a screen point (x, y measured from the canvas's top-left), or null if it's off the globe
  function placeAt(x, y) {
    aimProjection(); // Make sure the projection matches the current view
    const lonLat = projection.invert([x, y]); // "invert" goes backwards: from a screen point to longitude/latitude
    return lonLat && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1]) ? lonLat : null; // Off the globe it gives "not a number": treat that as nothing
  } // End of placeAt

  // Turn the globe so that "anchor" (a [lon, lat] place) sits under the screen point (x, y). Used to zoom around the fingers.
  function keepUnder(anchor, x, y) {
    for (let i = 0; i < 4; i++) { // A few small correction passes: each gets closer (near the globe's edge one pass isn't enough)
      const now = placeAt(x, y); // Which place is under that point right now?
      if (!now) return; // Off the globe: nothing to correct
      view.lon = wrapLon(view.lon + wrapLon(anchor[0] - now[0])); // Turn left-right by the difference (wrapped, so crossing ±180° doesn't spin all the way round)
      view.lat = limitTilt(view.lat + (anchor[1] - now[1])); // Tilt up-down by the difference, within the tilt limit
    } // End of the correction passes
  } // End of keepUnder

  function draw(time = performance.now()) {
    const { width, height, radius } = aimProjection(); // Set the projection to the current view and get the sizes
    const centerX = width / 2; // Horizontal middle of the canvas
    const centerY = height / 2; // Vertical middle of the canvas

    context.clearRect(0, 0, width, height); // Wipe the canvas clean before painting

    // A soft blue glow around the globe, like the atmosphere
    const glow = context.createRadialGradient(centerX, centerY, radius * 0.92, centerX, centerY, radius * 1.22); // A color fade between two circles
    glow.addColorStop(0, 'rgba(120, 150, 190, 0.18)'); // Faint blue at the inner circle (just inside the globe's edge)
    glow.addColorStop(1, 'rgba(120, 150, 190, 0)'); // Fully see-through at the outer circle
    context.fillStyle = glow; // Paint with this fade
    context.beginPath(); // Start a new shape
    context.arc(centerX, centerY, radius * 1.22, 0, Math.PI * 2); // A full circle out to the edge of the glow
    context.fill(); // Fill it

    // The ocean: the whole sphere filled with a very dark blue-grey
    context.beginPath(); // Start a new shape
    path({ type: 'Sphere' }); // Trace the outline of the whole Earth
    context.fillStyle = '#0c1015'; // Ocean color
    context.fill(); // Fill it

    // The latitude/longitude grid, very faint
    context.beginPath(); // Start a new shape
    path(graticule); // Trace all the grid lines
    context.strokeStyle = 'rgba(190, 205, 225, 0.09)'; // Barely visible light blue
    context.lineWidth = 0.6; // Thin lines
    context.stroke(); // Draw the lines

    // The land: a very faint fill and a crisp coastline
    context.beginPath(); // Start a new shape
    path(land); // Trace all the land outlines
    context.fillStyle = 'rgba(190, 205, 225, 0.045)'; // Almost invisible fill, just enough to tell land from sea
    context.fill(); // Fill the land
    context.strokeStyle = 'rgba(220, 228, 238, 0.62)'; // Light grey-white coastline
    context.lineWidth = 0.7; // Fine line, like a pen drawing
    context.stroke(); // Draw the coastlines

    // The globe's outer edge
    context.beginPath(); // Start a new shape
    path({ type: 'Sphere' }); // Trace the outline of the Earth again
    context.strokeStyle = 'rgba(220, 228, 238, 0.28)'; // Soft white edge
    context.lineWidth = 1; // 1 px line
    context.stroke(); // Draw it

    // The hotspots: a dot plus a pulsing ring for each place on the front of the globe
    visibleHotspots = []; // Start a fresh list for this frame
    for (const place of PLACES) { // Go through the places one by one
      const distance = geoDistance([place.lon, place.lat], [view.lon, view.lat]); // Angle between the place and the view center, in radians
      if (distance > MAX_VISIBLE_DISTANCE) continue; // On the back of the globe: skip to the next place

      const [x, y] = projection([place.lon, place.lat]); // Turn longitude/latitude into a screen position
      const color = changeColor(place.type); // The color for this place's type of change
      const phase = (time / PULSE_MS + place.lon / 100) % 1; // Where this place is in its pulse, from 0 to 1; the longitude part offsets places so they don't all pulse together
      const moving = phase < 0 ? phase + 1 : phase; // Fix negative values (from western longitudes) so the pulse always runs 0 → 1
      const pulse = REDUCE_MOTION ? STILL_PULSE : moving; // If the person asked for less motion, freeze the ring partway through its pulse instead

      context.beginPath(); // Start the ring
      context.arc(x, y, 3 + pulse * 16, 0, Math.PI * 2); // A circle that grows from 3 to 19 px over one pulse
      context.strokeStyle = color; // Ring in the change color
      context.globalAlpha = (1 - pulse) * 0.8; // Fade out as it grows (globalAlpha = see-through-ness of everything drawn next)
      context.lineWidth = 1.2; // Thin ring
      context.stroke(); // Draw the ring
      context.globalAlpha = 1; // Back to fully solid for the next drawings

      context.beginPath(); // Start the dot
      context.arc(x, y, place === hoveredPlace ? 4.5 : 3, 0, Math.PI * 2); // A small dot, slightly bigger when hovered
      context.fillStyle = color; // Dot in the change color
      context.fill(); // Draw the dot

      visibleHotspots.push({ place, x, y }); // Remember where we drew it, for hover checks
    } // End of the places loop

    // The pin, if there is one and it's on the front of the globe
    const pinShown = pin !== null && geoDistance(pin, [view.lon, view.lat]) <= MAX_VISIBLE_DISTANCE; // A pin exists and hasn't turned to the back
    pinCard.hidden = !pinShown; // The card shows exactly when the pin does
    if (pinShown) {
      const [x, y] = projection(pin); // Its screen position right now (so it turns with the globe)
      context.beginPath(); // Start the mark's outline: the circle and the four arms of the cross
      context.arc(x, y, PIN_RING, 0, Math.PI * 2); // The circle
      context.moveTo(x - PIN_ARM, y); context.lineTo(x - PIN_GAP, y); // Left arm (moveTo lifts the pen, lineTo draws)
      context.moveTo(x + PIN_GAP, y); context.lineTo(x + PIN_ARM, y); // Right arm
      context.moveTo(x, y - PIN_ARM); context.lineTo(x, y - PIN_GAP); // Top arm
      context.moveTo(x, y + PIN_GAP); context.lineTo(x, y + PIN_ARM); // Bottom arm
      context.strokeStyle = PIN_HALO; // First pass: the dark halo...
      context.lineWidth = 4; // ...drawn wide
      context.stroke(); // Draw the halo
      context.strokeStyle = PIN_INK; // Second pass, on top: the off-white ink...
      context.lineWidth = 1.3; // ...drawn thin, like a pen line
      context.stroke(); // Draw the same outline again
      placePinCard(x, y, width, height); // Move the card beside the mark
    } // End of the pin
  } // End of draw

  // Keep a number between a smallest and a largest value ("clamping"), e.g. so the card never leaves the stage
  function clamp(value, smallest, largest) {
    return Math.max(smallest, Math.min(largest, value)); // Not below "smallest", not above "largest"
  } // End of clamp

  // Put the pin card next to the mark at (x, y). "width"/"height" are the stage's size.
  // Narrow stage (phones): above the mark and centered on it, like the callout's label. Wide stage: to its right, like a label on a site plan.
  // Either way it slides back inside if it would stick out past an edge, so the coordinates are never cut off.
  function placePinCard(x, y, width, height) {
    const MARGIN = 8; // Keep at least this many pixels between the card and the stage's edges
    const GAP = 4; // Space between the end of the cross's arm and the card
    const cardWidth = pinCard.offsetWidth; // The card's current width
    const cardHeight = pinCard.offsetHeight; // The card's current height
    let left; // The card's left edge, worked out below
    let top; // The card's top edge, worked out below
    if (width < COMPACT_WIDTH) { // Narrow stage:
      left = x - cardWidth / 2; // Centered on the mark...
      top = y - PIN_ARM - GAP - cardHeight; // ...with its bottom edge just above the cross's top arm
      if (top < MARGIN) top = y + PIN_ARM + GAP; // No room above (mark near the top): put it below the mark instead
    } else { // Wide stage:
      left = x + PIN_ARM + GAP; // Just past the cross's right arm...
      if (left + cardWidth > width - MARGIN) left = x - PIN_ARM - GAP - cardWidth; // ...or, too far right, on the left of the mark
      top = y - cardHeight / 2; // Centered vertically on the mark
    } // End of the layout choice
    pinCard.style.left = `${clamp(left, MARGIN, width - cardWidth - MARGIN)}px`; // Move it across, kept inside the left and right edges
    pinCard.style.top = `${clamp(top, MARGIN, height - cardHeight - MARGIN)}px`; // ...and down, kept inside the top and bottom edges
  } // End of placePinCard

  // Remove the pin (and so its card). main.js calls this when a place is chosen another way, e.g. by search.
  function clearPin() {
    if (pin === null) return; // No pin: nothing to do
    pin = null; // Forget the spot; the next frame hides the mark and the card
    onPinChange(null); // Tell main.js, so it can drop any name lookup still running
  } // End of clearPin

  // Show "That's water. Tap the land." just above the spot (x, y) where someone tapped the sea, for WATER_NOTE_MS.
  let waterTimer = null; // The countdown that hides the note again, so a second tap can restart it
  function showWaterNote(x, y) {
    waterNote.textContent = TOUCH ? "That's water. Tap the land." : "That's water. Click the land."; // The words (setting them again makes screen readers repeat them)
    const width = canvas.clientWidth; // The stage's width, to keep the note inside it
    const noteWidth = waterNote.offsetWidth; // The note's own width with these words
    const noteHeight = waterNote.offsetHeight; // ...and height
    const MARGIN = 8; // Keep at least this far from the stage's edges
    const left = clamp(x - noteWidth / 2, MARGIN, width - noteWidth - MARGIN); // Centred over the tap, but never past the left or right edge
    let top = y - WATER_NOTE_GAP - noteHeight; // Its bottom edge a little above the tap
    if (top < MARGIN) top = y + WATER_NOTE_GAP; // No room above (tap near the top): put it below the tap instead
    waterNote.style.left = `${left}px`; // Move it across...
    waterNote.style.top = `${top}px`; // ...and down
    waterNote.classList.add('shown'); // Fade it in (style.css)
    clearTimeout(waterTimer); // Cancel the countdown of an earlier tap, if any...
    waterTimer = setTimeout(() => waterNote.classList.remove('shown'), WATER_NOTE_MS); // ...and fade it out 2 seconds after this one
  } // End of showWaterNote

  // Find the visible hotspot nearest to a pointer event, or null if none is close enough
  function hotspotAt(event) {
    const rect = canvas.getBoundingClientRect(); // Where the canvas is on the page
    const pointerX = event.clientX - rect.left; // Pointer position measured from the canvas's left edge
    const pointerY = event.clientY - rect.top; // Pointer position measured from the canvas's top edge
    let nearest = null; // The best match so far (none yet)
    let nearestDistance = HOVER_RADIUS; // Only count hotspots closer than this many pixels
    for (const hotspot of visibleHotspots) { // Check every visible hotspot
      const d = Math.hypot(hotspot.x - pointerX, hotspot.y - pointerY); // Straight-line distance in pixels (Pythagoras)
      if (d < nearestDistance) { // Closer than anything found so far?
        nearest = hotspot; // Then it's the new best match
        nearestDistance = d; // And this is the distance to beat
      } // End of the closer check
    } // End of the hotspot loop
    return nearest; // The nearest hotspot, or null
  } // End of hotspotAt

  // Show the teaser box next to a hotspot, or hide it when given null
  function showTeaser(hotspot) {
    hoveredPlace = hotspot ? hotspot.place : null; // Remember which place is hovered (makes its dot bigger)
    canvas.classList.toggle('over-hotspot', hotspot !== null); // Pointing-hand cursor only while over a hotspot
    if (!hotspot) { // No hotspot:
      teaser.hidden = true; // hide the box
      return; // and stop here
    } // End of the no-hotspot check
    teaser.querySelector('strong').textContent = hotspot.place.name; // Fill in the place name
    teaser.querySelector('small').textContent = hotspot.place.teaser; // Fill in the "before → after" line
    teaser.style.left = `${hotspot.x + 14}px`; // Put the box 14 px right of the dot
    teaser.style.top = `${hotspot.y - 12}px`; // ...and slightly above it
    teaser.hidden = false; // Show the box
  } // End of showTeaser

  // ---------- Spinning ----------

  let previousTime = 0; // The time of the previous frame, to measure how much time has passed
  let lastInteraction = 0; // The time the globe last came to rest (let go without a fling, or a fling ran out)
  // The globe's velocity: how many degrees it turns per millisecond, left-right (lon) and up-down (lat).
  // A fling sets it; friction shrinks it every frame; a press sets it to 0.
  const velocity = { lon: 0, lat: 0 };

  // How fast the globe is turning overall, in degrees per millisecond (Pythagoras on the two directions)
  function speed() {
    return Math.hypot(velocity.lon, velocity.lat); // The length of the velocity "arrow"
  } // End of speed

  // Stop any movement at once
  function stopMoving() {
    velocity.lon = 0; // No left-right movement
    velocity.lat = 0; // No up-down movement
  } // End of stopMoving

  // Keep a longitude between -180 and 180 (going past -180° wraps around to +180°, and the other way)
  function wrapLon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180; // "%" is the remainder after dividing; the extra "+ 360" handles negative numbers
  } // End of wrapLon

  // Runs once per screen refresh (usually 60 times a second). "time" is in milliseconds since the page loaded.
  function frame(time) {
    const elapsed = Math.min(50, time - previousTime); // Time since the last frame; capped at 50 ms so the globe doesn't jump after the tab was in the background
    previousTime = time; // Remember this frame's time for next time

    if (turn) { // If the globe is turning to a chosen place:
      const progress = Math.max(0, Math.min(1, (time - turn.startTime) / TURN_MS)); // How far through the turn we are, kept between 0 and 1
      const eased = easeCubicInOut(progress); // Easing makes the movement start and stop gently
      const [lon, lat] = turn.route(eased); // The point on the route for this moment
      view.lon = lon; // Face that longitude...
      view.lat = lat; // ...and that latitude
      view.zoom = turn.fromZoom + (turn.toZoom - turn.fromZoom) * eased; // Zoom smoothly from the old zoom to the new one
      if (progress === 1) { // The turn is finished:
        const finished = turn; // keep hold of it for a moment,
        turn = null; // mark that no turn is running,
        finished.resolve(); // and fulfil its Promise, so whoever is waiting (main.js) can continue
      } // End of the finished check
    } // End of the turning check

    // Coasting after a fling: move by the velocity, then let friction slow it down
    if (!dragging && !turn && speed() > 0) { // Not held, not turning to a place, and still moving:
      view.lon = wrapLon(view.lon + velocity.lon * elapsed); // Move left-right by speed × time
      const tilted = view.lat + velocity.lat * elapsed; // Where the up-down movement would take it...
      view.lat = limitTilt(tilted); // ...kept within the tilt limit
      if (view.lat !== tilted) velocity.lat = 0; // Hit the tilt limit: stop the up-down movement there, like a stop on a real globe stand
      const keep = 0.5 ** (elapsed / FRICTION_HALF_LIFE_MS); // Friction: the share of speed kept this frame ("**" = to the power of; after one half-life, 0.5 is kept)
      velocity.lon *= keep; // Slow down left-right...
      velocity.lat *= keep; // ...and up-down
      if (speed() < STOP_SPEED) { // Slow enough to count as stopped:
        stopMoving(); // stop completely,
        lastInteraction = time; // and start counting the rest time before the slow spin
      } // End of the stopped check
    } // End of coasting

    // The slow automatic spin, once the globe has rested long enough; it speeds up gently instead of starting at full speed
    const restedFor = time - lastInteraction - SPIN_PAUSE_MS; // How long since the pause ended (negative while still pausing)
    if (!dragging && !turn && !focused && !pin && speed() === 0 && restedFor > 0 && !REDUCE_MOTION) { // Only when free, still, unpinned, after the pause, and if motion is allowed
      const ramp = easeCubicInOut(Math.min(1, restedFor / SPIN_EASE_MS)); // From 0 to 1 over SPIN_EASE_MS, with a gentle start and end
      view.lon = wrapLon(view.lon - (elapsed * SPIN_SPEED * ramp) / view.zoom); // Turn a little; divided by the zoom so a zoomed-in globe doesn't race across the screen. Minus = the real direction: the surface moves west to east (left to right)
    } // End of the spin check

    if (visible) draw(time); // Paint the globe in its new position, unless it's hidden
    requestAnimationFrame(frame); // Ask the browser to run "frame" again at the next screen refresh
  } // End of frame

  // ---------- Dragging ----------

  let dragging = false; // True while the user is holding the mouse button or finger down on the globe
  let lastPointer = null; // The pointer's previous position [x, y], to measure how far it moved
  let lastMoveTime = 0; // When the pointer last moved, to measure the finger's speed
  let movedTotal = 0; // How many pixels the pointer has moved since it was pressed, to tell clicks from drags
  let caught = false; // True if this press caught a moving globe; then letting go isn't a tap
  const pointers = new Map(); // Every finger (or mouse button) currently pressed on the globe: its id → its position [x, y]
  let pinch = null; // While two fingers are down: { startDistance, startZoom, anchor }; otherwise null
  let pinched = false; // True if this touch included a pinch at any point; then lifting the fingers isn't a tap

  // Set the zoom, kept between MIN_ZOOM and MAX_ZOOM
  function setZoom(zoom) {
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)); // Clamp: never smaller than the whole globe, never bigger than 4×
    lastInteraction = performance.now(); // Zooming counts as touching the globe: the slow spin waits its usual pause
  } // End of setZoom

  // The distance in pixels between the first two fingers on the globe
  function fingerDistance() {
    const [a, b] = pointers.values(); // The positions of the first two fingers
    return Math.hypot(a[0] - b[0], a[1] - b[1]); // Straight-line distance between them (Pythagoras)
  } // End of fingerDistance

  // The point halfway between the first two fingers, measured from the canvas's top-left corner
  function fingerMiddle() {
    const [a, b] = pointers.values(); // The positions of the first two fingers (page coordinates)
    const rect = canvas.getBoundingClientRect(); // Where the canvas is on the page
    return [(a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top]; // The average of the two, shifted to canvas coordinates
  } // End of fingerMiddle

  // How many degrees the globe turns per pixel of finger movement, so the spot under the finger stays under it.
  // A circle's edge is 2 × π × radius long for 360°, so near the middle 1 pixel ≈ 180° ÷ (π × radius).
  // The radius grows with the zoom, so when zoomed in each pixel turns the globe less.
  function degreesPerPixel() {
    const radius = globeRadius(canvas.clientWidth, canvas.clientHeight) * view.zoom; // The globe's radius on screen (same formula as in draw)
    return 180 / (Math.PI * radius); // Degrees per pixel
  } // End of degreesPerPixel

  // When the user presses down on the globe (mouse button, finger, or pen; together called a "pointer")
  canvas.addEventListener('pointerdown', (event) => {
    if (!interactive) return; // Ignore presses while the app is busy
    pointers.set(event.pointerId, [event.clientX, event.clientY]); // Add this finger to the list of pressed fingers
    canvas.setPointerCapture(event.pointerId); // Keep receiving this finger's moves even if it slides off the canvas
    if (pointers.size === 2) { // A second finger just came down: start a pinch
      pinch = { // Remember how the pinch started:
        startDistance: Math.max(1, fingerDistance()), // the finger distance (at least 1, never 0),
        startZoom: view.zoom, // the zoom,
        anchor: placeAt(...fingerMiddle()), // and the place between the fingers, which should stay there ("..." passes x and y separately); null if that's off the globe
      }; // End of the pinch start
      pinched = true; // This touch is now a pinch, not a tap
      stopMoving(); // No fling from the drag before the pinch
      return; // The first finger already started everything else
    } // End of the second-finger check
    if (pointers.size > 2) return; // A third finger or more: ignore it
    pinched = false; // A fresh touch: no pinch yet
    caught = speed() > CATCH_SPEED; // Was the globe moving fast? Then this press just catches it
    stopMoving(); // Stop any coasting at once, like putting a hand on a spinning globe
    dragging = true; // Start dragging
    turn = null; // If the globe was turning to a place, stop: the user has taken over
    movedTotal = 0; // Nothing moved yet
    lastPointer = [event.clientX, event.clientY]; // Remember where the pointer started
    lastMoveTime = performance.now(); // ...and when
    canvas.classList.add('dragging'); // Switch to the "grabbing hand" cursor (see style.css)
    showTeaser(null); // Hide the teaser while dragging
  }); // End of pointerdown

  // When the pointer moves
  canvas.addEventListener('pointermove', (event) => {
    if (!interactive) return; // Ignore the mouse while the app is busy
    if (!dragging) { // Not dragging, just moving the mouse over the globe:
      showTeaser(hotspotAt(event)); // show the teaser if we're near a hotspot, hide it if not
      return; // and stop here
    } // End of the not-dragging check
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, [event.clientX, event.clientY]); // Update this finger's position in the list
    if (pinch) { // Two fingers are down: zoom instead of turning
      setZoom(pinch.startZoom * (fingerDistance() / pinch.startDistance)); // Fingers twice as far apart as at the start = twice the starting zoom
      if (pinch.anchor) keepUnder(pinch.anchor, ...fingerMiddle()); // Turn so the place that was between the fingers is still between them
      return; // No other turning during a pinch
    } // End of the pinch check
    const now = performance.now(); // The time of this move
    const dx = event.clientX - lastPointer[0]; // How far it moved left/right since last time, in pixels
    const dy = event.clientY - lastPointer[1]; // How far it moved up/down since last time
    movedTotal += Math.abs(dx) + Math.abs(dy); // Add up the movement, ignoring direction
    const step = degreesPerPixel(); // How many degrees one pixel is worth right now
    const dLon = -dx * step; // Dragging right brings places from the west into view (longitude goes down)
    const dLat = dy * step; // Dragging down tilts north toward us (latitude goes up)
    view.lon = wrapLon(view.lon + dLon); // Turn left-right
    view.lat = limitTilt(view.lat + dLat); // Tilt up-down, kept between -70° and 70°

    // Measure the finger's speed for a possible fling: this move's speed, blended with the earlier ones.
    // Blending (a "smoothed average") stops one jerky move from deciding the whole fling.
    const dt = Math.max(1, now - lastMoveTime); // Milliseconds since the last move (at least 1, so we never divide by 0)
    velocity.lon = velocity.lon * 0.3 + (dLon / dt) * 0.7; // 70% this move's speed, 30% the earlier speed
    velocity.lat = velocity.lat * 0.3 + (dLat / dt) * 0.7; // Same for up-down
    lastPointer = [event.clientX, event.clientY]; // Remember the new position for the next move
    lastMoveTime = now; // ...and the time
  }); // End of pointermove

  // When the user lets go (or the system cancels the drag, e.g. a phone call comes in)
  function stopDragging() {
    dragging = false; // Stop dragging
    canvas.classList.remove('dragging'); // Back to the open-hand cursor
    const heldStill = performance.now() - lastMoveTime > HOLD_STILL_MS; // Did the finger rest before letting go?
    if (heldStill || pinched || REDUCE_MOTION) stopMoving(); // Then no fling. Also never after a pinch (fingers lifting one by one made accidental flings), or if the user prefers less motion
    const fast = speed(); // How fast the fling is
    if (fast > MAX_FLING_SPEED) { // Faster than the speed limit?
      velocity.lon *= MAX_FLING_SPEED / fast; // Scale both directions down equally,
      velocity.lat *= MAX_FLING_SPEED / fast; // so the direction stays the same but the speed is the limit
    } // End of the speed limit
    if (speed() < STOP_SPEED) stopMoving(); // A tiny leftover speed isn't a fling
    lastInteraction = performance.now(); // Count the rest time from now (coasting resets this again when it stops)
  } // End of stopDragging
  // Take a lifted finger off the list. Returns true if other fingers are still down.
  function forgetPointer(event) {
    pointers.delete(event.pointerId); // Remove it from the list of pressed fingers
    if (pinch && pointers.size < 2) { // The pinch just ended (one of its two fingers lifted):
      pinch = null; // no pinch any more
      const [remaining] = pointers.values(); // The finger still down, if there is one
      if (remaining) { // One finger stays down: let it carry on turning the globe
        lastPointer = remaining; // Measure its next move from where it is now, so the globe doesn't jump
        lastMoveTime = performance.now(); // ...and from now
        stopMoving(); // Start its speed measurement fresh
      } // End of the remaining-finger check
    } // End of the pinch-ended check
    return pointers.size > 0; // Are any fingers still down?
  } // End of forgetPointer

  // When the button or finger is lifted
  canvas.addEventListener('pointerup', (event) => {
    if (forgetPointer(event)) return; // Other fingers are still down: the touch isn't over yet
    if (!dragging) return; // No drag was started (e.g. the app was busy), so there's nothing to finish
    stopDragging(); // The drag is over either way
    if (pinched) return; // That touch was a pinch: not a tap on a place
    if (movedTotal > CLICK_TOLERANCE) return; // It moved: that was a drag, not a click, so stop here
    if (caught) return; // That press caught a moving globe: it only stopped it, it wasn't a tap on a place
    const hotspot = hotspotAt(event); // It was a click: is there a hotspot under the pointer?
    if (hotspot) { // Yes:
      onSelectPlace(hotspot.place); // Tell main.js which place was chosen
      return; // Done: a hotspot tap is never also a land tap
    } // End of the hotspot check
    const rect = canvas.getBoundingClientRect(); // Where the canvas is on the page
    const lonLat = placeAt(event.clientX - rect.left, event.clientY - rect.top); // The spot on Earth under the tap, or null if it's off the globe
    if (lonLat && geoContains(land, lonLat)) { // On the globe and inside the land outlines:
      pin = lonLat; // Put the pin there (a new tap moves it); the next frame draws it
      onPinChange(lonLat); // Tell main.js, which fills in the card
    } else { // Sea or empty space:
      clearPin(); // Tapping away removes the pin and its card
      if (lonLat) showWaterNote(event.clientX - rect.left, event.clientY - rect.top); // On the globe but not on land: it's the sea, so say so (a tap should never just do nothing)
    } // End of the land check
  }); // End of pointerup
  // When the system cancels a touch (e.g. a phone call comes in)
  canvas.addEventListener('pointercancel', (event) => {
    if (forgetPointer(event)) return; // Other fingers are still down: keep going
    if (dragging) stopDragging(); // Otherwise end the drag (never a tap)
  }); // End of pointercancel

  // Scroll wheel or trackpad: zoom in and out. (Most browsers also send a two-finger trackpad pinch as a wheel event.)
  canvas.addEventListener('wheel', (event) => {
    if (!interactive) return; // Ignore it while the app is busy
    event.preventDefault(); // Don't scroll the page while zooming the globe
    const lines = event.deltaMode === 1 ? 16 : 1; // Some browsers (Firefox) count in lines instead of pixels: treat one line as 16 pixels
    const rect = canvas.getBoundingClientRect(); // Where the canvas is on the page
    const x = event.clientX - rect.left; // Mouse position measured from the canvas's left edge
    const y = event.clientY - rect.top; // ...and from its top edge
    const anchor = placeAt(x, y); // The place under the mouse before zooming (null if the mouse is off the globe)
    setZoom(view.zoom * Math.exp(-event.deltaY * lines * WHEEL_ZOOM_SPEED)); // Scroll up (negative) = zoom in. Multiplying (via exp) makes each scroll feel the same at any zoom
    if (anchor) keepUnder(anchor, x, y); // Turn so that place is still under the mouse: zoom toward where you point
  }, { passive: false }); // "passive: false" tells the browser we may call preventDefault, which is needed to stop the page scroll
  canvas.addEventListener('pointerleave', () => showTeaser(null)); // Hide the teaser when the mouse leaves the globe

  // ---------- Turning to a place ----------

  // Turn the globe smoothly so the given place faces us, zooming to the given zoom factor, then stay there.
  // Returns a Promise that is fulfilled when the turn has finished, so main.js can "await" it.
  function turnTo(lon, lat, zoom = view.zoom) { // If no zoom is given, keep the current one
    focused = true; // A place is chosen: stop the automatic spin
    stopMoving(); // Cancel any coasting from a fling, so it can't fight the turn
    showTeaser(null); // Hide any teaser box
    const target = [lon, limitTilt(lat)]; // Where to end up, with the tilt kept in the allowed range
    if (turn) turn.resolve(); // A turn is still running (e.g. the user cancelled mid-turn): finish it now, so whoever waits for it doesn't wait forever
    return new Promise((resolve) => { // Create the Promise; we call "resolve" when the turn is done
      if (REDUCE_MOTION) { // If the user prefers less motion:
        [view.lon, view.lat] = target; // jump straight there,
        view.zoom = zoom; // at the new zoom,
        resolve(); // finish right away,
        return; // and stop here
      } // End of the reduced-motion check
      turn = { // Start a new turn:
        startTime: performance.now(), // when it began
        route: geoInterpolate([view.lon, view.lat], target), // a function that gives any point along the shortest route ("great circle") from here to there
        fromZoom: view.zoom, // the zoom at the start
        toZoom: zoom, // the zoom at the end
        resolve, // the function to call when finished (the frame loop calls it)
      }; // End of the new turn
    }); // End of the Promise
  } // End of turnTo

  // Switch the globe's mouse and touch handling on (true) or off (false)
  function setInteractive(value) {
    interactive = value; // Remember the new setting
    canvas.classList.toggle('locked', !value); // Normal arrow cursor while locked (see style.css)
    if (!value) showTeaser(null); // Hide any teaser box when locking
  } // End of setInteractive

  // Watch the canvas's own box and resize whenever it changes size, for any reason. Listening only for the window
  // resizing wasn't enough: on phones the globe area can change size without that event (e.g. Safari's toolbar
  // sliding in after the page comes back from the background), which left the globe squeezed out of shape.
  new ResizeObserver(resize).observe(canvas); // A ResizeObserver calls resize() whenever the canvas's size changes (and once at the start)
  window.addEventListener('resize', resize); // Still also listen to the window: it covers the screen sharpness changing (e.g. moving the window to another monitor)
  resize(); // Size and draw the globe for the first time
  requestAnimationFrame(frame); // Start the animation loop
  // Zoom back out to the whole globe, then unlock it and let it spin again.
  // Returns a Promise that is fulfilled once the globe is ready to use.
  async function reset() {
    await turnTo(view.lon, START_VIEW.lat, 1); // Keep the longitude, tilt back to the starting latitude, zoom back to 1 (whole globe)
    focused = false; // No place chosen any more: spinning is allowed again
    pin = null; // And no pin: we're back to an untouched globe
    lastInteraction = performance.now() - SPIN_PAUSE_MS; // Pretend the rest pause is already over, so the slow spin starts easing in right away (the pause is for after people touch the globe; here they haven't)
    setInteractive(true); // Dragging, hovering, and clicking work again
  } // End of reset

  // Tell the globe whether it can be seen (true) or is hidden behind the map (false)
  function setVisible(value) {
    visible = value; // Remember it; the frame loop skips drawing while hidden
  } // End of setVisible

  return { turnTo, reset, setInteractive, setVisible, clearPin }; // Hand back these functions so main.js can use them
} // End of startGlobe
