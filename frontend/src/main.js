// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, and how long a turn takes, from globe.js
import { startGlobe, TURN_MS } from './globe.js';
// Bring in the functions for the loading steps and progress bar, from loading.js
import { resetSteps, startStep, finishStep, failStep } from './loading.js';
// Bring in the function that asks our backend for the land-cover change, from api.js
import { fetchChange, fetchPhotoDate, fetchTimeline } from './api.js';
// Bring in the function that fills in the result panel, from results.js
import { showResults } from './results.js';
// Bring in the list of hotspot places, from places.js
import { PLACES } from './places.js';
// Bring in the address lookup and its reverse (coordinates → town name), from geocode.js
import { geocode, reverseGeocode } from './geocode.js';
// Bring in the function that shows a place on the satellite map, from map.js
import { showPlace, showChange, swapChange } from './map.js';

// ---------- Globe ----------

// Start the globe on its canvas, with its teaser box. When a hotspot is clicked, run selectPlace.
// startGlobe hands back an object with a turnTo function, which we keep in "globe".
const globe = startGlobe(
  document.getElementById('globe'), // The canvas to draw on
  document.getElementById('teaser'), // The hover teaser box
  document.getElementById('pin-card'), // The card beside a tapped spot
  (place) => selectPlace(place), // What to do when a hotspot is clicked
  (lonLat) => fillPinCard(lonLat), // What to do when the pin moves or goes away (see "The pin card" below)
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
  const params = new URLSearchParams({ lat: place.lat.toFixed(5), lon: place.lon.toFixed(5) }); // Build "lat=...&lon=..." safely (spaces and commas get encoded)
  if (place.name) params.set('name', place.name); // Add "&name=..." only if the place has a name (null means "no town here")
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
  return { name: params.get('name') || null, lon, lat }; // The place; without a name in the address, its name is null ("no town here")
} // End of placeFromUrl

// Show one panel section (by its id) and hide the others
function showPanel(id) {
  for (const sectionId of ['panel-landing', 'panel-locating', 'panel-result']) { // Go through all panel sections
    document.getElementById(sectionId).hidden = sectionId !== id; // Hide every section except the chosen one
  } // End of the sections loop
} // End of showPanel

// ---------- Choosing a place ----------

// The callout's small top label for each way of choosing a place ("source"). Hotspots use their teaser instead.
const SOURCE_LABELS = {
  search: 'SITE · SEARCHED ADDRESS', // Typed into the search box
  location: 'SITE · YOUR LOCATION', // From the "My location" button
  pin: 'SITE · POINT ON THE GLOBE', // Tapped on the globe, then "Show change"
}; // End of the source labels

// The callout's top label for a place
function calloutLabel(place) {
  if (place.teaser) return `SITE · ${place.teaser.toUpperCase()}`; // A hotspot: its story in capitals, e.g. "SITE · FARMLAND → WAREHOUSES"
  return SOURCE_LABELS[place.source] ?? 'SITE'; // Otherwise how it was chosen; a place reopened from a link has no source, so just "SITE"
} // End of calloutLabel

// The title for a place in the panel and the callout: its name, or for a place without one (a tapped spot) its coordinates
function placeTitle(place) {
  return place.name ?? formatCoords(place.lon, place.lat); // "??" means "if the left side is null, use the right side"
} // End of placeTitle

// The small coordinates line under that title: empty when the title already is the coordinates, so they don't show twice
function placeSubtitle(place) {
  return place.name ? formatCoords(place.lon, place.lat) : ''; // A named place gets its coordinates; an unnamed one gets nothing
} // End of placeSubtitle

// How far the globe zooms in when a place is chosen: 3.4 times the whole-globe view, roughly a country-sized region
const REGIONAL_ZOOM = 3.4;

// The shortest time the callout stays on screen before the crossfade, so people can read it (1.2 seconds)
const MIN_CALLOUT_MS = 1200;
// How long the crossfade from globe to map takes; must match the 0.9 s transitions in style.css
const CROSSFADE_MS = 900;
// A short pause after the last step finishes, so people see everything completed before the crossfade
const HOLD_MS = 500;

// Which state the app is in: 'landing' (choosing a place), 'locating' (zooming in and loading),
// 'result' (map shown), 'failed' (the map couldn't load; only "← Back to globe" works), or 'returning' (going back to the globe)
let mode = 'landing';

// A ticket number for the place being loaded. Choosing a place takes a new ticket; going back (or cancelling) takes one too.
// Loading a place is a chain of waits; after each wait the chain checks its ticket, and if a newer one exists it was
// cancelled, so it stops quietly instead of carrying on for a place the visitor has already left.
let placeTicket = 0;

const stage = document.querySelector('.stage'); // The picture area holding the globe and the map
const mapContainer = document.getElementById('map'); // The element MapLibre draws in

// What happens when a place is chosen (button, hotspot, or search).
// "place" has a name, lon, and lat, and sometimes a teaser.
async function selectPlace(place) {
  if (mode !== 'landing') return; // Already busy with a place: ignore extra clicks
  mode = 'locating'; // Now we're busy
  placeTicket += 1; // A new ticket for this place...
  const myTicket = placeTicket; // ...which this run remembers
  const cancelled = () => myTicket !== placeTicket; // A small helper: true once a newer ticket exists (the visitor went back)
  globe.clearPin(); // Remove any pin and its card, so they don't sit on top of the callout
  hideMessage(); // Clear any old message
  setUrlPlace(place); // Put the place in the address bar right away, so a reload during loading also comes back here

  // Fill in and show the "locating" panel
  document.getElementById('locating-name').textContent = placeTitle(place); // The place name (or its coordinates if it has none)
  document.getElementById('locating-coords').textContent = placeSubtitle(place); // Its coordinates (or nothing, if they're already the title)
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
  // And ask Esri when the map's photo here was taken (a quick answer), for the small print. A failure becomes null: no date shown.
  const photoDateReady = fetchPhotoDate(place.lat, place.lon).catch(() => null); // e.g. "2026-05-23", or null

  const changeReady = fetchChange(place.lat, place.lon).catch((error) => { // If the request fails...
    console.error(error); // ...print the details in the developer console (F12)
    return null; // ...and carry on with "no change data"
  }); // End of changeReady

  // Stage 1: lock the globe, then turn and zoom to a regional view
  globe.setInteractive(false); // No dragging or clicking while we zoom
  startStep('locate', TURN_MS); // The locate step is running; we know it takes TURN_MS, so the bar's first share fills in step with the turn
  await globe.turnTo(place.lon, place.lat, REGIONAL_ZOOM); // Wait until the globe has finished turning and zooming
  if (cancelled()) return; // The visitor went back during the turn: stop here
  finishStep('locate'); // Tick off step 1

  // Now show the map step. It has been loading in the background all along;
  // if it's already finished, it ticks off right away, otherwise as soon as it's really ready.
  // After that, the compare step (the backend has been working all along too).
  startStep('map'); // The map step is running; its duration is unknown, so the bar waits until it finishes
  const changeDone = mapReady.then(async (loaded) => { // When the map is ready (or right away, if it already is)...
    if (!loaded || cancelled()) return null; // ...unless it failed or was cancelled: then stop here (a failure is handled below)
    finishStep('map'); // ...tick off step 2
    startStep('compare'); // Show step 3 as running
    const change = await changeReady; // Wait for the backend's answer (or null if it failed)
    if (cancelled()) return null; // Cancelled while waiting: don't touch the steps (they may belong to a newer place by now)
    if (change) finishStep('compare'); // Got it: tick off step 3
    else failStep('compare', "Change data isn't available for this place right now"); // No answer: say so honestly, but carry on with the map
    return change; // Hand the answer on (or null)
  }); // End of the map-ready handler

  // Show the callout at the place (which is now in the middle of the globe area)
  document.getElementById('callout-kicker').textContent = calloutLabel(place); // e.g. "SITE · FARMLAND → WAREHOUSES" or "SITE · YOUR LOCATION"
  document.getElementById('callout-name').textContent = placeTitle(place); // The place name (or its coordinates)
  document.getElementById('callout-coords').textContent = placeSubtitle(place); // The coordinates (or nothing)
  document.getElementById('callout').classList.add('visible'); // Fade the callout in

  // Wait for three things at the same time: the map, the change steps, and the callout's minimum reading time
  const [mapLoaded, change, , photoDate] = await Promise.all([mapReady, changeDone, wait(MIN_CALLOUT_MS), photoDateReady]); // Promise.all waits until all are done; we keep the map, the change, and the photo date (the empty slot skips the wait's result)
  if (cancelled()) return; // The visitor went back while we waited: stop here
  if (!mapLoaded) { // The map couldn't load (e.g. no WebGL, or the connection dropped):
    failStep('map', "The detailed map couldn't load in this browser."); // Mark the step as failed (dash, grey, no pulsing "…") with the reason
    mode = 'failed'; // We're stuck on this place, but not busy any more
    document.getElementById('locating-back').focus(); // Move keyboard focus to "← Back to globe", the way out, so keyboard and screen-reader users find it at once
    return; // Stop here; the button takes it from there
  } // End of the failure check
  await showChange(change); // Draw the change layer, turn the (still hidden) map grid-up, and wait for any new imagery; with no data, just clear the old drawing
  if (cancelled()) return; // Went back while the change layer was drawn: stop before showing anything
  await wait(HOLD_MS); // Everything is done: pause briefly so people see all steps completed
  if (cancelled()) return; // Went back during that short pause: stop before the crossfade

  // Fill in the result panel
  showResults(place, change, formatCoords(place.lon, place.lat), photoDate); // The reveal sentence, stats, and notes (or a "not available" message if change is null)
  setUpTimeline(place, change, formatCoords(place.lon, place.lat), photoDate, myTicket); // The year slider: its years at once, greyed out until the timeline has loaded in the background

  // Stage 2: crossfade from the globe to the map, and switch the panel at the same time
  document.getElementById('callout').classList.remove('visible'); // Fade the callout out
  stage.classList.add('show-map'); // Fade the globe out and the map in (the fading is done by style.css)
  showPanel('panel-result'); // Swap the locating panel for the result panel
  mode = 'result'; // From now on "← New place" works, even while the crossfade is still running
  document.getElementById('back').focus(); // Move keyboard focus to "← New place", so keyboard users land somewhere useful
  await wait(CROSSFADE_MS); // Wait until the crossfade has finished
  if (mode === 'result') globe.setVisible(false); // Still showing the map? Then stop drawing the hidden globe, to save battery (skip if the user already went back)
} // End of selectPlace

// ---------- Year slider: compare the first year with any later year ----------

const timeline = document.getElementById('timeline'); // The whole slider block
const timelineLabel = document.getElementById('timeline-label'); // "Loading years…", then "Since 2017"
const timelineYear = document.getElementById('timeline-year'); // The chosen end year, large
const timelineRange = document.getElementById('timeline-range'); // The slider itself
const timelineTicks = document.getElementById('timeline-ticks'); // The tick marks and year labels under it
let shown = null; // What the result panel shows: { place, coordsText, photoDate, changes: { year: answer } }, or null

// Put the handle at a year and update everything that belongs to the slider itself: the big year, the ink part of the
// track, and what screen readers say. (The map and the text are updated separately, in showYear.)
function setSliderYear(year) {
  const min = Number(timelineRange.min); // The first end year on the slider, e.g. 2018
  const max = Number(timelineRange.max); // The last, e.g. 2023
  timelineRange.value = year; // Move the handle
  timelineYear.textContent = year; // The big year
  timelineRange.style.setProperty('--filled', `${max > min ? ((year - min) / (max - min)) * 100 : 100}%`); // How much of the track is ink (all of it if there's only one end year)
  timelineRange.setAttribute('aria-valuetext', `${timelineRange.dataset.from} to ${year}`); // Screen readers say "2017 to 2020" instead of just "2020"
} // End of setSliderYear

// Prepare the slider for a new result. "change" is the first answer (first -> latest year), or null (then no slider).
// The ticks are built at once from the years the answer lists; the slider stays greyed out until the timeline has loaded.
function setUpTimeline(place, change, coordsText, photoDate, ticket) {
  shown = null; // Forget the previous place's timeline
  timeline.hidden = !change; // No change data: no slider
  if (!change) return; // Nothing more to do

  const { from, available } = change.years; // The start year and every year there is, e.g. 2017 and [2017, ..., 2023]
  const ends = available.filter((year) => year > from); // The possible end years: every year after the start
  timelineRange.min = ends[0]; // The slider's first stop, e.g. 2018
  timelineRange.max = ends.at(-1); // ...and its last, e.g. 2023 ("at(-1)" = the last item)
  timelineRange.dataset.from = from; // Remember the start year for what screen readers say ("dataset" stores it on the element)
  timelineTicks.replaceChildren(...ends.map((year) => { // One tick and label per end year:
    const tick = document.createElement('span'); // A new element
    tick.textContent = year; // Its label
    return tick; // Hand it to replaceChildren
  })); // End of the ticks
  setSliderYear(change.years.to); // The handle starts at the year shown (the latest)
  timelineRange.disabled = true; // Greyed out...
  timelineLabel.textContent = 'Loading years…'; // ...and say why

  fetchTimeline(place.lat, place.lon).then((answer) => { // In the background (about 5 seconds):
    if (ticket !== placeTicket) return; // The visitor went back or chose another place meanwhile: ignore this late answer
    const changes = {}; // year -> that comparison's answer, e.g. changes[2020] = 2017 -> 2020
    for (const step of answer.changes) changes[step.years.to] = step; // Fill it in
    shown = { place, coordsText, photoDate, changes }; // Everything needed to show any year
    timelineLabel.textContent = `Since ${from}`; // e.g. "Since 2017"
    timelineRange.disabled = false; // Ready to use
  }).catch((error) => { // The timeline couldn't load:
    console.error(error); // Details for the developer console (F12)
    if (ticket === placeTicket) timeline.hidden = true; // Hide the slider; the result itself is unaffected
  }); // End of the timeline request
} // End of setUpTimeline

// Show one end year: the map's colours, the sentence, the stats and the notes all switch to "first -> year" at once
function showYear(year) {
  if (!shown || !shown.changes[year]) return; // Not loaded (or no such year): nothing to show
  setSliderYear(year); // The big year, the ink, and the screen-reader text
  swapChange(shown.changes[year]); // The map's change colours
  showResults(shown.place, shown.changes[year], shown.coordsText, shown.photoDate); // The sentence, the stats, and the small print
} // End of showYear

timelineRange.addEventListener('input', () => showYear(Number(timelineRange.value))); // "input" fires on every step while dragging (and on arrow keys), so the result follows the handle live

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

// Go back from a place to the landing globe. Used by "← New place" (after a result) and by "← Back to globe"
// (while loading, to cancel, or after the map failed to load), so all of them take the same path.
async function returnToGlobe() {
  if (mode !== 'result' && mode !== 'failed' && mode !== 'locating') return; // Only from a result, a failed load, or while loading ("&&" = and)
  mode = 'returning'; // We're busy going back: ignore place clicks until we're done
  placeTicket += 1; // A new ticket: if a place is still loading, its chain sees this and stops (that's the cancel)
  document.getElementById('callout').classList.remove('visible'); // Fade out the callout (still up while loading or after a failed load; already gone after a result)
  clearUrlPlace(); // Back to the plain address, so a reload now opens the landing page
  showPanel('panel-landing'); // Show the landing panel again (headline, search, place buttons)
  document.querySelector('.panel').scrollTop = 0; // Scroll the panel back to the top, so the landing page starts at the headline
  document.getElementById('landing-title').focus({ preventScroll: true }); // Move focus to the headline: screen readers announce it, Tab reaches the search box next, and phones don't pop up the keyboard (which focusing the search box would)
  globe.setVisible(true); // Start drawing the globe again (it's still zoomed in on the place)
  stage.classList.remove('show-map'); // Fade the map out and the globe in
  // Fade and zoom out at the same time (Promise.all waits until both are done), instead of one after the other:
  // the globe pulls back while it fades in, which is quicker and looks like one continuous move
  await Promise.all([wait(CROSSFADE_MS), globe.reset()]); // The crossfade, and zooming out to the whole globe (which also unlocks it)
  mode = 'landing'; // Ready for a new place
} // End of returnToGlobe

document.getElementById('back').addEventListener('click', returnToGlobe); // "← New place" on the result panel
document.getElementById('locating-back').addEventListener('click', returnToGlobe); // "← Back to globe" on the locating panel, after a failed map load

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
const searchButton = form.querySelector('button[type="submit"]'); // The arrow button (its label for screen readers is "Show change"); "[type=submit]" picks it, not the locate button

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
    selectPlace({ name: address, lon: result.lng, lat: result.lat, source: 'search' }); // Found it: choose it, named as the user typed it ("source" sets the callout label)
  } catch (error) { // If something went wrong:
    console.error(error); // Print the details in the developer console (F12), for us
    showMessage('The address search is not responding. Please try again in a moment.'); // Friendly message
  } finally { // Always runs at the end:
    searchButton.disabled = false; // Make the button clickable again
    searchButton.setAttribute('aria-label', 'Show change'); // Put the normal label back
  } // End of try/catch/finally
}); // End of the submit handler

// ---------- Locate me ----------

const locateButton = document.getElementById('locate'); // The crosshair button in the search box
// Round located coordinates to 3 decimals (about 100 m). The place goes into the web address, and 5 decimals
// would pinpoint someone to about 1 m, so a shared link could reveal their home. 100 m changes nothing for a 2 km square.
const LOCATE_DECIMALS = 3;

if (!('geolocation' in navigator)) locateButton.hidden = true; // Browsers that can't locate at all: hide the button instead of offering something that can't work

const locateLabel = locateButton.querySelector('span'); // The button's visible text ("My location")

// Stop showing "busy" on the locate button
function resetLocateButton() {
  locateButton.disabled = false; // Clickable again
  locateLabel.textContent = 'My location'; // The normal text back
} // End of resetLocateButton

// When "My location" is clicked: ask the browser where we are, then analyse that spot
locateButton.addEventListener('click', () => {
  if (mode !== 'landing') return; // Busy with a place already: ignore
  hideMessage(); // Clear any old message
  locateButton.disabled = true; // Can't be clicked twice; the crosshair pulses (see style.css)
  locateLabel.textContent = 'Locating…'; // Show (and tell screen readers) that something is happening
  navigator.geolocation.getCurrentPosition( // Ask the browser for the position (the first time, it asks the person for permission)
    async (position) => { // Success: we got a position ("async" so we can wait for the town name below)
      const lat = Number(position.coords.latitude.toFixed(LOCATE_DECIMALS)); // Latitude, rounded to about 100 m (toFixed gives text, Number turns it back into a number)
      const lon = Number(position.coords.longitude.toFixed(LOCATE_DECIMALS)); // Longitude, rounded the same way
      let name = null; // The town name; stays null if there's no town here or the lookup fails
      try { // Try the lookup; if anything goes wrong, jump to "catch" instead of crashing
        name = await reverseGeocode(lat, lon); // Ask Nominatim which town this is, e.g. "Fontana" (the button still says "Locating…" meanwhile)
      } catch { // The lookup failed (no internet, Nominatim busy):
        name = null; // Carry on without a name; the analysis matters more than the label
      } // End of the try/catch
      resetLocateButton(); // Back to normal
      selectPlace({ name, lat, lon, source: 'location' }); // Analyse it, just like a searched address
    }, // End of the success handler
    (error) => { // Failure: no position
      resetLocateButton(); // Back to normal
      if (error.code === error.PERMISSION_DENIED) { // The person (or a browser setting) said no:
        showMessage('Location access is turned off. Allow it in your browser or device settings, or type an address.'); // Explain how to fix it (on iPhone the block is often in the phone's own Location Services settings, not the browser's)
      } else { // Anything else (no signal, took too long):
        showMessage("Couldn't find your location. Try again, or type an address."); // A friendly fallback
      } // End of the error check
    }, // End of the failure handler
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }, // Options: a rough position is plenty (faster, saves battery), give up after 10 s, a position up to 1 minute old is fine
  ); // End of the position request
}); // End of the locate handler

// ---------- The pin card (the card beside a tapped spot on the globe) ----------

const pinCoords = document.getElementById('pin-coords'); // The card's coordinates line
let pinSpot = null; // The pin's spot as [lon, lat], kept for the "Show change" button; null when there's no pin

// Fill in the card for a new pin spot ([lon, lat]), or forget the spot when the pin is cleared (null).
// The globe moves and shows/hides the card itself; this only sets its text.
// No name lookup here: at globe zoom a tap is tens of kilometres rough, so coordinates are the honest label.
function fillPinCard(lonLat) {
  pinSpot = lonLat; // Remember the spot (or null)
  if (!lonLat) return; // The pin was cleared: the globe hides the card, nothing to fill in
  const [lon, lat] = lonLat; // Take the longitude and latitude out of the pair
  pinCoords.textContent = formatCoords(lon, lat); // e.g. "39.1787° N, 84.7333° W"
} // End of fillPinCard

// When "Show change" on the card is pressed: analyse the pinned spot, like any other place
document.getElementById('pin-go').addEventListener('click', () => {
  if (!pinSpot) return; // No pin (shouldn't happen, the card is hidden then): ignore
  const [lon, lat] = pinSpot; // Take the longitude and latitude out of the pair
  selectPlace({ name: null, lon, lat, source: 'pin' }); // No name: the panel and callout show the coordinates, the sentence says "this area"
}); // End of the button handler

// ---------- Opening a place from the address ----------

const startPlace = placeFromUrl(); // Is there a place in the address (after a reload, or from a shared link)?
if (startPlace) selectPlace(startPlace); // Then go straight to it: the globe turns there and the result loads, as if it had been chosen
