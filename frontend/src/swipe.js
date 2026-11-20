// The "before" imagery for the swipe: Esri's archive photo closest to the first year (2017), assembled from map tiles into
// one picture and cut to the exact analysis square, so it can be shown inside the square only.

const ZOOM = 16; // The tile zoom level: about 2 m per pixel here, sharp at the size the square appears on screen
const TILE = 256; // Every map tile is 256 x 256 pixels

// Turn longitude/latitude into "world pixel" positions at a zoom level, on the standard web-map ("Web Mercator") grid:
// at zoom 16 the whole world is 65,536 tiles wide, and this says how many pixels from its top-left corner a point is.
function project(lon, lat, zoom) {
  const size = TILE * 2 ** zoom; // The width of the whole world in pixels at this zoom
  const sin = Math.sin((lat * Math.PI) / 180); // The sine of the latitude, used by the Mercator formula
  return { // The position:
    x: ((lon + 180) / 360) * size, // How far east: longitude shares the width evenly
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size, // How far south: the Mercator formula stretches towards the poles
  }; // End of the position
} // End of project

// The reverse: a world pixel position back to [longitude, latitude]
function unproject(x, y, zoom) {
  const size = TILE * 2 ** zoom; // The width of the whole world in pixels at this zoom
  const lon = (x / size) * 360 - 180; // Undo the east-west step
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI; // Undo the Mercator stretch
  return [lon, lat]; // Hand back the pair
} // End of unproject

// Load one tile picture. "anonymous" asks the server for permission to use it in a canvas (Esri allows it), and a
// failed tile resolves to null instead of stopping everything: that spot just stays see-through.
function loadTile(url) {
  return new Promise((resolve) => { // A Promise we finish ourselves
    const image = new Image(); // A new, empty picture
    image.crossOrigin = 'anonymous'; // Ask for permission to draw it into a canvas we can use
    image.onload = () => resolve(image); // Loaded: hand it back
    image.onerror = () => resolve(null); // Failed: hand back nothing
    image.src = url; // Start loading
  }); // End of the Promise
} // End of loadTile

// Build the before picture. "tiles" is the archive version's tile address with {z}/{y}/{x} in it (from /api/wayback),
// "corners" the square's four corners as [lon, lat] (top-left, top-right, bottom-right, bottom-left, from the change answer).
// Returns { canvas, coordinates, square }: the picture, its four corners on the map, and the square's corners in its pixels.
export async function buildBeforeImage(tiles, corners) {
  const points = corners.map(([lon, lat]) => project(lon, lat, ZOOM)); // The square's corners as world pixels
  const left = Math.floor(Math.min(...points.map((p) => p.x))); // The smallest box around the square: its left edge...
  const right = Math.ceil(Math.max(...points.map((p) => p.x))); // ...right edge...
  const top = Math.floor(Math.min(...points.map((p) => p.y))); // ...top edge...
  const bottom = Math.ceil(Math.max(...points.map((p) => p.y))); // ...and bottom edge, in world pixels

  const canvas = document.createElement('canvas'); // A drawing surface, not on the page: the map will show it
  canvas.width = right - left; // As wide as the box...
  canvas.height = bottom - top; // ...and as tall
  const context = canvas.getContext('2d'); // Its drawing tools

  const jobs = []; // One job per tile, all loading at the same time
  for (let column = Math.floor(left / TILE); column <= Math.floor((right - 1) / TILE); column++) { // Every tile column the box touches
    for (let row = Math.floor(top / TILE); row <= Math.floor((bottom - 1) / TILE); row++) { // ...and every tile row
      const url = tiles.replace('{z}', ZOOM).replace('{y}', row).replace('{x}', column); // This tile's address
      jobs.push(loadTile(url).then((image) => { // When it has loaded:
        if (image) context.drawImage(image, column * TILE - left, row * TILE - top); // Draw it where it belongs in the box (failed tiles stay see-through)
      })); // End of the job
    } // End of the rows
  } // End of the columns
  await Promise.all(jobs); // Wait for every tile

  const square = points.map((p) => [p.x - left, p.y - top]); // The square's corners in the canvas's own pixels
  context.globalCompositeOperation = 'destination-in'; // Next drawing keeps only what's under it: "cut out" mode
  context.beginPath(); // The square's outline:
  square.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y))); // Corner to corner
  context.closePath(); // Back to the first corner
  context.fill(); // Cut: everything outside the square becomes see-through
  context.globalCompositeOperation = 'source-over'; // Back to normal drawing

  return { // The picture and where it goes:
    canvas, // The picture
    coordinates: [unproject(left, top, ZOOM), unproject(right, top, ZOOM), unproject(right, bottom, ZOOM), unproject(left, bottom, ZOOM)], // Its corners on the map, in MapLibre's order: top-left, top-right, bottom-right, bottom-left
    square, // The square's corners in the picture's pixels (the swipe uses them)
  }; // End of the answer
} // End of buildBeforeImage

// Draw the visible part of the before picture onto "target" (the canvas the map shows): only the part of the square left of
// the handle. "fraction" is where the handle is across the square: 0 = left edge (no 2017 shown), 1 = right edge (all 2017).
// "before" is what buildBeforeImage returned. The map is turned grid-up, so the square's left edge is straight on screen
// and a vertical handle cuts the square from a point on its top edge to the matching point on its bottom edge.
export function drawBeforePart(before, target, fraction) {
  const context = target.getContext('2d'); // The target's drawing tools
  context.clearRect(0, 0, target.width, target.height); // Start from a fully see-through picture
  if (fraction <= 0) return; // Handle at the left edge: nothing of 2017 to show
  const [topLeft, topRight, bottomRight, bottomLeft] = before.square; // The square's corners in the picture's pixels
  const along = (a, b) => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]; // The point "fraction" of the way from corner a to corner b
  context.save(); // Remember the normal drawing settings
  context.beginPath(); // The part to show: from the left edge to the handle
  context.moveTo(...topLeft); // Top-left corner ("..." spreads [x, y] into two numbers)
  context.lineTo(...along(topLeft, topRight)); // Along the top edge, as far as the handle
  context.lineTo(...along(bottomLeft, bottomRight)); // Down the handle to the bottom edge
  context.lineTo(...bottomLeft); // Back along the bottom edge to the bottom-left corner
  context.closePath(); // Up the left edge
  context.clip(); // From now on, only draw inside that shape
  context.drawImage(before.canvas, 0, 0); // Draw the whole before picture: only the part inside the shape appears
  context.restore(); // Forget the clip again
} // End of drawBeforePart

// The text of a year tag on the swipe line, from a photo's capture date: "2017-10-21" -> "2017 · 21 OCT".
// The year is the photo's own year (not the land-cover year), so the tag is always true, even for an older photo.
export function tagText(isoDate) {
  const date = new Date(`${isoDate}T00:00`); // Turn the text into a date ("T00:00" = local midnight, so the day doesn't shift)
  const month = date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(); // The short month name in capitals, e.g. "OCT"
  return `${date.getFullYear()} · ${date.getDate()} ${month}`; // e.g. "2017 · 21 OCT"
} // End of tagText
