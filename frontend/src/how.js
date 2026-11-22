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

// ---------- Plate 03: their 9 classes, our 5 ----------
// A wiring diagram: Impact Observatory's classes in boxes on the left, our categories on the right, joined by lines.
// Where several classes go to one category, their lines meet on a short upright "bus" line, like wires joining.
// This is the same table the backend uses (IO_LOOKUP in backend/app/landcover.py).
const IO_CLASSES = [ // Their classes, top to bottom, ordered so the lines never cross; "to" = our category's key below
  { name: 'Trees', to: 'T' }, // Trees stay trees
  { name: 'Crops', to: 'G' }, // Crops...
  { name: 'Rangeland', to: 'G' }, // ...rangeland (grass and shrubs)...
  { name: 'Flooded vegetation', to: 'G' }, // ...and wetlands or rice all become grass or farmland
  { name: 'Built area', to: 'B' }, // Built stays built
  { name: 'Water', to: 'W' }, // Water stays water
  { name: 'Bare ground', to: 'S' }, // Bare ground...
  { name: 'Snow/ice', to: 'S' }, // ...and snow or ice become bare ground
  { name: 'Clouds', to: 'N' }, // Clouds become "no data"
]; // End of their classes
const OUR_CATEGORIES = [ // Our categories, in the same order; "letter" is the one shown in the other diagrams
  { key: 'T', letter: 'T', name: 'Trees' }, // Trees
  { key: 'G', letter: 'G', name: 'Grass or farmland' }, // Grass or farmland
  { key: 'B', letter: 'B', name: 'Built' }, // Built
  { key: 'W', letter: 'W', name: 'Water' }, // Water
  { key: 'S', letter: 'S', name: 'Bare ground' }, // Bare ground
  { key: 'N', letter: '', name: 'No data' }, // No data (no letter: it's never a land type)
]; // End of our categories

function drawClasses(svg) {
  const ROW = 30; // Distance from one left box to the next
  const BOX = 22; // Box height
  const TOP = 24; // Where the first box starts (room for the headings above)
  const LEFT_W = 128; // Left boxes: from x 0 to 128
  const RIGHT_X = 206; // Right boxes start here...
  const RIGHT_W = 134; // ...and are this wide (ending at 340)
  const BUS_X = 167; // The upright line where merging wires meet, halfway between the two columns
  label(svg, 0, 12, 'Impact Observatory', 'start'); // Heading over the left column
  label(svg, RIGHT_X, 12, 'Landturn', 'start'); // Heading over the right column

  const middleOf = (row) => TOP + row * ROW + BOX / 2; // The middle height of the left box in this row

  // Each of our categories sits level with the middle of the classes that feed it
  const rightMiddle = {}; // Category key -> the middle height of its box
  OUR_CATEGORIES.forEach(({ key }) => { // For each category...
    const rows = IO_CLASSES.map((c, i) => (c.to === key ? i : -1)).filter((i) => i >= 0); // ...the rows of the classes that go to it
    rightMiddle[key] = (middleOf(rows[0]) + middleOf(rows[rows.length - 1])) / 2; // Halfway between the first and the last of them
  }); // End of the categories

  IO_CLASSES.forEach(({ name, to }, i) => { // Each of their classes:
    const y = middleOf(i); // Its middle height
    const cloud = to === 'N'; // The clouds row is drawn dashed: it leads to "no data", not to a land type
    el('rect', { x: 0, y: y - BOX / 2, width: LEFT_W, height: BOX, class: cloud ? 'line dashed' : 'line' }, svg); // Its box
    label(svg, 8, y + 3.5, name, 'start', 'art-text'); // Its name (+3.5 centres the text in the box)
    el('path', { d: `M${LEFT_W} ${y} H${BUS_X} V${rightMiddle[to]} H${RIGHT_X}`, class: cloud ? 'line dashed' : 'line' }, svg); // Its wire: across, up or down the bus, across to its category
  }); // End of their classes

  OUR_CATEGORIES.forEach(({ key, letter, name }) => { // Each of our categories:
    const y = rightMiddle[key]; // Its middle height
    const none = key === 'N'; // "No data" is drawn dashed and quiet
    el('rect', { x: RIGHT_X, y: y - BOX / 2, width: RIGHT_W, height: BOX, class: none ? 'line dashed' : `cat-box lc-${key.toLowerCase()}` }, svg); // Its box: filled with the category's muted land-cover colour (e.g. "lc-t" for trees), or dashed for no data
    if (letter) label(svg, RIGHT_X + 8, y + 3.5, letter, 'start', 'art-text'); // Its letter, as in the other diagrams
    label(svg, RIGHT_X + (letter ? 22 : 8), y + 3.5, name, 'start', none ? 'art-label' : 'art-text'); // Its name
    const merges = IO_CLASSES.filter((c) => c.to === key).length > 1; // Do several wires meet here?
    if (merges) el('circle', { cx: BUS_X, cy: y, r: 2.5, class: 'junction' }, svg); // A dot where they join, like a wiring junction
  }); // End of our categories

  // A bracket to the right of Trees and Grass or farmland: both count as green space
  const top = rightMiddle.T - BOX / 2; // Top of the Trees box
  const bottom = rightMiddle.G + BOX / 2; // Bottom of the Grass or farmland box
  el('path', { d: `M346 ${top} H350 V${bottom} H346`, class: 'line' }, svg); // The bracket
  const mid = (top + bottom) / 2; // Its middle
  el('text', { x: 360, y: mid, 'text-anchor': 'middle', transform: `rotate(90 360 ${mid})`, class: 'art-label' }, svg).textContent = 'green space'; // Its label, turned to run down the bracket
} // End of drawClasses

// ---------- Plate 04: the example cards ----------
// Each card shows a small before -> after pair of pixel grids, in the same style as plates 01 and 03: every cell is
// a 10 m pixel in its category's muted colour with its letter. In the after grid, a cell that changed gets the bright
// change colour, worked out by changeType (the app's colour rule, above), so the cards can never disagree with the rule.
const EXAMPLES = { // Each example: the before grid and the after grid, row by row from the top (letters as in plate 03)
  built: { before: ['GGGG', 'GGGG', 'TTGG', 'TTGG'], after: ['GBBB', 'GBBB', 'TTBB', 'TTGG'] }, // Field -> warehouse
  water: { before: ['TTGG', 'TTGG', 'TTGG', 'TGGG'], after: ['TWWG', 'TWWG', 'TWWG', 'TWWG'] }, // Valley -> reservoir: trees and fields flooded
  loss: { before: ['TTTT', 'TTTT', 'TTTT', 'TTGG'], after: ['TSST', 'TSST', 'TSST', 'TTGG'] }, // Forest -> bare dirt
  gain: { before: ['BBBS', 'BBBS', 'BBSS', 'BBSS'], after: ['BGGG', 'BTGT', 'BTTG', 'BBGG'] }, // Parking lot and bare lots -> park
  none: { before: ['TTT', 'TTT', 'TTT'], after: ['GGT', 'GGT', 'GGG'] }, // Forest -> farmland: no colour (green stayed green)
  // Plate 06 ("N" = no data: hidden by cloud)
  wrong: { before: ['GGGG', 'GGGG', 'GGGG', 'GGGG'], after: ['GGGG', 'GSSS', 'GSSS', 'GSSS'] }, // A dry field mislabelled bare ground: false red, 3 x 3 pixels, wide enough to survive cleaning (plate 05)
  edge: { before: ['TTWW', 'TTWW', 'TTWW', 'TTWW'], after: ['TWWW', 'TTWW', 'TWWW', 'TTTW'] }, // A shoreline flipping both ways
  cloud: { before: ['GGBB', 'GGBB', 'GGGB', 'GGGB'], after: ['GGBB', 'NNBB', 'NNNB', 'GGGB'] }, // Cloud over part of the later year
}; // End of the examples

// One pixel grid with its top-left corner at (x, y). "rows" are its letters; "compareTo" (optional) is the before grid,
// so changed cells can be coloured; "size" is one cell's width; "letterClass" sets the lettering size.
function pixelGrid(svg, x, y, rows, size, compareTo, letterClass) {
  rows.forEach((row, r) => { // Each row...
    [...row].forEach((letter, c) => { // ...and each pixel in it
      if (letter === 'N') { // No data (cloud): no category, so no colour at all
        el('rect', { x: x + c * size, y: y + r * size, width: size, height: size, class: 'cell dashed' }, svg); // A dashed empty cell...
        label(svg, x + c * size + size / 2, y + r * size + size / 2 + 3, '?', 'middle', 'art-label'); // ...with "?": unknown
        return; // Nothing more for this pixel
      } // End of the no-data pixel
      const type = compareTo ? changeType(compareTo[r][c], letter) : null; // The change colour, if this is the after grid and the pixel changed
      const fill = type ? `fill-${type}` : `lc-${letter.toLowerCase()}`; // Bright change colour, or the category's muted colour
      el('rect', { x: x + c * size, y: y + r * size, width: size, height: size, class: `cell ${fill}` }, svg); // The pixel, with a faint grid line round it
      label(svg, x + c * size + size / 2, y + r * size + size / 2 + 3, letter, 'middle', type ? `${letterClass} on-colour` : letterClass); // Its letter (dark on a bright colour, so it stays readable)
    }); // End of the pixels in the row
  }); // End of the rows
} // End of pixelGrid

// A card's picture: years above, the before grid, an arrow, the after grid (both 4 x 4, cells 16 units like plate 01)
function drawExample(svg, key, afterLabel) {
  const { before, after } = EXAMPLES[key]; // This card's two grids
  const CELL = 16; // One pixel's size, the same as plate 01's grids
  label(svg, 32, 10, years.first); // The first year over the before grid (filled in from /api/years, like plate 01)
  pixelGrid(svg, 0, 18, before, CELL, null, 'art-letter'); // The before grid
  label(svg, 81, 55, '→', 'middle', 'art-big muted'); // "became", level with the grids' middle
  if (afterLabel) label(svg, 162, 10, afterLabel, 'end'); // A label instead of the year (too long to centre, so it ends at the drawing's right edge)
  else label(svg, 130, 10, years.latest); // The latest year over the after grid
  pixelGrid(svg, 98, 18, after, CELL, before, 'art-letter'); // The after grid, compared with the before grid
} // End of drawExample

// The tiny pair beside "No colour": 3 x 3 grids, cells 11 units, trees -> grass or farmland, which gets no colour
function drawNoColour(svg) {
  const { before, after } = EXAMPLES.none; // The two grids
  pixelGrid(svg, 0, 0, before, 11, null, 'art-letter-sm'); // Before
  label(svg, 41, 20, '→', 'middle', 'art-label'); // "became"
  pixelGrid(svg, 49, 0, after, 11, before, 'art-letter-sm'); // After: the changed pixels keep muted colours, because changeType gives no colour
} // End of drawNoColour

// ---------- Plate 05: cleaning the edges ----------
// A made-up 10 x 10 change map ("." = no change; B, W, L, G = the four change colours). The cleaning below copies the
// backend's remove_thin_changes step by step, so the drawing shows exactly what the app does.
const EDGE_MAP = [ // Row by row from the top
  '..........', // Row 0
  '.BBBBB....', // A new building block, 5 x 4 pixels: real change
  '.BBBBB..W.', // The diagonal W line: a shoreline whose edge pixels flipped to water (1 pixel wide: noise)
  '.BBBBB.W..', // Row 3
  '.BBBBBW...', // Row 4
  '.....W....', // Row 5
  '.L..W..GG.', // L: one lone cleared pixel (a speck). GG: a strip 2 pixels wide along a field edge
  '...W...GG.', // Row 7
  '..W....GG.', // Row 8
  '.......GG.', // Row 9
]; // End of the made-up change map
const EDGE_TYPES = { B: 'built', W: 'water', L: 'loss', G: 'gain' }; // Letter -> change colour

// Is (r, c) inside the grid?
const inside = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;

// Shrink ("erode") one colour's patches: a pixel stays only if it and all 8 neighbours have that colour.
// Beyond the map's edge counts as "the same as the border pixel", like the backend's "edge" padding, so a patch that
// merely touches the edge of the square isn't shrunk from that side.
function erode(mask) {
  return mask.map((row, r) => row.map((on, c) => { // For every pixel...
    for (let dr = -1; dr <= 1; dr += 1) { // ...look at the row above, its own row and the row below...
      for (let dc = -1; dc <= 1; dc += 1) { // ...and the column left, its own and right
        const rr = Math.min(9, Math.max(0, r + dr)); // A neighbour beyond the edge is replaced by the nearest border pixel ("edge" padding)
        const cc = Math.min(9, Math.max(0, c + dc)); // Same for columns
        if (!mask[rr][cc]) return false; // One neighbour without the colour: this pixel goes
      } // End of the columns
    } // End of the rows
    return true; // All 9 had the colour: it stays
  })); // End of the pixels
} // End of erode

// Grow ("dilate") one colour's patches: a pixel gets the colour if it or any of its 8 neighbours has it.
// Beyond the edge counts as "no colour" (the backend's "constant" padding), so nothing grows in from outside.
function dilate(mask) {
  return mask.map((row, r) => row.map((on, c) => { // For every pixel...
    for (let dr = -1; dr <= 1; dr += 1) { // ...look at the 3 x 3 block around it
      for (let dc = -1; dc <= 1; dc += 1) { // (columns too)
        if (inside(r + dr, c + dc) && mask[r + dr][c + dc]) return true; // A neighbour with the colour: this pixel gets it
      } // End of the columns
    } // End of the rows
    return false; // No neighbour had it
  })); // End of the pixels
} // End of dilate

// Run the cleaning, one colour at a time, like the backend. For every pixel it records three answers:
// raw = its colour before cleaning, shrunk = its colour after shrinking (or null), kept = its colour after cleaning (or null).
function cleanEdges() {
  const raw = EDGE_MAP.map((row) => [...row].map((ch) => EDGE_TYPES[ch] || null)); // The raw change map as colour names
  const shrunk = raw.map((row) => row.map(() => null)); // Start empty
  const kept = raw.map((row) => row.map(() => null)); // Start empty
  Object.values(EDGE_TYPES).forEach((type) => { // For each colour on its own...
    const mask = raw.map((row) => row.map((t) => t === type)); // ...where is it? (true / false per pixel)
    const small = erode(mask); // Shrink
    const grown = dilate(small); // Grow back
    raw.forEach((row, r) => row.forEach((t, c) => { // Write the answers for this colour
      if (small[r][c]) shrunk[r][c] = type; // Survived the shrink
      if (mask[r][c] && grown[r][c]) kept[r][c] = type; // Was this colour AND came back: kept (the backend's "mask & kept")
    })); // End of the pixels
  }); // End of the colours
  return { raw, shrunk, kept }; // All three stages
} // End of cleanEdges
const EDGES = cleanEdges(); // Work it out once; the three drawings use it

// One stage's grid at the square's usual place (SQ, from plate 02): solid colour where the pixel has a colour at this
// stage, a faint "ghost" where it had one in the raw map but has lost it, and a count underneath.
function drawEdgeStage(svg, stage, caption) {
  const { x, y, size } = SQ; // The square's position, the same as plate 02's drawings
  const cell = size / 10; // 12 units per pixel
  let count = 0; // Coloured pixels at this stage, counted from the grid itself as it is drawn below, so the number always matches the picture (and, because EDGES comes from the same 3 x 3 opening as the backend, the backend's answer too)
  EDGES.raw.forEach((row, r) => row.forEach((rawType, c) => { // Every pixel...
    const now = EDGES[stage][r][c]; // ...its colour at this stage (or null)
    const box = { x: x + c * cell, y: y + r * cell, width: cell, height: cell }; // Its square
    if (now) { el('rect', { ...box, class: `cell fill-${now}` }, svg); count += 1; } // Coloured now: solid, and counted
    else if (rawType) el('rect', { ...box, class: `cell fill-${rawType} ghost` }, svg); // Lost its colour: a faint ghost of it
    else el('rect', { ...box, class: 'cell' }, svg); // Never coloured: an empty cell
  })); // End of the pixels
  el('rect', { x, y, width: size, height: size, class: 'line ink' }, svg); // The map's edge
  label(svg, x + size / 2, y - 10, `${count} changed pixels`); // The count above the grid, e.g. "36 changed pixels"
  label(svg, x + size / 2, y + size + 18, caption); // What happened, under the grid
} // End of drawEdgeStage

// ---------- Plate 06: why it's an estimate ----------
// Cards 1 to 3 reuse drawExample (plate 04) with the "wrong", "edge" and "cloud" grids above. Cards 4 and 5 are drawn here.

// 10 m is coarse: one pixel drawn to scale (64 units = 10 m, so 6.4 units per metre), with a 3 x 2 m garden shed and a
// tree 5 m across inside it. The whole pixel still gets one label.
function drawCoarse(svg) {
  const X = 12; // The pixel's left edge (room on the right for the note)
  const Y = 14; // Its top edge
  const P = 64; // Its size: 10 m
  const M = P / 10; // Units per metre
  el('rect', { x: X, y: Y, width: P, height: P, class: 'cell lc-g' }, svg); // The pixel, in grass or farmland's muted colour
  el('rect', { x: X + 8, y: Y + P - 8 - 2 * M, width: 3 * M, height: 2 * M, class: 'line ink' }, svg); // The shed, 3 x 2 m, in the bottom-left corner
  el('circle', { cx: X + P - 8 - 2.5 * M, cy: Y + 8 + 2.5 * M, r: 2.5 * M, class: 'line ink' }, svg); // The tree's crown, 5 m across, top right
  label(svg, X + 7, Y + 11, 'G', 'start', 'art-letter'); // The one label the whole pixel gets
  el('path', { d: `M${X} ${Y - 6} H${X + P} M${X} ${Y - 9} V${Y - 3} M${X + P} ${Y - 9} V${Y - 3}`, class: 'line' }, svg); // A dimension line along the top
  label(svg, X + P / 2, Y - 9, '10 m'); // Its length
  label(svg, X + P + 8, Y + 28, 'shed, tree:', 'start'); // A note on the right...
  label(svg, X + P + 8, Y + 40, 'smaller than', 'start', 'art-text'); // ...saying both...
  label(svg, X + P + 8, Y + 52, 'one pixel', 'start', 'art-text'); // ...fit inside one pixel
} // End of drawCoarse

// Photo and map dates differ: a timeline with the land-cover map's year and the photo's date at different places
function drawDates(svg) {
  const Y = 48; // The timeline's height
  el('path', { d: `M6 ${Y} H156`, class: 'line' }, svg); // The timeline
  let ticks = ''; // Small ticks for the years, collected into one path
  for (let i = 0; i <= 8; i += 1) ticks += `M${10 + i * 18} ${Y - 3} V${Y + 3} `; // 9 evenly spaced year ticks
  el('path', { d: ticks, class: 'line' }, svg); // Draw them
  el('rect', { x: 132, y: Y - 5, width: 10, height: 10, class: 'cell lc-g' }, svg); // The land-cover map's year: a small map pixel...
  label(svg, 137, Y - 12, 'map', 'middle', 'art-text'); // ...labelled "map"
  el('circle', { cx: 64, cy: Y, r: 5, class: 'line ink' }, svg); // The photo's date: a camera-lens circle...
  label(svg, 64, Y - 12, 'photo', 'middle', 'art-text'); // ...labelled "photo"
  el('path', { d: `M64 ${Y + 14} H137 M64 ${Y + 11} V${Y + 17} M137 ${Y + 11} V${Y + 17}`, class: 'line' }, svg); // A dimension line between them
  label(svg, 100, Y + 28, 'can be years apart'); // How far apart they can be
} // End of drawDates

// ---------- Plate 07: where you can look ----------
// One drawing, to scale: the 20 x 20 km box (160 units, so 8 units per km), the 2 x 2 km result in the middle, a dashed
// new square pushed against the limit for its centre, and that limit as a dashed line inside the box's edge. The limits
// are the map's own (EXPLORE_RADIUS_M and safeBox() in map.js).
const LOOK = { x: 50, y: 36, size: 160 }; // The box: top-left corner and width
const KM = LOOK.size / 20; // Units per kilometre: 8
const INSET = 1.4 * KM; // The limit, 1.4 km inside the edge: a middle value (the real one, 1.2 to 2 km, depends on the screen's shape)

// A 2 x 2 km square centred on (cx, cy). "cls" picks its look: solid for the result, dashed for a new one.
function kmSquare(svg, cx, cy, cls) {
  el('rect', { x: cx - KM, y: cy - KM, width: 2 * KM, height: 2 * KM, class: cls }, svg); // 1 km each way from its centre
} // End of kmSquare

// A dashed leader from (x, y) out past the box's right edge, to a word on the right (like plate 02's "zoom")
function leader(svg, x, y, text, cls = 'art-label') {
  const end = LOOK.x + LOOK.size + 8; // The leader ends 8 units right of the box (short, so the longest label fits on a phone)
  el('path', { d: `M${x} ${y} H${end}`, class: 'line dashed' }, svg); // The leader
  label(svg, end + 3, y + 3, text, 'start', cls); // The word (+3 centres it on the line)
} // End of leader

function drawLook(svg) {
  const { x, y, size } = LOOK; // Unpack the box's position
  const mx = x + size / 2; // The box's centre (the address), across...
  const my = y + size / 2; // ...and down
  const outer = `M${x} ${y} h${size} v${size} h${-size} Z`; // The box's outline, as a path...
  const inner = `M${x + INSET} ${y + INSET} v${size - 2 * INSET} h${size - 2 * INSET} v${-(size - 2 * INSET)} Z`; // ...and the limit's, drawn the other way round
  el('path', { d: `${outer} ${inner}`, class: 'margin' }, svg); // The band between them, shaded faintly (the inner outline leaves a hole)
  el('rect', { x, y, width: size, height: size, class: 'line ink' }, svg); // The box: as far as the map lets you pan
  el('rect', { x: x + INSET, y: y + INSET, width: size - 2 * INSET, height: size - 2 * INSET, class: 'line dashed' }, svg); // The limit for a new square's centre
  el('path', { d: `M${x} ${y - 12} H${x + size} M${x} ${y - 16} V${y - 8} M${x + size} ${y - 16} V${y - 8}`, class: 'line' }, svg); // Dimension line along the top, with end ticks
  label(svg, mx, y - 15, '20 km'); // Its length
  el('path', { d: `M${x - 12} ${y} V${y + size} M${x - 16} ${y} H${x - 8} M${x - 16} ${y + size} H${x - 8}`, class: 'line' }, svg); // Dimension line down the left side
  label(svg, x - 18, my + 3, '20 km', 'end'); // Its length
  kmSquare(svg, mx, my, 'mark'); // Your result's square, solid so it reads at this small size
  const nx = x + size - INSET; // The new square, pushed right to the limit: its centre on the line...
  const ny = y + 50; // ...in the upper part of the box
  kmSquare(svg, nx, ny, 'line ink dashed'); // The dashed square
  el('circle', { cx: nx, cy: ny, r: 1.5, class: 'mark' }, svg); // Its centre, sitting on the limit
  const tx = nx - KM - 4; // The arrow's tip, just off the dashed square's bottom-left corner, across...
  const ty = ny + KM + 4; // ...and down
  const sx = mx + KM + 4; // The arrow's start, just off the result's top-right corner, across...
  const sy = my - KM - 4; // ...and down
  el('path', { d: `M${sx} ${sy} L${tx} ${ty}`, class: 'line' }, svg); // The arrow's shaft
  const angle = Math.atan2(ty - sy, tx - sx); // Which way the arrow points, as an angle (atan2 turns a direction into an angle)
  const head = (turn) => `${tx - 6 * Math.cos(angle + turn)} ${ty - 6 * Math.sin(angle + turn)}`; // A point 6 units back from the tip, turned a little to one side
  el('path', { d: `M${head(0.45)} L${tx} ${ty} L${head(-0.45)}`, class: 'line' }, svg); // The arrowhead: two short strokes, angled back from the tip along the shaft
  leader(svg, nx + KM, ny, 'Analyze this area', 'art-text'); // The dashed square's button, named in ink like the app's button
  leader(svg, mx + KM, my, 'result'); // The result, named
  leader(svg, x + size - INSET, y + size - 30, 'limit'); // The limit line, named
  label(svg, mx, y + size + 18, '10 km each way'); // The rule, under the box
} // End of drawLook

// Draw every picture: find each empty drawing box on the page and draw the matching picture in it
const DRAWINGS = { // Box name -> drawing function
  address: drawAddress, square: drawSquare, maps: drawMaps, compare: drawCompare, count: drawCount, photo: drawPhoto, // Plate 01
  'square-big': drawSquareBig, pixels: drawPixels, pixel: drawPixel, // Plate 02
  classes: drawClasses, // Plate 03
  'ex-built': (svg) => drawExample(svg, 'built'), // Field -> warehouse: orange
  'ex-water': (svg) => drawExample(svg, 'water'), // Valley -> reservoir: blue
  'ex-loss': (svg) => drawExample(svg, 'loss'), // Forest -> bare dirt: red
  'ex-gain': (svg) => drawExample(svg, 'gain'), // Parking lot -> park: green
  'ex-none': drawNoColour, // Forest -> farmland: no colour
  'edges-raw': (svg) => drawEdgeStage(svg, 'raw', 'before cleaning'), // Plate 05, step 1
  'edges-shrink': (svg) => drawEdgeStage(svg, 'shrunk', 'faint: shrunk away'), // Step 2
  'edges-grow': (svg) => drawEdgeStage(svg, 'kept', 'faint: removed for good'), // Step 3
  'est-wrong': (svg) => drawExample(svg, 'wrong'), // Plate 06: a wrong label
  'est-edge': (svg) => drawExample(svg, 'edge', 'before cleaning'), // Fuzzy edges: labelled so it doesn't contradict plate 05 (cleaning would remove these thin flips)
  'est-cloud': (svg) => drawExample(svg, 'cloud'), // Clouds
  'est-coarse': drawCoarse, // 10 m is coarse
  'est-dates': drawDates, // Photo and map dates
  look: drawLook, // Plate 07: the 20 km box, the result, a new square and the limit
}; // End of the drawings
function drawAll() {
  document.querySelectorAll('svg[data-art]').forEach((svg) => { // For each drawing box...
    svg.replaceChildren(); // ...empty it (when redrawing with the real years)...
    DRAWINGS[svg.dataset.art]?.(svg); // ...and draw its picture ("?.()" calls it only if a drawing with that name exists)
  }); // End of the boxes
} // End of drawAll

drawAll(); // Draw at once, with "first" / "latest" as the years...
loadYears().then(drawAll); // ...then again once the real years have arrived (or not: then nothing changes)
