// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, and how long a turn takes, from globe.js
import { startGlobe, TURN_MS } from './globe.js';
// Bring in the functions for the loading steps and progress bar, from loading.js
import { resetSteps, startStep, finishStep, failStep } from './loading.js';
// Bring in the function that asks our backend for the land-cover change, from api.js
import { fetchAnalysis, fetchPhotoDate, fetchWayback } from './api.js';
// Bring in the function that fills in the result panel, from results.js
import { showResults, showImageryDate, showImageryWarning, hideImageryWarning, setUpColourSwitches, shownChanges, resetColourSwitches } from './results.js';
// Bring in the list of hotspot places, from places.js
import { PLACES, BUTTON_ORDER } from './places.js';
// Bring in the address lookup and its reverse (coordinates → town name), from geocode.js
import { geocode, reverseGeocode } from './geocode.js';
// Bring in the function that shows a place on the satellite map, from map.js
import { showPlace, showChange, swapChange, setBaseImagery, showSwipe, playOpening, glideToMiddle, resetSwipe, setShownChanges, getAnalyseSpot, setAnalysing, onOfferSettled, showFindingTag, hideFindingTag, endFindingTag } from './map.js';
// Bring in the function that builds the 2017 picture for the before/after swipe, from swipe.js
import { buildBeforeImage, tagText } from './swipe.js';
// Bring in the long view (Landsat photos since 1985), from longview.js
import { openLongView, closeLongView } from './longview.js';

// ---------- Globe ----------

// Start the globe on its canvas, with its teaser box. When a hotspot is clicked, run selectPlace.
// startGlobe hands back an object with a turnTo function, which we keep in "globe".
const globe = startGlobe(
  document.getElementById('globe'), // The canvas to draw on
  document.getElementById('teaser'), // The hover teaser box
  document.getElementById('pin-card'), // The card beside a tapped spot
  (place) => selectPlace(place), // What to do when a hotspot is clicked
  (lonLat) => fillPinCard(lonLat), // What to do when the pin moves or goes away (see "The pin card" below)
  document.getElementById('water-note'), // The "That's water. Tap the land." note shown beside an ocean tap
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

// Write a place into the address bar, without reloading the page. With "addStep", pushState adds a step to the browser's
// history (so its Back button returns to the landing page); otherwise replaceState swaps the current address (no new step).
function setUrlPlace(place, addStep = false) {
  const params = new URLSearchParams({ lat: place.lat.toFixed(5), lon: place.lon.toFixed(5) }); // Build "lat=...&lon=..." safely (spaces and commas get encoded)
  if (place.name) params.set('name', place.name); // Add "&name=..." only if the place has a name (null means "no town here")
  if (addStep) history.pushState(null, '', `?${params}`); // A new history step: Back now leads to the landing page's address
  else history.replaceState(null, '', `?${params}`); // Just change the address (e.g. "Analyze this area", or opening a shared link)
} // End of setUrlPlace

// True while the result's address sits on a history step we added ourselves (chosen from the landing page). Then
// "← New place" goes back through the browser's history, so no extra landing steps pile up.
let addedHistoryStep = false;

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
  for (const sectionId of ['panel-landing', 'panel-locating', 'panel-result', 'panel-longview']) { // Go through all panel sections
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
// The longest the swipe's earlier photo may take, counted from when the place is chosen. Nothing waits for it (the result is
// shown first); a new place usually takes 10-15 s, but on slow days Esri's archive needs up to about 65 s (the backend asks
// each archive version twice, 30 s each), so wait 2 minutes. If it's slower still, the map says "EARLIER IMAGERY TOOK TOO LONG".
const IMAGERY_LIMIT_MS = 120000;

// Which state the app is in: 'landing' (choosing a place), 'locating' (zooming in and loading),
// 'result' (map shown), 'failed' (the map couldn't load; only "← Back to globe" works), 'returning' (going back to the globe),
// or 'longview' (the Landsat photos since 1985 cover the map)
let mode = 'landing';

// The result now on screen, for the long view: { place, corners } ("corners" are the analysis square's, or null without one)
let currentResult = null;

// A ticket number for the place being loaded. Choosing a place takes a new ticket; going back (or cancelling) takes one too.
// Loading a place is a chain of waits; after each wait the chain checks its ticket, and if a newer one exists it was
// cancelled, so it stops quietly instead of carrying on for a place the visitor has already left.
let placeTicket = 0;

const stage = document.querySelector('.stage'); // The picture area holding the globe and the map
const mapContainer = document.getElementById('map'); // The element MapLibre draws in

// ---------- The analysis: shared by choosing a place (from the globe) and by "Analyse this area" ----------


// Send the requests for a place at once, so they run side by side: the land-cover change (a few seconds), when Esri's
// current imagery was taken (quick), and the sharp archive imagery (instant for places seen before, up to a minute otherwise).
// Nothing is shown yet: showFinishedResult uses the answers once they're all here, so the result appears in one go.
// Hands back what is still to come: { changeReady, swipe, photoDate }.
function startRequests(place) {
  let currentDate = null; // When Esri's current imagery was taken, once its answer is in (stays null if it fails or times out)
  const photoDateReady = fetchPhotoDate(place.lat, place.lon) // Ask Esri (gives up after 3 s, see api.js)...
    .catch(() => null) // ...a failure counts as "no date"...
    .then((date) => { currentDate = date; return date; }); // ...and remember the answer, so it can be read at any moment below
  const photoDate = { ready: photoDateReady, now: () => currentDate }; // Both ways to get it: wait for it ("ready"), or take what's there right now ("now")
  // The archive answer, only for the earlier ("before", e.g. 2017) photo: the "after" photo is always Esri's current imagery,
  // the newest photo Esri has (it must be from the last land-cover year or later, and the archive only holds older versions)
  const archiveReady = fetchWayback(place.lat, place.lon).catch(() => null); // { before, ... }, or null if it fails

  // The land-cover analysis: one answer with the main result and every year slider stop. The main result ("change") is the
  // last comparison; it also carries the whole list ("steps"), so the slider can be filled straight away.
  const changeReady = fetchAnalysis(place.lat, place.lon) // Ask the backend...
    .then((analysis) => ({ ...analysis.changes.at(-1), steps: analysis.changes })) // ...take the main result, with every comparison attached ("at(-1)" = the last)
    .catch((error) => { // ...and if the request fails:
      console.error(error); // print the details in the developer console (F12)
      return null; // and carry on with "no change data"
    }); // End of changeReady

  // The swipe's earlier photo starts loading as soon as the archive answer and the square are known, while the globe is
  // still turning, so for places seen before it's usually ready by the reveal and the opening sweep can play
  let archiveIn = false; // Becomes true once the archive answer has arrived
  archiveReady.then(() => { archiveIn = true; }); // Note its arrival
  const swipe = { ...startSwipe(changeReady, archiveReady, photoDate), archiveIn: () => archiveIn }; // The earlier photo ("ready", a Promise), "did the time run out?" ("timedOut"), and "is the archive answer in yet?" ("..." copies ready and timedOut in)

  return { changeReady, swipe, photoDate }; // The answers still to come (Promises), and the photo date ({ ready, now })
} // End of startRequests

// Get the swipe's earlier photo ready: wait for the archive answer, then load its tiles and cut them to the square. Races
// one deadline (IMAGERY_LIMIT_MS) and never stops anything else. Hands back { ready, timedOut }: "ready" is a Promise with
// { before, tags }, or null when there's no earlier photo, it fails, or the time runs out; "timedOut()" says whether the time
// ran out (so the map can say why no swipe came). Started by startRequests, so it runs while the globe turns.
function startSwipe(changeReady, archiveReady, photoDate) {
  let timedOut = false; // Becomes true when the time is up
  const deadline = wait(IMAGERY_LIMIT_MS).then(() => { timedOut = true; return null; }); // Finishes with null when the time is up, and notes it
  const swipeReady = Promise.all([changeReady, archiveReady]) // When the land-cover result (for the square's corners) and the archive answer are in...
    .then(([change, archive]) => prepareSwipe(change, archive, photoDate)) // ...load the earlier photo's tiles (null if there's no square or no photo)
    .then((swipe) => (swipe && swipe.apartYears >= MIN_SWIPE_YEARS ? swipe : null)) // ...and only keep it if the two photos are far enough apart
    .catch(() => null); // A failure (e.g. tiles that won't load) means no swipe, never an error
  return { ready: Promise.race([swipeReady, deadline]), timedOut: () => timedOut }; // Whichever comes first, and a way to ask whether the time ran out
} // End of startSwipe

// The swipe is only shown when its two photos are at least this many years apart: comparing e.g. April 2016 with December 2017
// (where Esri has nothing newer) shows nothing useful
const MIN_SWIPE_YEARS = 2;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000; // One year in milliseconds (subtracting two dates gives milliseconds)

// How long the reveal may wait for the earlier photo's tiles when the archive answer is already in (places seen before):
// about a second usually, and worth it, because then the opening sweep (earlier year -> latest) can play.
const SWIPE_GRACE_MS = 1500;

// Show a finished analysis as soon as the colours and the map's photo are ready: draw the change on the map (turning it
// grid-up), fill in the result panel and the year slider. The photo is always Esri's current imagery, so it never changes
// afterwards. The before/after swipe joins when its earlier photo is ready: at once if it's ready (the caller then plays the
// opening sequence), or later, with a "Finding earlier imagery…" tag on the map meanwhile and a glide to the middle when it
// arrives. "change" is the backend's answer (or null), "holdMs" a short pause before the reveal (the globe uses it so people
// see the loading steps completed). Hands back the swipe if it's ready for the opening, otherwise null.
async function showFinishedResult(place, change, swipeJob, photoDate, cancelled, holdMs) {
  setBaseImagery(null); // Esri's current imagery: the "after" photo (and never an earlier place's archive imagery)
  const swipeReady = swipeJob.ready; // The earlier photo, loading since the answers came in (see startRequests)
  // The disclaimer: where Esri's newest photo is older than the last land-cover year (e.g. from 2017, while the colours run
  // to 2024), the panel says so, because the photo may not show the changes the colours mark. It's the most recent sharp
  // imagery there is (blurry 10 m Sentinel-2 photos were tried instead and rejected: the colours made no sense on them).
  hideImageryWarning(); // A new result: no warning until we know the photo is too old
  const warnIfOld = (date) => { // Show the warning if this photo date is older than the last land-cover year
    if (date && change && date < `${change.years.to}-01-01`) showImageryWarning(date, change.years.from, change.years.to); // ("YYYY-MM-DD" dates sort correctly as text)
  }; // End of warnIfOld
  showImageryDate(photoDate.now()); // The imagery line: the current photo's date if it's in already (otherwise its dateless wording)...
  warnIfOld(photoDate.now()); // ...and the warning, if that date is too old
  photoDate.ready.then((date) => { // When the date comes in (or right away, if it's in):
    if (!date || cancelled()) return; // No date, or the visitor has left: nothing to do (nothing ever waits for this)
    showImageryDate(date); // Fill in the imagery line...
    warnIfOld(date); // ...and add the warning if needed (only text in the panel changes, never the photo)
  }); // End of the late date
  await showChange(change); // Draw the change layer, turn the map grid-up, and wait for its imagery; with no data, just clear the old drawing
  if (cancelled()) return null; // Went back while the change layer was drawn: stop before showing anything
  await wait(holdMs); // A short pause, if the caller wants one
  if (cancelled()) return null; // Went back during that pause

  // The swipe: ready now (or nearly, for places seen before) -> with the opening; otherwise it joins later
  const swipe = swipeJob.archiveIn() ? await Promise.race([swipeReady, wait(SWIPE_GRACE_MS).then(() => null)]) : null; // Ready in time?
  if (cancelled()) return null; // Went back while we waited
  if (swipe) showSwipe(swipe.before, change.image.corners, swipe.tags, 1); // Ready: handle at the right edge (all earlier photo), for the opening
  else if (change) { // Not ready yet (and there is a square):
    showFindingTag(change.image.corners); // "FINDING EARLIER IMAGERY…" in the square's corner, so the wait is visible
    swipeReady.then((late) => { // When the earlier photo is ready (or isn't coming):
      if (cancelled()) return; // The visitor left or chose another place: that place's map is gone, nothing to do
      if (!late) { // No earlier photo: say why for a few seconds, instead of the label just vanishing (the result stays as it is)
        const timedOut = swipeJob.timedOut(); // Did the time run out (Esri's archive was too slow), or is there no photo old enough?
        endFindingTag(timedOut ? 'EARLIER IMAGERY TOOK TOO LONG' : 'NO EARLIER IMAGERY HERE'); // The label's last words, then it fades away
        announce(timedOut ? 'Earlier imagery took too long to find.' : 'No earlier imagery for this square.'); // The same for screen-reader users
        return; // Nothing more to do
      } // End of the "no earlier photo" case
      hideFindingTag(); // The earlier photo is here: the search is over
      showSwipe(late.before, change.image.corners, late.tags); // Add the swipe with the handle at the left edge (the colours stay)...
      glideToMiddle(); // ...and glide gently to the middle, for the comparison
      announce('Earlier imagery added: drag the handle on the map to compare.'); // Tell screen-reader users (no year: the photo's real date is on its tag)
    }); // End of the late swipe
  } // End of the swipe check
  currentResult = { place, corners: change ? change.image.corners : null }; // Remember the place and its square, for the long view
  showResults(place, change, formatCoords(place.lon, place.lat)); // The reveal sentence, stats, and notes (or a "not available" message if change is null)
  setUpTimeline(place, change, formatCoords(place.lon, place.lat)); // The year slider, ready at once (every year came with the analysis)
  return swipe; // The swipe, so the caller can play the opening (or null: none yet)
} // End of showFinishedResult

let longViewOnArrival = false; // True when the page was opened from a shared long-view link, until that place's result is in

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
  const openLongNow = longViewOnArrival; // Was this place opened from a shared long-view link? (Only the first place after loading the page can be)
  longViewOnArrival = false; // Used up: a later place, or this one chosen again, opens normally
  const fromLanding = !placeFromUrl(); // No place in the address yet: chosen on the landing page (not a shared link, a reload, or Forward)
  setUrlPlace(place, fromLanding); // Put the place in the address bar right away, so a reload during loading also comes back here; from the landing page as a new history step
  if (fromLanding) addedHistoryStep = true; // Remember it, for "← New place"

  // Fill in and show the "locating" panel
  document.getElementById('locating-name').textContent = placeTitle(place); // The place name (or its coordinates if it has none)
  document.getElementById('locating-coords').textContent = placeSubtitle(place); // Its coordinates (or nothing, if they're already the title)
  resetSteps(); // Empty the progress bar and un-tick the steps (in case of an earlier visit)
  document.getElementById('step-map').textContent = 'Loading detailed map'; // Reset the text too, in case it showed an error before
  document.getElementById('step-compare').textContent = 'Comparing land cover'; // Same for the compare step
  showPanel('panel-locating'); // Swap the landing panel for the locating panel

  setBaseImagery(null); // Back to Esri's current imagery first: a previous place's archive imagery must never show here, under the wrong date
  resetColourSwitches(); // A new place starts with all four colours on...
  setShownChanges(shownChanges()); // ...and the map follows (all four)

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

  // Send the requests (the change, the imagery date, the archive imagery) right away, so they run while the globe turns
  const { changeReady, swipe, photoDate } = startRequests(place); // The answers still to come (see startRequests)

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
    if (change) { // Got it:
      finishStep('compare'); // Tick off step 3 (the last one: the earlier photo for the swipe no longer holds up the result)
    } else { // No answer: say so honestly, but carry on with the map
      failStep('compare', "Change data isn't available for this place right now"); // Step 3 failed
    } // End of the answer check
    return change; // Hand the answer on (or null)
  }); // End of the map-ready handler

  // Show the callout at the place (which is now in the middle of the globe area)
  document.getElementById('callout-kicker').textContent = calloutLabel(place); // e.g. "SITE · FARMLAND → WAREHOUSES" or "SITE · YOUR LOCATION"
  document.getElementById('callout-name').textContent = placeTitle(place); // The place name (or its coordinates)
  document.getElementById('callout-coords').textContent = placeSubtitle(place); // The coordinates (or nothing)
  document.getElementById('callout').classList.add('visible'); // Fade the callout in

  // Wait for three things at the same time: the map, the change steps, and the callout's minimum reading time
  const [mapLoaded, change] = await Promise.all([mapReady, changeDone, wait(MIN_CALLOUT_MS)]); // Promise.all waits until all are done; we keep the first two results
  if (cancelled()) return; // The visitor went back while we waited: stop here
  if (!mapLoaded) { // The map couldn't load (e.g. no WebGL, or the connection dropped):
    failStep('map', "The detailed map couldn't load in this browser."); // Mark the step as failed (dash, grey, no pulsing "…") with the reason
    mode = 'failed'; // We're stuck on this place, but not busy any more
    document.getElementById('locating-back').focus(); // Move keyboard focus to "← Back to globe", the way out, so keyboard and screen-reader users find it at once
    return; // Stop here; the button takes it from there
  } // End of the failure check
  const early = await showFinishedResult(place, change, swipe, photoDate, cancelled, HOLD_MS); // Draw the change, fill in the panel; the swipe comes now or joins later
  if (cancelled()) return; // Went back meanwhile: stop before the crossfade

  // Stage 2: crossfade from the globe to the map, and switch the panel at the same time
  document.getElementById('callout').classList.remove('visible'); // Fade the callout out
  stage.classList.add('show-map'); // Fade the globe out and the map in (the fading is done by style.css)
  showPanel('panel-result'); // Swap the locating panel for the result panel
  mode = 'result'; // From now on "← New place" works, even while the crossfade is still running
  document.getElementById('result-name').focus({ preventScroll: true }); // Move keyboard focus to the result sentence: screen readers read it out, and the next Tab goes on to the year slider (without scrolling the panel)
  await wait(CROSSFADE_MS); // Wait until the crossfade has finished
  if (mode === 'result') globe.setVisible(false); // Still showing the map? Then stop drawing the hidden globe, to save battery (skip if the user already went back)
  if (openLongNow && mode === 'result' && !cancelled()) { openLong(); return; } // A shared long-view link: open the long view over the result (no opening sweep under it)
  if (early && !cancelled()) playOpening(); // The opening: sweep from 2017 to 2023, show the colours, then glide to the middle
} // End of selectPlace

// ---------- "Analyse this area": analyse the dashed square's spot, without going back to the globe ----------

const resultPanel = document.getElementById('panel-result'); // The result panel (dimmed while busy)
const areaSteps = document.getElementById('area-steps'); // The steps in the middle of the dashed square
const areaStatus = document.getElementById('area-status'); // The invisible line screen readers read out

// Mark one of the dashed square's steps: state is 'running', 'done', 'failed', or null (not started). The classes are the
// loading panel's (style.css .steps), so the steps look the same: grey, a pulsing "…", a green ✓, or a dash.
function setAreaStep(step, state) {
  const item = areaSteps.querySelector(`[data-step="${step}"]`); // The step's list item, e.g. <li data-step="find">
  item.classList.remove('running', 'done', 'failed'); // Clear its old state...
  if (state) item.classList.add(state); // ...and set the new one (if any)
} // End of setAreaStep

// Tell screen-reader users how the analysis is going: they hear each new text in the invisible status line
function announce(text) {
  areaStatus.textContent = text; // "aria-live" on the line makes screen readers read it out when it changes
} // End of announce

// Dim the old result while a new area is analysed (busy = true), or bring it back (false)
// While busy, every part of the panel except "← New place" (so people can still cancel) is "inert": it can't be clicked,
// tapped, reached with Tab, or changed with the keyboard, and screen readers skip it. (Dimming alone only looks asleep.)
function setResultBusy(busy) {
  resultPanel.classList.toggle('is-busy', busy); // The dimmed look (style.css)
  resultPanel.setAttribute('aria-busy', String(busy)); // Tells screen readers this part is being updated
  for (const part of resultPanel.children) { // Each part of the panel (the year slider, the stats rows, the notes...)
    if (!part.classList.contains('panel-actions')) part.inert = busy; // ...except the top row ("← New place" and Share): asleep while busy, awake again after
  } // End of the parts loop
} // End of setResultBusy

// Run the analysis for the 2 x 2 km square at the dashed square's spot. The old result stays, dimmed, until the new one is ready;
// then everything switches at once. Uses the same two steps as choosing a place (startRequests, showFinishedResult).
async function analyseArea() {
  if (mode !== 'result') return; // Only from a finished result (this also ignores presses while an analysis runs)
  mode = 'analysing'; // Now we're busy
  placeTicket += 1; // A new ticket: "← New place" can still cancel this, like a place loading from the globe
  const myTicket = placeTicket; // ...which this run remembers
  const cancelled = () => myTicket !== placeTicket; // True once a newer ticket exists (the visitor left)

  const center = getAnalyseSpot(); // The spot to analyse: the dashed square's centre (dragged there, or the map's centre)
  const place = { name: null, lon: Number(center.lon.toFixed(5)), lat: Number(center.lat.toFixed(5)), source: 'area' }; // Rounded to about 1 m, like places in the address
  setAnalysing([place.lon, place.lat]); // The dashed square stays on this spot, and the button says "Analysing…"
  setResultBusy(true); // Dim the old result
  for (const step of ['compare', 'imagery']) setAreaStep(step, null); // The square's steps: none started yet (an earlier run may have ticked them)
  areaSteps.hidden = false; // Show the steps in the dashed square
  setAreaStep('compare', 'running'); // The comparison starts at once
  announce('Analyzing this area: comparing land cover.'); // Say so to screen-reader users

  const nameReady = reverseGeocode(place.lat, place.lon).catch(() => null); // Ask which town this is (e.g. "Fontana"); null if unknown or it fails
  const { changeReady, swipe, photoDate } = startRequests(place); // The same requests as for a chosen place
  const [change, name] = await Promise.all([changeReady, nameReady]); // Wait for the change and the name
  if (cancelled()) return; // The visitor left meanwhile ("← New place" cleans up)

  if (!change) { // The analysis failed:
    areaSteps.hidden = true; // Hide the steps (the button says what happened)
    announce("Couldn't analyze this area. The previous result is back."); // Say so to screen-reader users
    setResultBusy(false); // Bring the old result back...
    setAnalysing(null, "Couldn't analyze · Try again"); // ...and let the button say so (pressing it tries again)
    mode = 'result'; // Ready again
    return; // Stop here
  } // End of the failure case

  place.name = name; // The town's name, or null (then the result shows the coordinates)
  resetColourSwitches(); // A new area starts with all four colours on...
  setShownChanges(shownChanges()); // ...and the map follows
  setUrlPlace(place); // The new spot in the address bar, so a reload or a shared link opens it
  setAreaStep('compare', 'done'); // Tick off the comparison
  setAreaStep('imagery', 'running'); // Now the map's photo at the new spot loads (the earlier photo for the swipe no longer holds anything up)
  announce('Land cover compared. Loading imagery.'); // Say so to screen-reader users
  const early = await showFinishedResult(place, change, swipe, photoDate, cancelled, 0); // Draw the change, fill in the panel (no pause needed here); the swipe comes now or joins later
  if (cancelled()) return; // The visitor left meanwhile
  areaSteps.hidden = true; // The steps are done
  announce('Result ready.'); // Say it's done (the sentence itself is read out when focus moves to it, below)
  setAnalysing(null); // The analysis is over: the new square is solid, so the dashed one and the button go
  setResultBusy(false); // The new result, at full strength
  mode = 'result'; // Ready for the next pan
  document.getElementById('result-name').focus({ preventScroll: true }); // Keyboard focus to the new result sentence (the button it was on has gone): screen readers read it out; no scrolling
  if (early) playOpening(); // The opening: sweep from 2017 to 2023, show the colours, then glide to the middle
} // End of analyseArea

document.getElementById('analyse-area').addEventListener('click', analyseArea); // The button on the map

// The head start: once "Analyse this area" has been offered for a moment, quietly ask for that spot's archive imagery.
// The answer is thrown away here: the backend saves it (or, if it's still looking when the button is pressed, the real
// request waits for this same lookup), so after the press the before/after swipe arrives sooner. Nothing on screen changes.
onOfferSettled((center) => { // When the offer has settled (map.js), with the dashed square's spot:
  if (mode !== 'result') return; // Only while a finished result is shown (not while analysing or on the globe)
  fetchWayback(Number(center.lat.toFixed(5)), Number(center.lon.toFixed(5))) // Rounded like analyseArea rounds it, so it's the same spot
    .catch(() => {}); // A failure doesn't matter here: the real request after the press tries again
}); // End of the head start

// ---------- Year slider: compare the first year with any later year ----------

const timeline = document.getElementById('timeline'); // The whole slider block
const timelineLabel = document.getElementById('timeline-label'); // e.g. "Land cover since 2017"
const timelineYear = document.getElementById('timeline-year'); // The chosen end year, large
const timelineRange = document.getElementById('timeline-range'); // The slider itself
const timelineTicks = document.getElementById('timeline-ticks'); // The tick marks and year labels under it
// Prepare the before/after swipe from the archive answer: load the earlier (e.g. 2017) photo's tiles and cut them to the square.
// The right-hand side is the map's own photo, Esri's current imagery, so only its date is needed ("photoDate").
// Gives { before, tags } when it's ready, or null when there can be no swipe (no square, or a photo without a date).
async function prepareSwipe(change, archive, photoDate) {
  if (!change || !archive?.before) return null; // No square, or no earlier photo: no swipe
  const before = await buildBeforeImage(archive.before.tiles, change.image.corners); // Load its tiles and cut them to the square
  const afterDate = await photoDate.ready; // The current imagery's date (in by now, or within 3 s; null if it didn't come)
  const tags = { // The two year tags:
    before: tagText(archive.before.date), // e.g. "2017 · 21 OCT" (an archive photo always has its date)
    after: afterDate ? tagText(afterDate) : 'LATEST', // The current imagery, e.g. "2024 · 12 FEB", or "LATEST" when its date didn't come
  }; // End of the tags
  return { before, tags, apartYears: afterDate ? (new Date(afterDate) - new Date(archive.before.date)) / YEAR_MS : Infinity }; // Ready, with how far apart the two photos are (unknown "after" date: assume far enough)
} // End of prepareSwipe

let shown = null; // What the result panel shows: { place, coordsText, changes: { year: answer } }, or null

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
function setUpTimeline(place, change, coordsText) {
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

  // Every comparison came with the analysis ("steps"), so the slider is ready at once: no second request, no waiting
  const changes = {}; // year -> that comparison's answer, e.g. changes[2020] = 2017 -> 2020
  for (const step of change.steps) changes[step.years.to] = step; // Fill it in
  shown = { place, coordsText, changes }; // Everything needed to show any year
  timelineLabel.textContent = `Land cover since ${from}`; // e.g. "Land cover since 2017": says that only the colors follow the slider, not the photos
  timelineRange.disabled = false; // Ready to use
} // End of setUpTimeline

// Show one end year: the map's colours, the sentence, the stats and the notes all switch to "first -> year" at once
function showYear(year) {
  if (!shown || !shown.changes[year]) return; // Not loaded (or no such year): nothing to show
  setSliderYear(year); // The big year, the ink, and the screen-reader text
  swapChange(shown.changes[year]); // The map's change colours
  showResults(shown.place, shown.changes[year], shown.coordsText); // The sentence, the stats, and the small print
} // End of showYear

timelineRange.addEventListener('input', () => { resetSwipe(); showYear(Number(timelineRange.value)); }); // Handle back to the left edge first, so the changing colours can be seen; then the year // "input" fires on every step while dragging (and on arrow keys), so the result follows the handle live

// ---------- The long view: Landsat photos since 1985 ----------
// "See how it turned since 1985 →" covers the map with the long view and swaps the result panel for its own. Opening it
// adds a step to the browser's history ("&view=long" in the address), so the Back button closes it again, like
// "← Back to map" and the Escape key. The map underneath is never touched, so closing it returns exactly to where it was.

let addedLongViewStep = false; // True while the long view's address is a history step we added (then closing goes back through it)

// Open the long view for the result on screen. "fromHistory" is true when the browser's Forward button opened it.
function openLong(fromHistory = false) {
  if (mode !== 'result' || !currentResult) return; // Only from a finished result
  mode = 'longview'; // Now the long view is open
  if (!fromHistory) { // Opened with the link: add a history step, so Back closes it
    const params = new URLSearchParams(location.search); // The place in the address (lat, lon, name)
    params.set('view', 'long'); // ...plus "view=long"
    history.pushState(null, '', `?${params}`); // A new step in the browser's history
    addedLongViewStep = true; // Remember it, for closing
  } // End of the history step
  const { place, corners } = currentResult; // The place and its analysis square
  openLongView(place, corners, formatCoords(place.lon, place.lat)); // Show the photos on the stage (longview.js)
  document.querySelector('.map-layer').inert = true; // The covered map can't be clicked, tabbed to or read out meanwhile
  showPanel('panel-longview'); // Swap the result panel for the long view's
  document.querySelector('.panel').scrollTop = 0; // Start at the top of the panel
  document.getElementById('longview-title').focus({ preventScroll: true }); // Keyboard focus to its heading: screen readers announce it
} // End of openLong

// Close the long view and bring the result back. "fromHistory" is true when the browser's Back button closed it.
function closeLong(fromHistory = false) {
  if (mode !== 'longview') return; // Not open
  if (!fromHistory && addedLongViewStep) { // Closed with the button or Escape, and we added a history step:
    history.back(); // Step back through the history instead; its popstate event comes back here with fromHistory = true
    return; // So nothing more to do now
  } // End of the history check
  addedLongViewStep = false; // The step is used up
  closeLongView(); // Stop playing and uncover the map (longview.js)
  document.querySelector('.map-layer').inert = false; // The map works again
  showPanel('panel-result'); // The result panel again
  mode = 'result'; // Back to the result
  document.getElementById('longview-open').focus({ preventScroll: true }); // Keyboard focus back on the link that opened it
} // End of closeLong

document.getElementById('longview-open').addEventListener('click', () => openLong()); // The link under the result sentence ("() =>" so the click event isn't passed in as fromHistory)
document.getElementById('longview-back').addEventListener('click', () => closeLong()); // "← Back to map"
document.addEventListener('keydown', (event) => { // Any key pressed anywhere on the page:
  if (event.key === 'Escape' && mode === 'longview') closeLong(); // Escape closes the long view
}); // End of the key listener

// ---------- Sharing ----------
// The address bar always holds what's on screen (the place, and "view=long" in the long view), so sharing means sharing
// that address. When a messaging app or social site opens it, the server answers with a preview card for that place
// (backend/app/share.py), so the shared link shows the place instead of a plain link.

const SHARED_MS = 2000; // How long the button says "Link copied" before saying "Share" again

// Share the current address: phones get their own share sheet (Messages, WhatsApp...); computers copy the link
async function shareLink(button) {
  const url = location.href; // The address now on screen
  const touch = window.matchMedia('(pointer: coarse)').matches; // A finger-operated device (a phone or tablet)?
  if (touch && navigator.share) { // Phones: the system's share sheet
    try { // Open it...
      await navigator.share({ title: document.title, url }); // ...with the page's title and the address
    } catch { // ...the person closed it without sharing (or sharing failed):
      // nothing to do
    } // End of the share sheet
    return; // Done
  } // End of the phone case
  let words = 'Link copied'; // What the button will say...
  try { // Copy the address to the clipboard
    await navigator.clipboard.writeText(url); // (the browser only allows this on secure, https pages, which the site is)
  } catch { // Copying isn't allowed here:
    words = "Couldn't copy"; // ...say so instead
  } // End of the copy
  button.textContent = words; // Show what happened on the button itself
  announce(`${words}.`); // ...and tell screen-reader users
  setTimeout(() => { button.textContent = 'Share'; }, SHARED_MS); // Back to "Share" after a moment
} // End of shareLink

for (const id of ['share-result', 'share-longview']) { // The two Share buttons (result and long view)
  const button = document.getElementById(id); // The button
  button.addEventListener('click', () => shareLink(button)); // Share when pressed
} // End of the Share buttons

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
// "fromHistory" is true when the browser's Back button started it (see the popstate listener below).
async function returnToGlobe(fromHistory = false) {
  if (!['result', 'failed', 'locating', 'analysing', 'longview'].includes(mode)) return; // Only from a result, a failed load, while loading, while analysing an area, or from the long view (the Back button pressed twice quickly)
  closeLongView(); // Close the long view if it's open (nothing happens if it isn't)
  document.querySelector('.map-layer').inert = false; // ...and wake the map it covered
  addedLongViewStep = false; // Its history step, if any, is behind us now
  if (!fromHistory && addedHistoryStep) { // A button was pressed, and we added a history step for this place:
    history.back(); // Step back through the browser's history instead; its popstate event comes back here with fromHistory = true
    return; // So nothing more to do now
  } // End of the history check
  addedHistoryStep = false; // The step is used up (or there was none)
  mode = 'returning'; // We're busy going back: ignore place clicks until we're done
  placeTicket += 1; // A new ticket: if a place is still loading (or an area being analysed), its chain sees this and stops (that's the cancel)
  setAnalysing(null); // End any "Analysing…" state on the map
  areaSteps.hidden = true; // ...hide its steps
  announce(''); // ...clear the screen-reader line
  setResultBusy(false); // ...and undim the result panel, ready for next time
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

document.getElementById('back').addEventListener('click', () => returnToGlobe()); // "← New place" on the result panel ("() =>" so the click event isn't passed in as fromHistory)
document.getElementById('locating-back').addEventListener('click', () => returnToGlobe()); // "← Back to globe" on the locating panel, after a failed map load

// The browser's Back and Forward buttons: the address has already changed when "popstate" fires, so follow it.
window.addEventListener('popstate', () => { // Back or Forward was pressed (or history.back() was called above)
  const place = placeFromUrl(); // The place in the address now, or null for the landing page
  const longView = new URLSearchParams(location.search).get('view') === 'long'; // Does the address ask for the long view?
  if (!place) returnToGlobe(true); // No place: back to the globe (does nothing if we're already there)
  else if (mode === 'landing') selectPlace(place); // A place again (Forward): open it, as if chosen (the address is already right, so no new step)
  else if (mode === 'longview' && !longView) closeLong(true); // Back from the long view: close it
  else if (mode === 'result' && longView) openLong(true); // Forward into the long view again: open it
}); // End of the Back/Forward listener

// ---------- Place buttons ----------

const placesArea = document.getElementById('places'); // The empty area for the buttons

// Where a place sits in BUTTON_ORDER (0 = first); places not on that list get a number past the end, so they go last
const buttonPosition = (place) => { // A small helper that takes one place and returns its position
  const index = BUTTON_ORDER.indexOf(place.id); // Look the place's id up in the order list (-1 means "not found")
  return index === -1 ? BUTTON_ORDER.length : index; // Not found -> after everything else; found -> its spot in the list
}; // End of the helper
const orderedPlaces = [...PLACES].sort((a, b) => buttonPosition(a) - buttonPosition(b)); // A sorted copy of the places (the original list stays as it is)

for (const place of orderedPlaces) { // Make one button for each place, in the chosen order
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
    const messages = { // A friendly message for each reason geocode.js gives
      busy: 'Search is busy right now. Try again in a moment.', // Too many searches this very moment
      'daily-limit': 'Address search is resting for today. Try a place below, or tap the globe.', // Today's free allowance is used up (place buttons and the globe still work)
    }; // End of the messages
    showMessage(messages[error.reason] ?? 'The address search is not responding. Please try again in a moment.'); // The matching message, or the general one ("??" = use the right side if the left is missing)
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
        name = await reverseGeocode(lat, lon); // Ask which town this is, e.g. "Fontana" (the button still says "Locating…" meanwhile)
      } catch { // The lookup failed (no internet, search busy or resting for today):
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
longViewOnArrival = Boolean(startPlace) && new URLSearchParams(location.search).get('view') === 'long'; // A shared long-view link ("&view=long")? Then open it once the result is in
if (startPlace) selectPlace(startPlace); // Then go straight to it: the globe turns there and the result loads, as if it had been chosen

// ---------- Colour switches (the stats rows) ----------

setUpColourSwitches(setShownChanges); // Each press tells the map which colours to show (setShownChanges gets e.g. ['built', 'gained'])
