// Bring in three tools from D3: the globe projection, a "path" drawer, and the latitude/longitude grid
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3';
// Bring in the tool that unpacks TopoJSON (the compact map format) into shapes D3 can draw
import { feature } from 'topojson-client';
// Bring in the world's land outlines (Natural Earth, 1:110 million scale) from the world-atlas package
import landTopology from 'world-atlas/land-110m.json';

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

// Draw the globe on the given canvas. "export" lets main.js use this function.
export function startGlobe(canvas) {
  const context = canvas.getContext('2d'); // The "2D context" is the set of drawing tools for the canvas
  const projection = geoOrthographic() // The orthographic projection: the Earth as seen from far out in space
    .clipAngle(90) // Hide everything more than 90° from the center, i.e. the far side of the globe
    .precision(0.6); // How closely curved lines are followed (smaller = smoother but slower)
  const path = geoPath(projection, context); // A drawer that turns map shapes into lines on our canvas, using the projection
  const view = { ...START_VIEW }; // The current view; "..." makes a copy, so we can change it later without changing START_VIEW

  // Match the canvas's pixel size to its size on screen, then redraw
  function resize() {
    const ratio = window.devicePixelRatio || 1; // Sharp screens (e.g. Retina) have 2 or more real pixels per CSS pixel
    const rect = canvas.getBoundingClientRect(); // The canvas's current size on screen
    canvas.width = Math.round(rect.width * ratio); // Give the canvas enough real pixels to look sharp...
    canvas.height = Math.round(rect.height * ratio); // ...in both directions
    context.setTransform(ratio, 0, 0, ratio, 0, 0); // Scale the drawing tools so we can keep using screen sizes in our code
    draw(); // Redraw at the new size
  } // End of resize

  // Paint the whole globe
  function draw() {
    const width = canvas.clientWidth; // The canvas width on screen, in CSS pixels
    const height = canvas.clientHeight; // The canvas height on screen
    const centerX = width / 2; // Horizontal middle of the canvas
    const centerY = height / 2; // Vertical middle of the canvas
    const radius = Math.min(width, height) * 0.4; // Globe radius: 40% of the shorter side, so it always fits

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
  } // End of draw

  // ---------- Spinning ----------

  let previousTime = 0; // The time of the previous frame, to measure how much time has passed
  let lastInteraction = 0; // The time the user last let go of the globe

  // Runs once per screen refresh (usually 60 times a second). "time" is in milliseconds since the page loaded.
  function frame(time) {
    const elapsed = Math.min(50, time - previousTime); // Time since the last frame; capped at 50 ms so the globe doesn't jump after the tab was in the background
    previousTime = time; // Remember this frame's time for next time

    const resting = time - lastInteraction > SPIN_PAUSE_MS; // True once the pause after a drag is over
    if (!dragging && resting && !REDUCE_MOTION) { // Only spin when not being dragged, after the pause, and if motion is allowed
      view.lon -= elapsed * SPIN_SPEED; // Turn a little. Minus = the real direction: the surface moves west to east (left to right)
      if (view.lon < -180) view.lon += 360; // Keep longitude between -180 and 180 (going past -180° wraps around to +180°)
    } // End of the spin check

    draw(); // Paint the globe in its new position
    requestAnimationFrame(frame); // Ask the browser to run "frame" again at the next screen refresh
  } // End of frame

  // ---------- Dragging ----------

  let dragging = false; // True while the user is holding the mouse button or finger down on the globe
  let lastPointer = null; // The pointer's previous position [x, y], to measure how far it moved

  // When the user presses down on the globe (mouse button, finger, or pen; together called a "pointer")
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true; // Start dragging
    lastPointer = [event.clientX, event.clientY]; // Remember where the pointer started
    canvas.setPointerCapture(event.pointerId); // Keep receiving moves even if the pointer leaves the canvas while dragging
    canvas.classList.add('dragging'); // Switch to the "grabbing hand" cursor (see style.css)
  }); // End of pointerdown

  // When the pointer moves
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return; // Ignore moves when no button or finger is held down
    const dx = event.clientX - lastPointer[0]; // How far it moved left/right since last time, in pixels
    const dy = event.clientY - lastPointer[1]; // How far it moved up/down since last time
    view.lon -= dx * DRAG_DEGREES_PER_PIXEL; // Dragging right brings places from the west into view
    view.lat = Math.max(-MAX_TILT, Math.min(MAX_TILT, view.lat + dy * DRAG_DEGREES_PER_PIXEL)); // Dragging down tilts north toward us; kept between -70° and 70°
    lastPointer = [event.clientX, event.clientY]; // Remember the new position for the next move
  }); // End of pointermove

  // When the user lets go (or the system cancels the drag, e.g. a phone call comes in)
  function stopDragging() {
    dragging = false; // Stop dragging
    lastInteraction = performance.now(); // Remember when, so the spin waits before starting again
    canvas.classList.remove('dragging'); // Back to the open-hand cursor
  } // End of stopDragging
  canvas.addEventListener('pointerup', stopDragging); // Run stopDragging when the button or finger is lifted
  canvas.addEventListener('pointercancel', stopDragging); // ...or when the system cancels the drag

  window.addEventListener('resize', resize); // Whenever the browser window changes size, resize and redraw
  resize(); // Size and draw the globe for the first time
  requestAnimationFrame(frame); // Start the animation loop
} // End of startGlobe
