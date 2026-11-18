// The web address of OpenStreetMap's free geocoding service, Nominatim
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's reverse service: coordinates in, place name out
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
// How detailed the reverse answer should be: 10 means "city level" (18 would be a single building)
const REVERSE_ZOOM = 10;
// The address fields that count as a town name, from biggest to smallest. Countries label places differently
// (Fontana is a "city", a small place is a "town" or "village", Norway uses "municipality"), so we check them all.
const TOWN_FIELDS = ['city', 'town', 'village', 'municipality'];

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

// The opposite lookup ("reverse geocoding"): turn a latitude and longitude into a town name, e.g. "Fontana".
// Returns null when there's no town there (open sea, desert, ice), so the caller can use a fallback wording.
export async function reverseGeocode(lat, lng) {
  // Start building the full request address from the reverse service's web address
  const url = new URL(NOMINATIM_REVERSE_URL);
  // The latitude (north-south) of the spot we want named
  url.searchParams.set('lat', lat);
  // The longitude (east-west); Nominatim calls it "lon"
  url.searchParams.set('lon', lng);
  // Ask for the answer in JSON, like in geocode above
  url.searchParams.set('format', 'jsonv2');
  // Ask for a city-level answer, not a street address
  url.searchParams.set('zoom', REVERSE_ZOOM);

  // Send the request and wait for the reply
  const response = await fetch(url);
  // If the server reports a problem, stop with an error (the caller decides what to show)
  if (!response.ok) {
    // Say which status code the server sent
    throw new Error(`Reverse geocoding failed with status ${response.status}`);
  } // End of the problem check

  // Turn the reply text into a JavaScript object
  const result = await response.json();
  // Nominatim says "nothing here" with an "error" field (not an error code), e.g. in the middle of the ocean
  if (result.error || !result.address) {
    // No name to give
    return null;
  } // End of the nothing-found check

  // Go through the town fields in order and return the first one this address has
  for (const field of TOWN_FIELDS) {
    // Does the address have this field (e.g. address.city)?
    if (result.address[field]) {
      // Yes: that's our town name
      return result.address[field];
    } // End of the field check
  } // End of the loop over town fields

  // Only bigger areas (a county, a state) were found: too big to describe a 2 × 2 km square, so no name
  return null;
} // End of the reverseGeocode function
