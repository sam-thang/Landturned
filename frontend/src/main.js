// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, from globe.js
import { startGlobe } from './globe.js';
// Bring in the list of hotspot places, from places.js
import { PLACES } from './places.js';
// Bring in the address lookup function, from geocode.js
import { geocode } from './geocode.js';

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

// Show one panel section (by its id) and hide the others
function showPanel(id) {
  for (const sectionId of ['panel-landing', 'panel-locating']) { // Go through all panel sections
    document.getElementById(sectionId).hidden = sectionId !== id; // Hide every section except the chosen one
  } // End of the sections loop
} // End of showPanel

// ---------- Choosing a place ----------

// How far the globe zooms in when a place is chosen: 3.4 times the whole-globe view, roughly a country-sized region
const REGIONAL_ZOOM = 3.4;

// Which state the app is in: 'landing' (choosing a place) or 'locating' (zooming in and loading)
let mode = 'landing';

// What happens when a place is chosen (button, hotspot, or search).
// "place" has a name, lon, and lat, and sometimes a teaser.
async function selectPlace(place) {
  if (mode !== 'landing') return; // Already busy with a place: ignore extra clicks
  mode = 'locating'; // Now we're busy
  hideMessage(); // Clear any old message

  // Fill in and show the "locating" panel
  document.getElementById('locating-name').textContent = place.name; // The place name
  document.getElementById('locating-coords').textContent = formatCoords(place.lon, place.lat); // Its coordinates
  document.getElementById('step-locate').classList.remove('done'); // Reset the steps (in case of an earlier visit)
  document.getElementById('step-map').classList.remove('done'); // ...
  showPanel('panel-locating'); // Swap the landing panel for the locating panel

  // Stage 1: lock the globe, then turn and zoom to a regional view
  globe.setInteractive(false); // No dragging or clicking while we zoom
  await globe.turnTo(place.lon, place.lat, REGIONAL_ZOOM); // Wait until the globe has finished turning and zooming
  document.getElementById('step-locate').classList.add('done'); // Tick off step 1

  // Show the callout at the place (which is now in the middle of the globe area)
  document.getElementById('callout-kicker').textContent = place.teaser // If the place has a teaser...
    ? `SITE · ${place.teaser.toUpperCase()}` // ...show it in capitals, e.g. "SITE · FARMLAND → WAREHOUSES"
    : 'SITE · SEARCHED ADDRESS'; // ...otherwise a general label
  document.getElementById('callout-name').textContent = place.name; // The place name
  document.getElementById('callout-coords').textContent = formatCoords(place.lon, place.lat); // The coordinates
  document.getElementById('callout').classList.add('visible'); // Fade the callout in

  // Next step (3b): load the detailed map here, then crossfade to it
} // End of selectPlace

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
const searchButton = form.querySelector('button'); // The "Show change" button

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
  searchButton.textContent = 'Searching…'; // Show that something is happening

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
    searchButton.textContent = 'Show change'; // Put the normal text back
  } // End of try/catch/finally
}); // End of the submit handler
