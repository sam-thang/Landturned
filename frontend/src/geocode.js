// The web address of OpenStreetMap's free geocoding service, Nominatim
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Look up an address and return its location, or null if nothing was found.
// "export" lets other files (like main.js) use this function.
// "async" means the function can wait for the internet without freezing the page.
export async function geocode(address) {
  // Start building the full request address from the base web address
  const url = new URL(NOMINATIM_URL);
  // "q" is the text the user typed; URL safely encodes spaces and letters like ø or é
  url.searchParams.set('q', address);
  // Ask for the answer in JSON, a text format JavaScript can read easily
  url.searchParams.set('format', 'jsonv2');
  // We only want the single best match
  url.searchParams.set('limit', '1');

  // Send the request over the internet and wait ("await") for the reply
  const response = await fetch(url);
  // If the server reports a problem (for example, too many requests), stop with an error
  if (!response.ok) {
    // Create an error that says which status code the server sent (e.g. 429 = too many requests)
    throw new Error(`Geocoding failed with status ${response.status}`);
  } // End of the problem check

  // Turn the reply text into a JavaScript list of results
  const results = await response.json();
  // An empty list means Nominatim found nothing for this address
  if (results.length === 0) {
    // "null" is JavaScript's way of saying "nothing"
    return null;
  } // End of the empty-list check

  // Take the first result, which Nominatim ranks as the best match
  const best = results[0];
  // Hand back only what we need, as an object (a bundle of named values)
  return {
    lng: Number(best.lon), // Longitude (east-west); Nominatim sends numbers as text, so Number() converts them
    lat: Number(best.lat), // Latitude (north-south), also converted from text to a number
    name: best.display_name, // The full place name Nominatim matched, e.g. "Fontana, San Bernardino County, ..."
  }; // End of the returned object
} // End of the geocode function
