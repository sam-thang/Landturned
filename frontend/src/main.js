// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, and how long a turn takes, from globe.js
import { startGlobe, TURN_MS } from './globe.js';
// Bring in the functions for the loading steps and progress bar, from loading.js
import { resetSteps, startStep, finishStep, failStep } from './loading.js';
// Bring in the function that asks our backend for the land-cover change, from api.js
import { fetchChange } from './api.js';
// Bring in the function that fills in the result panel, from results.js
import { showResults } from './results.js';
// Bring in the list of hotspot places, from places.js
import { PLACES } from './places.js';
// Bring in the address lookup function, from geocode.js
import { geocode } from './geocode.js';
// Bring in the function that shows a place on the satellite map, from map.js
import { showPlace, showChange } from './map.js';

// ---------- Globe ----------

// Start the globe on its canvas, with its teaser box. When a hotspot is clicked, run selectPlace.
// startGlobe hands back an object with a turnTo function, which we keep in "globe".
const globe = startGlobe(
  document.getElementById('globe'), // The canvas to draw on
  document.getElementById('teaser'), // The hover teaser box
  (place) => selectPlace(place), // What to do when a hotspot is clicked
); // End of startGlobe

// ---------- Messages ----------

const message = document.getElementById('search-message'); // The message area under the search box

// Show a short message under the search box
function showMessage(text) {
  message.textContent = text; // Put the text in
  message.hidden = false; // Make it visible
} // End of showMessage

// Hide the message area
function hideMessage() {
  message.hidden = true; // Make it invisible
} // End of hideMessage

// ---------- Helpers ----------

// Turn coordinates into readable text, e.g. "34.0920° N, 117.4350° W"
function formatCoords(lon, lat) {
  const latText = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`; // 4 decimals (about 10 m); N for north of the equator, S for south
  const lonText = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`; // E for east of Greenwich, W for west
  return `${latText}, ${lonText}`; // Latitude first, as people usually say it
} // End of formatCoords

// Wait a number of milliseconds; returns a Promise that "await" can wait for
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // Finish the Promise after ms milliseconds
} // End of wait

// ---------- The place in the web address ----------
// The chosen place is kept in the address, e.g. "/?lat=33.97470&lon=-117.56650&name=Eastvale". So if the page is
// reloaded (phones often do this after the browser was in the background), or the link is shared, the same place opens.

// Write a place into the address bar. replaceState changes the address without reloading the page or adding a "back" step.
function setUrlPlace(place) {
  const params = new URLSearchParams({ lat: place.lat.toFixed(5), lon: place.lon.toFixed(5), name: place.name }); // Build "lat=...&lon=...&name=..." safely (spaces and commas get encoded)
  history.replaceState(null, '', `?${params}`); // Put it in the address bar
} // End of setUrlPlace

// Remove the place from the address bar, back to the plain landing page address
function clearUrlPlace() {
  history.replaceState(null, '', location.pathname); // Just the path (e.g. "/"), without the "?..." part
} // End of clearUrlPlace

// Read a place from the address bar. Returns the place, or null if there is none (or the numbers don't make sense).
function placeFromUrl() {
  const params = new URLSearchParams(location.search); // The "?..." part of the address, split into named values
  if (!params.has('lat') || !params.has('lon')) return null; // No place in the address
  const lat = Number(params.get('lat')); // Turn the text into a number (NaN, "not a number", if it isn't one)
  const lon = Number(params.get('lon')); // Same for the longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null; // Not real coordinates: ignore them
  return { name: params.get('name') || formatCoords(lon, lat), lon, lat }; // The place; without a name, use its coordinates as the name
} // End of placeFromUrl

// Show one panel section (by its id) and hide the others
function showPanel(id) {
  for (const sectionId of ['panel-landing', 'panel-locating', 'panel-result']) { // Go through all panel sections
    document.getElementById(sectionId).hidden = sectionId !== id; // Hide every section except the chosen one
  } // End of the sections loop
} // End of showPanel

// ---------- Choosing a place ----------

// How far the globe zooms in when a place is chosen: 3.4 times the whole-globe view, roughly a country-sized region
const REGIONAL_ZOOM = 3.4;

// The shortest time the callout stays on screen before the crossfade, so people can read it (1.2 seconds)
const MIN_CALLOUT_MS = 1200;
// How long the crossfade from globe to map takes; must match the 0.9 s transitions in style.css
const CROSSFADE_MS = 900;
// A short pause after the last step finishes, so people see everything completed before the crossfade
const HOLD_MS = 500;

// Which state the app is in: 'landing' (choosing a place), 'locating' (zooming in and loading),
// 'result' (map shown), or 'returning' (going back to the globe)
let mode = 'landing';

const stage = document.querySelector('.stage'); // The picture area holding the globe and the map
const mapContainer = document.getElementById('map'); // The element MapLibre draws in

// What happens when a place is chosen (button, hotspot, or search).
// "place" has a name, lon, and lat, and sometimes a teaser.
async function selectPlace(place) {
  if (mode !== 'landing') return; // Already busy with a place: ignore extra clicks
  mode = 'locating'; // Now we're busy
  hideMessage(); // Clear any old message
  setUrlPlace(place); // Put the place in the address bar right away, so a reload during loading also comes back here

  // Fill in and show the "locating" panel
  document.getElementById('locating-name').textContent = place.name; // The place name
  document.getElementById('locating-coords').textContent = formatCoords(place.lon, place.lat); // Its coordinates
  resetSteps(); // Empty the progress bar and un-tick the steps (in case of an earlier visit)
  document.getElementById('step-map').textContent = 'Loading detailed map'; // Reset the text too, in case it showed an error before
  document.getElementById('step-compare').textContent = 'Comparing land cover'; // Same for the compare step
  showPanel('panel-locating'); // Swap the landing panel for the locating panel

  // Start loading the satellite map right away, hidden, so it loads while the globe turns.
  // We don't "await" it yet. ".then" turns the result into true (it worked) or false (it failed),
  // so a failure can't go unnoticed while we're busy with the globe.
  // (The panel only shows the map step after "Locating the site" is done; see below.)
  const mapReady = showPlace(mapContainer, place.lon, place.lat).then(
    () => true, // Loaded fine
    (error) => { // Something went wrong (e.g. no WebGL in this browser):
      console.error(error); // print the details in the developer console (F12)
      return false; // and report failure
    }, // End of the failure handler
  ); // End of mapReady

  // Also ask the backend for the land-cover change right away; it takes a few seconds, so it runs alongside everything else.
  // A failure becomes null (no change data), so the map can still be shown without it.
  const changeReady = fetchChange(place.lat, place.lon).catch((error) => { // If the request fails...
    console.error(error); // ...print the details in the developer console (F12)
    return null; // ...and carry on with "no change data"
  }); // End of changeReady

  // Stage 1: lock the globe, then turn and zoom to a regional view
  globe.setInteractive(false); // No dragging or clicking while we zoom
  startStep('locate', TURN_MS); // The locate step is running; we know it takes TURN_MS, so the bar's first share fills in step with the turn
  await globe.turnTo(place.lon, place.lat, REGIONAL_ZOOM); // Wait until the globe has finished turning and zooming
  finishStep('locate'); // Tick off step 1

  // Now show the map step. It has been loading in the background all along;
  // if it's already finished, it ticks off right away, otherwise as soon as it's really ready.
  // After that, the compare step (the backend has been working all along too).
  startStep('map'); // The map step is running; its duration is unknown, so the bar waits until it finishes
  const changeDone = mapReady.then(async (loaded) => { // When the map is ready (or right away, if it already is)...
    if (!loaded) return null; // ...unless it failed: then stop here (the failure is handled below)
    finishStep('map'); // ...tick off step 2
    startStep('compare'); // Show step 3 as running
    const change = await changeReady; // Wait for the backend's answer (or null if it failed)
    if (change) finishStep('compare'); // Got it: tick off step 3
    else failStep('compare', "Change data isn't available for this place right now"); // No answer: say so honestly, but carry on with the map
    return change; // Hand the answer on (or null)
  }); // End of the map-ready handler

  // Show the callout at the place (which is now in the middle of the globe area)
  document.getElementById('callout-kicker').textContent = place.teaser // If the place has a teaser...
    ? `SITE · ${place.teaser.toUpperCase()}` // ...show it in capitals, e.g. "SITE · FARMLAND → WAREHOUSES"
    : 'SITE · SEARCHED ADDRESS'; // ...otherwise a general label
  document.getElementById('callout-name').textContent = place.name; // The place name
  document.getElementById('callout-coords').textContent = formatCoords(place.lon, place.lat); // The coordinates
  document.getElementById('callout').classList.add('visible'); // Fade the callout in

  // Wait for three things at the same time: the map, the change steps, and the callout's minimum reading time
  const [mapLoaded, change] = await Promise.all([mapReady, changeDone, wait(MIN_CALLOUT_MS)]); // Promise.all waits until all are done; we keep the first two results
  if (!mapLoaded) { // The map couldn't load:
    document.getElementById('step-map').textContent = "The detailed map couldn't load in this browser."; // Say so in the panel
    return; // And stop here, staying on the globe
  } // End of the failure check
  await showChange(change); // Draw the change layer, turn the (still hidden) map grid-up, and wait for any new imagery; with no data, just clear the old drawing
  await wait(HOLD_MS); // Everything is done: pause briefly so people see all steps completed

  // Fill in the result panel
  showResults(place, change, formatCoords(place.lon, place.lat)); // The reveal sentence, stats, and notes (or a "not available" message if change is null)

  // Stage 2: crossfade from the globe to the map, and switch the panel at the same time
  document.getElementById('callout').classList.remove('visible'); // Fade the callout out
  stage.classList.add('show-map'); // Fade the globe out and the map in (the fading is done by style.css)
  showPanel('panel-result'); // Swap the locating panel for the result panel
  mode = 'result'; // From now on "← New place" works, even while the crossfade is still running
  document.getElementById('back').focus(); // Move keyboard focus to "← New place", so keyboard users land somewhere useful
  await wait(CROSSFADE_MS); // Wait until the crossfade has finished
  if (mode === 'result') globe.setVisible(false); // Still showing the map? Then stop drawing the hidden globe, to save battery (skip if the user already went back)
} // End of selectPlace

// ---------- Imagery credit (phones: opened and closed with the ⓘ button) ----------

const credit = document.getElementById('map-credit'); // The credit element
const creditToggle = document.getElementById('credit-toggle'); // The ⓘ button inside it

// When the ⓘ button is tapped, open or close the credit
creditToggle.addEventListener('click', () => {
  const open = credit.classList.toggle('open'); // Switch the "open" class on or off; "toggle" returns true if it's now on
  creditToggle.setAttribute('aria-expanded', String(open)); // Tell screen readers whether it's open
  document.querySelector('.map-layer').classList.toggle('credit-open', open); // Lets CSS lift the north arrow and scale bar above the open strip
}); // End of the credit toggle handler

// ---------- Going back to the globe ----------

// When "← New place" is clicked
document.getElementById('back').addEventListener('click', async () => {
  if (mode !== 'result') return; // Only works once the result is fully shown
  mode = 'returning'; // We're busy going back: ignore place clicks until we're done
  clearUrlPlace(); // Back to the plain address, so a reload now opens the landing page
  showPanel('panel-landing'); // Show the landing panel again (headline, search, place buttons)
  document.querySelector('.panel').scrollTop = 0; // Scroll the panel back to the top, so the landing page starts at the headline
  document.getElementById('landing-title').focus({ preventScroll: true }); // Move focus to the headline: screen readers announce it, Tab reaches the search box next, and phones don't pop up the keyboard (which focusing the search box would)
  globe.setVisible(true); // Start drawing the globe again (it's still zoomed in on the place)
  stage.classList.remove('show-map'); // Fade the map out and the globe in
  await wait(CROSSFADE_MS); // Wait until the crossfade has finished
  await globe.reset(); // Zoom out to the whole globe and unlock it
  mode = 'landing'; // Ready for a new place
}); // End of the back button handler

// ---------- Place buttons ----------

const placesArea = document.getElementById('places'); // The empty area for the buttons

for (const place of PLACES) { // Make one button for each place
  const button = document.createElement('button'); // Create a new button element
  button.type = 'button'; // A plain button (not one that submits a form)
  button.className = 'place-button'; // Give it the styles from style.css
  button.style.setProperty('--dot-color', `var(--${place.type})`); // Set this button's dot color to its change color, e.g. var(--built)

  const dot = document.createElement('span'); // Create the colored dot
  dot.className = 'dot'; // Give it the dot styles
  button.append(dot); // Put the dot inside the button

  const shortName = place.name.split(',')[0]; // Just the part before the first comma, e.g. "Fontana"
  button.append(shortName); // Put the name inside the button, after the dot
  button.title = `${place.name}: ${place.teaser}`; // Full name and teaser shown when hovering the button

  button.addEventListener('click', () => selectPlace(place)); // When clicked, choose this place
  placesArea.append(button); // Add the finished button to the page
} // End of the place buttons loop

// ---------- Address search ----------

const form = document.getElementById('search'); // The search form
const input = document.getElementById('address'); // The text box
const searchButton = form.querySelector('button'); // The arrow button (its label for screen readers is "Show change")

// Run this every time the form is submitted (button clicked or Enter pressed)
form.addEventListener('submit', async (event) => {
  event.preventDefault(); // Stop the browser from reloading the page
  const address = input.value.trim(); // What the user typed, without extra spaces at the ends

  if (address === '') { // Nothing typed?
    showMessage('Type an address first.'); // Tell the user
    return; // And stop here
  } // End of the empty check

  hideMessage(); // Clear any old message
  searchButton.disabled = true; // Grey out the button so it can't be clicked twice
  searchButton.setAttribute('aria-label', 'Searching…'); // Tell screen readers something is happening (the arrow pulses for everyone else, see style.css)

  try { // Code that might fail (e.g. no internet)
    const result = await geocode(address); // Look up the address and wait for the answer
    if (result === null) { // Nothing found?
      showMessage("Couldn't find that address. Try adding a city or country."); // Helpful hint
      return; // Stop here (the "finally" part still runs)
    } // End of the not-found check
    selectPlace({ name: address, lon: result.lng, lat: result.lat }); // Found it: choose it, named as the user typed it
  } catch (error) { // If something went wrong:
    console.error(error); // Print the details in the developer console (F12), for us
    showMessage('The address search is not responding. Please try again in a moment.'); // Friendly message
  } finally { // Always runs at the end:
    searchButton.disabled = false; // Make the button clickable again
    searchButton.setAttribute('aria-label', 'Show change'); // Put the normal label back
  } // End of try/catch/finally
}); // End of the submit handler

// ---------- Opening a place from the address ----------

const startPlace = placeFromUrl(); // Is there a place in the address (after a reload, or from a shared link)?
if (startPlace) selectPlace(startPlace); // Then go straight to it: the globe turns there and the result loads, as if it had been chosen
