// Bring in tools from D3: the globe projection, a "path" drawer, the latitude/longitude grid,
// a function that measures the distance between two places on the globe,
// a function that finds the in-between points on the shortest route between two places,
// and an "easing" curve that makes movements start and end gently
import { geoOrthographic, geoPath, geoGraticule10, geoDistance, geoInterpolate, easeCubicInOut } from 'd3';
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
// How long to wait after the user lets go before spinning again, in milliseconds (2.5 seconds)
const SPIN_PAUSE_MS = 2500;
// How many degrees the globe turns per pixel the mouse or finger moves while dragging
const DRAG_DEGREES_PER_PIXEL = 0.3;
// The furthest the globe can be tilted north or south, in degrees, so it can't flip upside down
const MAX_TILT = 70;
// True if the user has asked their computer to reduce motion (an accessibility setting)
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How long the globe takes to turn to a chosen place, in milliseconds (1.6 seconds)
const TURN_MS = 1600;
// How far (in pixels) the pointer may move between press and release and still count as a click, not a drag
const CLICK_TOLERANCE = 3;

// How long one hotspot "pulse" (a ring growing and fading) takes, in milliseconds
const PULSE_MS = 1800;
// How close (in pixels) the mouse must be to a hotspot to count as hovering over it
const HOVER_RADIUS = 18;
// Hotspots further than this from the center of the view are on the back of the globe and not drawn.
// Measured in radians (an angle unit: 1.5 radians ≈ 86°; the globe's visible edge is at 90°).
const MAX_VISIBLE_DISTANCE = 1.5;

// Read the four change colors from the CSS tokens in style.css, so each color is defined in one place only
const rootStyles = getComputedStyle(document.documentElement); // The final styles of the <html> element, where :root tokens live
const CHANGE_COLORS = {
  built: rootStyles.getPropertyValue('--built').trim(), // Orange; trim() removes spaces around the value
  loss: rootStyles.getPropertyValue('--loss').trim(), // Red
  gain: rootStyles.getPropertyValue('--gain').trim(), // Green
  water: rootStyles.getPropertyValue('--water').trim(), // Blue
}; // End of the change colors

// Keep a latitude within the allowed tilt, so the globe never flips upside down
function limitTilt(lat) {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, lat)); // Not below -70°, not above 70°
} // End of limitTilt

// Draw the globe on the given canvas, with a teaser box for hovered hotspots.
// "onSelectPlace" is a function to call when the user clicks a hotspot.
// Returns an object with a turnTo function, so other code can tell the globe where to look.
// "export" lets main.js use this function.
export function startGlobe(canvas, teaser, onSelectPlace) {
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
  function draw(time = performance.now()) {
    const width = canvas.clientWidth; // The canvas width on screen, in CSS pixels
    const height = canvas.clientHeight; // The canvas height on screen
    const centerX = width / 2; // Horizontal middle of the canvas
    const centerY = height / 2; // Vertical middle of the canvas
    const radius = Math.min(width, height) * 0.4 * view.zoom; // Globe radius: 40% of the shorter side (so it fits), times the zoom factor

    projection
      .translate([centerX, centerY]) // Put the globe's center in the middle of the canvas
      .scale(radius) // Make the globe this many pixels in radius
      .rotate([-view.lon, -view.lat]); // Turn the globe so our view point faces us (D3 rotates the Earth, hence the minus signs)

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
      const color = CHANGE_COLORS[place.type]; // The color for this place's type of change
      const phase = (time / PULSE_MS + place.lon / 100) % 1; // Where this place is in its pulse, from 0 to 1; the longitude part offsets places so they don't all pulse together
      const pulse = phase < 0 ? phase + 1 : phase; // Fix negative values (from western longitudes) so the pulse always runs 0 → 1

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
  } // End of draw

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
  let lastInteraction = 0; // The time the user last let go of the globe

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

    const resting = time - lastInteraction > SPIN_PAUSE_MS; // True once the pause after a drag is over
    if (!dragging && !turn && !focused && resting && !REDUCE_MOTION) { // Only spin when not dragged, not turning, no place chosen, after the pause, and if motion is allowed
      view.lon -= elapsed * SPIN_SPEED; // Turn a little. Minus = the real direction: the surface moves west to east (left to right)
      if (view.lon < -180) view.lon += 360; // Keep longitude between -180 and 180 (going past -180° wraps around to +180°)
    } // End of the spin check

    if (visible) draw(time); // Paint the globe in its new position, unless it's hidden
    requestAnimationFrame(frame); // Ask the browser to run "frame" again at the next screen refresh
  } // End of frame

  // ---------- Dragging ----------

  let dragging = false; // True while the user is holding the mouse button or finger down on the globe
  let lastPointer = null; // The pointer's previous position [x, y], to measure how far it moved
  let movedTotal = 0; // How many pixels the pointer has moved since it was pressed, to tell clicks from drags

  // When the user presses down on the globe (mouse button, finger, or pen; together called a "pointer")
  canvas.addEventListener('pointerdown', (event) => {
    if (!interactive) return; // Ignore presses while the app is busy
    dragging = true; // Start dragging
    turn = null; // If the globe was turning to a place, stop: the user has taken over
    movedTotal = 0; // Nothing moved yet
    lastPointer = [event.clientX, event.clientY]; // Remember where the pointer started
    canvas.setPointerCapture(event.pointerId); // Keep receiving moves even if the pointer leaves the canvas while dragging
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
    const dx = event.clientX - lastPointer[0]; // How far it moved left/right since last time, in pixels
    const dy = event.clientY - lastPointer[1]; // How far it moved up/down since last time
    movedTotal += Math.abs(dx) + Math.abs(dy); // Add up the movement, ignoring direction
    view.lon -= dx * DRAG_DEGREES_PER_PIXEL; // Dragging right brings places from the west into view
    view.lat = limitTilt(view.lat + dy * DRAG_DEGREES_PER_PIXEL); // Dragging down tilts north toward us; kept between -70° and 70°
    lastPointer = [event.clientX, event.clientY]; // Remember the new position for the next move
  }); // End of pointermove

  // When the user lets go (or the system cancels the drag, e.g. a phone call comes in)
  function stopDragging() {
    dragging = false; // Stop dragging
    lastInteraction = performance.now(); // Remember when, so the spin waits before starting again
    canvas.classList.remove('dragging'); // Back to the open-hand cursor
  } // End of stopDragging
  // When the button or finger is lifted
  canvas.addEventListener('pointerup', (event) => {
    if (!dragging) return; // No drag was started (e.g. the app was busy), so there's nothing to finish
    stopDragging(); // The drag is over either way
    if (movedTotal > CLICK_TOLERANCE) return; // It moved: that was a drag, not a click, so stop here
    const hotspot = hotspotAt(event); // It was a click: is there a hotspot under the pointer?
    if (hotspot) onSelectPlace(hotspot.place); // If so, tell main.js which place was chosen
  }); // End of pointerup
  canvas.addEventListener('pointercancel', stopDragging); // Run stopDragging when the system cancels the drag
  canvas.addEventListener('pointerleave', () => showTeaser(null)); // Hide the teaser when the mouse leaves the globe

  // ---------- Turning to a place ----------

  // Turn the globe smoothly so the given place faces us, zooming to the given zoom factor, then stay there.
  // Returns a Promise that is fulfilled when the turn has finished, so main.js can "await" it.
  function turnTo(lon, lat, zoom = view.zoom) { // If no zoom is given, keep the current one
    focused = true; // A place is chosen: stop the automatic spin
    showTeaser(null); // Hide any teaser box
    const target = [lon, limitTilt(lat)]; // Where to end up, with the tilt kept in the allowed range
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

  window.addEventListener('resize', resize); // Whenever the browser window changes size, resize and redraw
  resize(); // Size and draw the globe for the first time
  requestAnimationFrame(frame); // Start the animation loop
  // Tell the globe whether it can be seen (true) or is hidden behind the map (false)
  function setVisible(value) {
    visible = value; // Remember it; the frame loop skips drawing while hidden
  } // End of setVisible

  return { turnTo, setInteractive, setVisible }; // Hand back these functions so main.js can use them
} // End of startGlobe
