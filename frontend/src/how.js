// The "How this works" page's code: it loads the page's styles and draws the diagrams into the empty <svg> boxes.
// Every diagram is drawn with SVG ("Scalable Vector Graphics": shapes described in code, so they stay sharp at any size).
import './how.css'; // Bring in the page's styles (Vite turns this into a <style> on the page)

const SVG = 'http://www.w3.org/2000/svg'; // SVG shapes must be created in the SVG "namespace", not as normal HTML

// Make one SVG shape. "tag" is its kind (e.g. 'rect'), "attrs" its settings, "parent" where it goes. Returns the shape.
function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag); // Create the shape
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value); // Copy each setting onto it
  parent.append(node); // Put it into the drawing
  return node; // Hand it back, e.g. to add text to it
} // End of el

// Write a small label at (x, y). "anchor" is 'start', 'middle' or 'end' (where the text hangs from that point).
function label(svg, x, y, text, anchor = 'middle', cls = 'art-label') {
  el('text', { x, y, 'text-anchor': anchor, class: cls }, svg).textContent = text; // A text shape with the words in it
} // End of label

// ---------- The years ----------
// The years shown on the page come from the backend (/api/years), which uses the same setting as every analysis, so the
// page always matches the data. Until they arrive, or if the backend can't be reached, the drawings say "first" and
// "latest" instead of guessing a year.
const years = { first: 'first', latest: 'latest' }; // Filled in by loadYears

// Ask the backend for the years. Gives up after 3 seconds, so the page never waits long.
async function loadYears() {
  try { // The backend may be down
    const response = await fetch('/api/years', { signal: AbortSignal.timeout(3000) }); // Ask, and cancel after 3 seconds
    if (!response.ok) return; // An error answer: keep the words
    const answer = await response.json(); // e.g. {"first": 2017, "latest": 2024}
    years.first = String(answer.first); // e.g. "2017"
    years.latest = String(answer.latest); // e.g. "2024"
    document.querySelectorAll('[data-year]').forEach((span) => { span.textContent = years[span.dataset.year]; }); // Put them into the page's text
  } catch { // No answer in time, or no backend:
    // keep "the first year" / "the latest year" in the text and "first" / "latest" in the drawings
  } // End of the try
} // End of loadYears

// ---------- The made-up example: a 5 x 5 pixel corner, in two years ----------
// Each letter is one pixel's land-cover label: T trees, G grass or farmland, B built, W water, S bare soil.
// This is what a land-cover map really is: a grid ("raster") holding one label per cell.
const YEAR_A = ['TTGGG', 'TGGGS', 'GGGSS', 'GGSSW', 'GSSWW']; // The first year, row by row from the top
const YEAR_B = ['TTBBB', 'TGGBB', 'GTSSB', 'GGSWW', 'GGSWW']; // The latest year: houses on the farmland, a river widened, a clearing
const PICK = [0, 2]; // The pixel step 4 zooms into: row 0, column 2 (grass in 2017, built in 2024)

// The app's colour rule (the same as the analysis): which change colour a pixel gets going from label "a" to label "b".
// Returns 'built', 'loss', 'gain', 'water', or null for no colour.
function changeType(a, b) {
  const green = (letter) => letter === 'T' || letter === 'G'; // Trees and grass/farmland both count as green space
  if (a === b) return null; // Same label both years: no change
  if (b === 'B') return 'built'; // Became built: orange (whatever it was before)
  if (b === 'W') return 'water'; // Became water: blue
  if (green(a) && b === 'S') return 'loss'; // Green space stripped to bare soil, nothing built yet: red
  if (green(b) && !green(a)) return 'gain'; // Non-green land became trees or grass: green
  return null; // Anything else, e.g. trees <-> grass (green to green): no colour
} // End of changeType

// Draw a 5 x 5 grid of labels with its top-left corner at (x, y), each cell "size" units wide.
// The picked pixel gets a bright outline, so you can follow it from step 3 to step 5.
function labelGrid(svg, x, y, rows, size) {
  rows.forEach((row, r) => { // For each row (r = its number, from 0)...
    [...row].forEach((letter, c) => { // ...and each letter in it (c = its column)
      el('rect', { x: x + c * size, y: y + r * size, width: size, height: size, class: 'cell' }, svg); // The cell's outline
      label(svg, x + c * size + size / 2, y + r * size + size / 2 + 3, letter, 'middle', 'art-letter'); // Its letter, centred (+3 drops it to the middle)
    }); // End of the letters
  }); // End of the rows
  pickOutline(svg, x, y, size); // Mark the picked pixel
} // End of labelGrid

// The bright outline around the picked pixel in a grid at (x, y)
function pickOutline(svg, x, y, size) {
  el('rect', { x: x + PICK[1] * size, y: y + PICK[0] * size, width: size, height: size, class: 'pick' }, svg); // Drawn on top of the grid
} // End of pickOutline

// ---------- The five drawings ----------

// 1. Pick a place: a search box, and a leader line up to a survey mark (the same mark as the pin on the globe)
function drawAddress(svg) {
  el('rect', { x: 15, y: 62, width: 140, height: 28, class: 'line' }, svg); // The search box
  el('circle', { cx: 30, cy: 75, r: 5, class: 'line' }, svg); // Magnifying glass: the lens...
  el('path', { d: 'M34 79 L38 83', class: 'line' }, svg); // ...and its handle
  label(svg, 46, 79, '12 Any Street', 'start', 'art-text'); // A made-up address typed in
  el('path', { d: 'M85 62 V34', class: 'line dashed' }, svg); // A dashed leader line from the box up to the spot
  el('circle', { cx: 85, cy: 26, r: 6, class: 'line ink' }, svg); // The survey mark: a circle...
  el('path', { d: 'M74 26 H81 M89 26 H96 M85 15 V22 M85 30 V37', class: 'line ink' }, svg); // ...with a cross through it, open in the middle
} // End of drawAddress

// 2. Draw the square: 2 x 2 km around the spot, with dimension lines like a drawing
function drawSquare(svg) {
  el('rect', { x: 55, y: 22, width: 76, height: 76, class: 'line ink' }, svg); // The square
  el('path', { d: 'M55 12 H131 M55 8 V16 M131 8 V16', class: 'line' }, svg); // Dimension line along the top, with end ticks
  label(svg, 93, 9, '2 km'); // Its length (sits on the line, in a gap)
  el('path', { d: 'M45 22 V98 M41 22 H49 M41 98 H49', class: 'line' }, svg); // Dimension line down the left side
  label(svg, 38, 63, '2 km', 'end'); // Its length
  el('path', { d: 'M87 60 H91 M95 60 H99 M93 54 V58 M93 62 V66', class: 'line ink' }, svg); // The spot: a small cross at the centre
  label(svg, 93, 82, '400 ha'); // The area, inside the square
} // End of drawSquare

// 3. Read two maps: the made-up 5 x 5 corner in 2017 and in 2024
function drawMaps(svg) {
  label(svg, 40, 12, years.first); // Year above the left grid
  labelGrid(svg, 0, 20, YEAR_A, 16); // The left grid: 5 cells of 16 = 80 wide
  label(svg, 130, 12, years.latest); // Year above the right grid
  labelGrid(svg, 90, 20, YEAR_B, 16); // The right grid, 10 units to the right of the first
} // End of drawMaps

// 4. Compare each pixel: the picked pixel, big, in both years, and the change colour it gets
function drawCompare(svg) {
  const a = YEAR_A[PICK[0]][PICK[1]]; // Its label in 2017 ("G")
  const b = YEAR_B[PICK[0]][PICK[1]]; // Its label in 2024 ("B")
  const type = changeType(a, b); // The colour rule's answer ("built")
  const names = { built: 'newly built', loss: 'cleared', gain: 'green gained', water: 'new water' }; // Each colour in words
  label(svg, 18, 30, years.first); // Year over the first cell
  el('rect', { x: 2, y: 38, width: 32, height: 32, class: 'cell pick' }, svg); // The 2017 cell
  label(svg, 18, 59, a, 'middle', 'art-big'); // Its letter
  label(svg, 48, 59, '→', 'middle', 'art-big muted'); // Arrow: "became"
  label(svg, 78, 30, years.latest); // Year over the second cell
  el('rect', { x: 62, y: 38, width: 32, height: 32, class: 'cell pick' }, svg); // The 2024 cell
  label(svg, 78, 59, b, 'middle', 'art-big'); // Its letter
  label(svg, 110, 59, '=', 'middle', 'art-big muted'); // Equals: "so it gets"
  el('rect', { x: 126, y: 38, width: 32, height: 32, class: `fill-${type}` }, svg); // The change colour
  label(svg, 142, 88, names[type]); // The colour named in words under it (colour never carries meaning alone)
} // End of drawCompare

// 5. Count: the change map worked out from the two years, and how many pixels of each colour
function drawCount(svg) {
  const counts = { built: 0, loss: 0, gain: 0, water: 0 }; // Pixels per change colour, counted below
  const size = 16; // Cell size, the same as step 3
  YEAR_A.forEach((row, r) => { // For each row...
    [...row].forEach((a, c) => { // ...and each pixel in it
      const type = changeType(a, YEAR_B[r][c]); // Compare it with the same pixel in 2024
      el('rect', { x: c * size, y: 20 + r * size, width: size, height: size, class: type ? `cell fill-${type}` : 'cell' }, svg); // Its colour, or an empty cell
      if (type) counts[type] += 1; // Count it
    }); // End of the pixels
  }); // End of the rows
  pickOutline(svg, 0, 20, size); // The picked pixel again
  label(svg, 40, 12, 'Change'); // Title over the grid
  const rows = [['built', 'built'], ['loss', 'cleared'], ['gain', 'gained'], ['water', 'water']]; // The four colours with short names
  rows.forEach(([type, name], i) => { // One readout line per colour
    const y = 30 + i * 18; // 18 units apart
    el('rect', { x: 96, y: y - 7, width: 8, height: 8, class: `fill-${type}` }, svg); // Its colour swatch
    label(svg, 110, y, `${counts[type]} ${name}`, 'start', 'art-text'); // e.g. "6 built" (6 pixels)
  }); // End of the readout
  svg.setAttribute('aria-label', `The change map: ${counts.built} pixels newly built, ${counts.loss} cleared, ${counts.gain} green space gained, ${counts.water} new water`); // Screen readers hear the real counts
} // End of drawCount

// 6. Lay it on the photo: the same change grid, see-through, over a "photo" with much finer detail (houses, a road)
function drawPhoto(svg) {
  const size = 16; // Cell size, the same as steps 3 and 5
  el('rect', { x: 0, y: 20, width: 80, height: 80, class: 'photo' }, svg); // The photo's area
  el('path', { d: 'M0 64 C30 60 50 70 80 66', class: 'photo-line' }, svg); // A curving road across it
  const houses = [[37, 25], [47, 25], [57, 25], [67, 25], [50, 37], [60, 37], [70, 37], [66, 49], [70, 54], [44, 41]]; // Small houses, top right, where the change is
  houses.forEach(([x, y]) => el('rect', { x, y, width: 6, height: 5, class: 'photo-line' }, svg)); // Each house: a tiny outline, far smaller than one 16-unit pixel
  YEAR_A.forEach((row, r) => { // The change grid again, row by row...
    [...row].forEach((a, c) => { // ...pixel by pixel
      const type = changeType(a, YEAR_B[r][c]); // The same colour rule
      if (type) el('rect', { x: c * size, y: 20 + r * size, width: size, height: size, class: `fill-${type} overlay` }, svg); // Only changed pixels, see-through
    }); // End of the pixels
  }); // End of the rows
  label(svg, 40, 12, 'Photo + change'); // Title over it
  label(svg, 92, 34, 'photo:', 'start'); // Readout on the right: the photo...
  label(svg, 92, 46, 'sharper', 'start', 'art-text'); // ...is sharper
  label(svg, 92, 70, 'change:', 'start'); // ...the change layer...
  label(svg, 92, 82, '10 m pixels', 'start', 'art-text'); // ...is 10 m pixels
} // End of drawPhoto

// ---------- Plate 02: the square, in pixels ----------
// Three 236 x 180 drawings (a little wider than tall, for the labels on the right) with the square in the same place and at the same size (120 units), so the eye can follow the zoom:
// the square -> the square split into pixels -> one corner of it, 10 x 10 pixels, blown up to the same size.
const SQ = { x: 50, y: 30, size: 120 }; // Where the square sits in each drawing: top-left corner and width

// A dimension line along the top of the square, with end ticks and its length written on it, like on a plan
function topDimension(svg, text) {
  const { x, y, size } = SQ; // Unpack the square's position
  el('path', { d: `M${x} ${y - 12} H${x + size} M${x} ${y - 16} V${y - 8} M${x + size} ${y - 16} V${y - 8}`, class: 'line' }, svg); // The line and its two ticks
  label(svg, x + size / 2, y - 15, text); // Its length, just above the line
} // End of topDimension

// A dimension line down the left side of the square, with its length written beside it
function leftDimension(svg, text) {
  const { x, y, size } = SQ; // Unpack the square's position
  el('path', { d: `M${x - 12} ${y} V${y + size} M${x - 16} ${y} H${x - 8} M${x - 16} ${y + size} H${x - 8}`, class: 'line' }, svg); // The line and its two ticks
  label(svg, x - 18, y + size / 2 + 3, text, 'end'); // Its length, to the left (+3 centres the text on the line)
} // End of leftDimension

// 1. The square: 2 x 2 km around the spot, 400 hectares
function drawSquareBig(svg) {
  const { x, y, size } = SQ; // Unpack the square's position
  el('rect', { x, y, width: size, height: size, class: 'line ink' }, svg); // The square
  topDimension(svg, '2 km'); // Its width
  leftDimension(svg, '2 km'); // Its height
  const cx = x + size / 2; // The centre, across...
  const cy = y + size / 2; // ...and down
  el('path', { d: `M${cx - 7} ${cy} H${cx - 2} M${cx + 2} ${cy} H${cx + 7} M${cx} ${cy - 7} V${cy - 2} M${cx} ${cy + 2} V${cy + 7}`, class: 'line ink' }, svg); // The spot: a cross, open in the middle
  label(svg, cx, cy + 24, '400 ha'); // The area, under the spot
} // End of drawSquareBig

// 2. Split into pixels: the same square with a grid. The real 200 x 200 grid would be a grey blur at this size, so we
// draw one line every 10 pixels (20 x 20 cells) and say so in the text. One 10-pixel cell in the top-right corner is marked:
// drawing 3 zooms into it.
function drawPixels(svg) {
  const { x, y, size } = SQ; // Unpack the square's position
  const step = size / 20; // One drawn cell = 10 pixels = 6 units
  let d = ''; // The grid's lines, collected into one path (faster than 38 separate lines)
  for (let i = 1; i < 20; i += 1) { // The 19 lines inside the square, each way
    d += `M${x + i * step} ${y} V${y + size} M${x} ${y + i * step} H${x + size} `; // One line down, one line across
  } // End of the grid lines
  el('path', { d, class: 'cell' }, svg); // Draw the grid, faint
  el('rect', { x, y, width: size, height: size, class: 'line ink' }, svg); // The square's edge, on top
  topDimension(svg, '200 pixels'); // Its width, now in pixels
  leftDimension(svg, '200'); // Its height in pixels
  const corner = x + size - step; // The left edge of the top-right cell
  el('rect', { x: corner, y, width: step, height: step, class: 'mark' }, svg); // The marked corner cell, filled in ink
  el('path', { d: `M${x + size} ${y + step / 2} H${x + size + 12}`, class: 'line dashed' }, svg); // A dashed leader out of it...
  label(svg, x + size + 15, y + step / 2 + 3, 'zoom', 'start'); // ...to the word "zoom"
  label(svg, x + size / 2, y + size + 18, '40,000 pixels'); // The total, under the square
} // End of drawPixels

// 3. One pixel: the marked corner, 10 x 10 pixels (100 m across), at the square's size; one pixel marked with its size
function drawPixel(svg) {
  const { x, y, size } = SQ; // Unpack the square's position
  const step = size / 10; // One pixel = 12 units here
  for (let r = 0; r < 10; r += 1) { // Each row of pixels...
    for (let c = 0; c < 10; c += 1) { // ...and each pixel in it
      el('rect', { x: x + c * step, y: y + r * step, width: step, height: step, class: 'cell' }, svg); // The pixel's outline
    } // End of the pixels in the row
  } // End of the rows
  el('rect', { x, y, width: size, height: size, class: 'line ink' }, svg); // The corner's edge
  leftDimension(svg, '100 m'); // Its height: 10 pixels of 10 m
  const px = x + size - step; // The marked pixel: the top-right one, matching the corner marked in drawing 2
  el('rect', { x: px, y, width: step, height: step, class: 'mark' }, svg); // The marked pixel, filled in ink
  el('path', { d: `M${px} ${y - 12} H${px + step} M${px} ${y - 16} V${y - 8} M${px + step} ${y - 16} V${y - 8}`, class: 'line' }, svg); // Its own dimension line along the top
  label(svg, px + step / 2, y - 19, '10 m'); // Its width, a little higher than the long dimensions' text, so it clears the close-together ticks
  el('path', { d: `M${x + size} ${y + step / 2} H${x + size + 12}`, class: 'line dashed' }, svg); // A dashed leader out of it...
  label(svg, x + size + 15, y + step / 2 - 2, '1 pixel', 'start', 'art-text'); // ...to its name...
  label(svg, x + size + 15, y + step / 2 + 10, '0.01 ha', 'start'); // ...and its area
  label(svg, x + size / 2, y + size + 18, '100 pixels = 1 ha'); // The handy rule, under the drawing
} // End of drawPixel

// Draw every picture: find each empty drawing box on the page and draw the matching picture in it
const DRAWINGS = { address: drawAddress, square: drawSquare, maps: drawMaps, compare: drawCompare, count: drawCount, photo: drawPhoto, 'square-big': drawSquareBig, pixels: drawPixels, pixel: drawPixel }; // Box name -> drawing function
function drawAll() {
  document.querySelectorAll('svg[data-art]').forEach((svg) => { // For each drawing box...
    svg.replaceChildren(); // ...empty it (when redrawing with the real years)...
    DRAWINGS[svg.dataset.art]?.(svg); // ...and draw its picture ("?.()" calls it only if a drawing with that name exists)
  }); // End of the boxes
} // End of drawAll

drawAll(); // Draw at once, with "first" / "latest" as the years...
loadYears().then(drawAll); // ...then again once the real years have arrived (or not: then nothing changes)
