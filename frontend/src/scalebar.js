// The scale bar in the bottom-left corner of the map, drawn like the scale bar on a plan sheet:
// two blocks (one light, one dark) with labels "0", the middle, and the end, e.g. "0  250  500 m".

// The distance around the Earth at the equator, in meters
const EARTH_CIRCUMFERENCE = 40075016.686;
// MapLibre's zoom levels are based on a world that is 512 pixels wide at zoom 0, doubling with each zoom level
const WORLD_SIZE_AT_ZOOM_0 = 512;
// The longest the bar may be on screen, in pixels. The nice lengths below are at most 2.5× apart,
// so the bar is always between 64 and 160 px: long enough that its three labels never collide.
const MAX_BAR_PIXELS = 160;
// The "nice" lengths the bar may show, in meters. Each one's half is also a round number (the middle label).
const NICE_LENGTHS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

const scale = document.getElementById('scale'); // The whole scale bar (blocks and labels)
const middleLabel = document.getElementById('scale-mid'); // The label in the middle
const endLabel = document.getElementById('scale-end'); // The label at the end

// How many meters one screen pixel covers at a given latitude and zoom level.
// In Web Mercator, the map is stretched more and more toward the poles, by 1 / cos(latitude),
// so one pixel covers fewer real meters in Stavanger (59° N) than in Fontana (34° N) at the same zoom.
export function metersPerPixel(lat, zoom) {
  const latRadians = (lat * Math.PI) / 180; // The latitude in radians, which Math.cos needs
  const worldSizeInPixels = WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom; // How many pixels wide the whole world is at this zoom ("**" means "to the power of")
  return (EARTH_CIRCUMFERENCE * Math.cos(latRadians)) / worldSizeInPixels; // Meters around the Earth at this latitude, divided by pixels around it
} // End of metersPerPixel

// Write a number of meters in the unit used at the end of the bar: plain meters, or kilometers for 1000 m and up
function inUnit(meters, useKilometers) {
  return useKilometers ? String(meters / 1000) : String(meters); // e.g. 500 → "0.5" in km, or "500" in m
} // End of inUnit

// Redraw the scale bar for the map's current center latitude and zoom
export function updateScaleBar(lat, zoom) {
  const mpp = metersPerPixel(lat, zoom); // Meters per pixel right now
  const maxMeters = MAX_BAR_PIXELS * mpp; // The longest distance that fits in the allowed bar length

  let meters = NICE_LENGTHS[0]; // Start with the shortest nice length
  for (const length of NICE_LENGTHS) { // Try each nice length, shortest first
    if (length <= maxMeters) meters = length; // Keep the longest one that still fits
  } // End of the nice lengths loop

  const useKilometers = meters >= 1000; // Show kilometers for 1 km and longer
  scale.style.width = `${meters / mpp}px`; // Make the bar exactly as long as that distance on screen
  middleLabel.textContent = inUnit(meters / 2, useKilometers); // Middle label: half the length, e.g. "250"
  endLabel.textContent = `${inUnit(meters, useKilometers)} ${useKilometers ? 'km' : 'm'}`; // End label with its unit, e.g. "500 m"
  scale.style.marginRight = `${endLabel.offsetWidth / 2}px`; // The end label is centered on the bar's end, so its right half hangs past it: reserve exactly that much room inside the backing
} // End of updateScaleBar
