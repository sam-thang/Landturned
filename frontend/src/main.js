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

// ---------- Choosing a place ----------

// What happens when a place is chosen (button or hotspot). For now: turn the globe to face it.
function selectPlace(place) {
  hideMessage(); // Clear any old message
  globe.turnTo(place.lon, place.lat); // Turn the globe to the place
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
    globe.turnTo(result.lng, result.lat); // Found it: turn the globe to face it
  } catch (error) { // If something went wrong:
    console.error(error); // Print the details in the developer console (F12), for us
    showMessage('The address search is not responding. Please try again in a moment.'); // Friendly message
  } finally { // Always runs at the end:
    searchButton.disabled = false; // Make the button clickable again
    searchButton.textContent = 'Show change'; // Put the normal text back
  } // End of try/catch/finally
}); // End of the submit handler
