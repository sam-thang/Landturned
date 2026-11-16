// Bring in two tools from the MapLibre library: the map itself and the zoom/rotate buttons
import { MapLibreMap, NavigationControl } from 'maplibre-gl';
// Bring in MapLibre's own styles, which make the buttons and attribution text look right
import 'maplibre-gl/dist/maplibre-gl.css';
// Bring in our own styles from style.css (full-window map, dark background)
import './style.css';
// Bring in our address lookup function from geocode.js (the "./" means "in this same folder")
import { geocode } from './geocode.js';

// The web address pattern for Esri's satellite image tiles.
// {z} = zoom level, {y} = tile row, {x} = tile column. Note: Esri puts y before x.
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// The point the map starts centered on: between Ontario and Fontana, California.
// IMPORTANT: MapLibre wants [longitude, latitude], the reverse of how people usually say it.
// Longitude is negative here because the place is west of Greenwich, England (0°).
const START_CENTER = [-117.55, 34.07];

// How far in the map starts. 0 shows the whole world; each step up doubles the detail.
// 12 shows roughly a 20 km wide area on a laptop screen.
const START_ZOOM = 12;

// Create the map and keep a reference to it in a variable called "map"
const map = new MapLibreMap({
  container: 'map', // Draw the map inside the HTML element whose id is "map"
  center: START_CENTER, // Start at the point defined above
  zoom: START_ZOOM, // Start at the zoom level defined above
  style: { // The "style" describes what the map shows: its data sources and how to draw them
    version: 8, // The version of MapLibre's style format; 8 is the current one
    sources: { // A list of places the map can get data from
      satellite: { // Our one source, which we name "satellite"
        type: 'raster', // Raster = ready-made images (pixels), not shapes like roads or outlines
        tiles: [SATELLITE_TILES], // Where to download the image tiles from
        tileSize: 256, // Each tile is a 256 × 256 pixel square
        maxzoom: 19, // Esri has no sharper tiles past zoom 19; beyond that MapLibre enlarges zoom-19 tiles
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', // Credit line the imagery licence requires
      }, // End of the satellite source
    }, // End of the sources list
    layers: [ // The layers to draw, from bottom to top (just one for now)
      {
        id: 'satellite-layer', // A unique name for this layer
        type: 'raster', // Draw it as an image layer
        source: 'satellite', // Take the images from the "satellite" source above
      }, // End of the satellite layer
    ], // End of the layers list
  }, // End of the style
}); // End of creating the map

// Add the zoom-in, zoom-out, and compass buttons to the top-right corner of the map
map.addControl(new NavigationControl(), 'top-right');

// ---------- Address search ----------

// How far to zoom in on a found address. 15 shows roughly a 1.5 km wide area, close to our 1 km radius.
const SEARCH_ZOOM = 15;

// Find the parts of the page we need, using the ids we gave them in index.html
const form = document.getElementById('search'); // The whole search form
const input = document.getElementById('address'); // The text box
const button = form.querySelector('button'); // The "Show changes" button inside the form
const message = document.getElementById('search-message'); // The message area under the form

// Show a short message under the search box
function showMessage(text) {
  message.textContent = text; // Put the text into the message area
  message.hidden = false; // Make the message area visible
} // End of showMessage

// Hide the message area again
function hideMessage() {
  message.hidden = true; // Make the message area invisible
} // End of hideMessage

// ---------- Moving the map behind a cover ----------

const cover = document.getElementById('cover'); // The dark "Loading imagery…" cover from index.html
const FADE_MS = 300; // How long the cover takes to fade in, in milliseconds (1000 ms = 1 second); must match style.css
const MAX_WAIT_MS = 8000; // The longest we wait for imagery before revealing the map anyway (8 seconds)

// Wait a number of milliseconds. Returns a "Promise": a ticket for something that finishes later,
// which "await" can wait for.
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // setTimeout calls "resolve" (finishes the Promise) after ms milliseconds
} // End of wait

// Wait until all imagery on screen has loaded, or until MAX_WAIT_MS has passed, whichever comes first
function waitForTiles() {
  return new Promise((resolve) => { // Create a Promise that we finish ourselves by calling "resolve"
    const timer = setTimeout(resolve, MAX_WAIT_MS); // Safety net: give up waiting after 8 seconds (e.g. on a slow connection)
    map.once('idle', () => { // "idle" = MapLibre has finished loading and drawing everything; "once" listens just one time
      clearTimeout(timer); // Tiles are ready, so cancel the safety-net timer
      resolve(); // Finish the Promise: we're done waiting
    }); // End of the idle listener
  }); // End of the Promise
} // End of waitForTiles

// Move the map to a new place without showing half-loaded imagery
async function moveMapTo(lng, lat) {
  cover.classList.add('visible'); // Start fading the dark cover in (the fade itself is done by style.css)
  await wait(FADE_MS); // Wait until the cover has fully faded in
  map.jumpTo({ center: [lng, lat], zoom: SEARCH_ZOOM }); // Jump straight to the place, no animation; [longitude, latitude] order!
  await waitForTiles(); // Wait while the imagery for the new place downloads
  cover.classList.remove('visible'); // Fade the cover away to reveal the finished map
} // End of moveMapTo

// Run this code every time the form is submitted (button clicked or Enter pressed)
form.addEventListener('submit', async (event) => {
  event.preventDefault(); // Stop the browser's default behaviour of reloading the page
  const address = input.value.trim(); // Read what the user typed, with extra spaces removed from both ends

  // If the box is empty, ask the user to type something and stop here
  if (address === '') {
    showMessage('Type an address first.'); // Tell the user what's wrong
    return; // Leave the function early
  } // End of the empty-box check

  hideMessage(); // Clear any old message from a previous search
  button.disabled = true; // Grey out the button so the user can't send a second search too quickly
  button.textContent = 'Searching…'; // Change the button text to show that something is happening

  // "try" runs code that might fail (e.g. no internet); if it does, we jump to "catch"
  try {
    const place = await geocode(address); // Ask Nominatim for the address and wait for the answer

    // If nothing was found, explain and stop
    if (place === null) {
      showMessage("Couldn't find that address. Try adding a city or country."); // Helpful hint for the user
      return; // Leave early (the "finally" part below still runs)
    } // End of the not-found check

    // Smoothly fly the map to the found place. Remember: [longitude, latitude] order!
    await moveMapTo(place.lng, place.lat); // Fade out, jump to the place, wait for imagery, fade back in
  } catch (error) {
    console.error(error); // Print the technical details in the browser's developer console, for us
    showMessage('The address search is not responding. Please try again in a moment.'); // Friendly message for the user
  } finally {
    // "finally" always runs at the end, whether the search worked, found nothing, or failed
    button.disabled = false; // Make the button clickable again
    button.textContent = 'Show changes'; // Put the normal button text back
  } // End of try/catch/finally
}); // End of the submit handler
