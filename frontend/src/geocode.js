// Address search and place names. The browser asks our own backend (/api/search and /api/place-name), and the backend
// asks Geoapify (see backend/app/geocoding.py). The backend keeps the Geoapify key secret, remembers every answer for
// all visitors, and keeps the whole site within Geoapify's free plan (5 requests per second, 3,000 per day).

// Our backend's two addresses for this (the dev server passes /api/... on to the backend, see vite.config.js)
const SEARCH_URL = '/api/search'; // Address in, coordinates out
const PLACE_NAME_URL = '/api/place-name'; // Coordinates in, town name out

// Ask our backend and hand back its JSON answer. If search can't be used right now, throw an error whose "reason"
// says why, so the caller can show the right message: "busy" (too many searches this moment), "daily-limit" (today's
// free allowance is used up) or "unavailable" (anything else, e.g. no internet).
async function askBackend(url) {
  let response; // The backend's reply, once it arrives
  try { // Try to reach the backend...
    response = await fetch(url); // Send the request and wait for the reply
  } catch { // ...but the request didn't get through at all (e.g. no internet):
    throw Object.assign(new Error('Search request failed'), { reason: 'unavailable' }); // An error with its reason attached ("Object.assign" adds the reason to the error)
  } // End of the try/catch
  if (!response.ok) { // The backend answered with a problem (503 = search can't be used right now)
    const body = await response.json().catch(() => ({})); // Its explanation, e.g. {"detail": "busy"} (or nothing if it can't be read)
    const reason = ['busy', 'daily-limit'].includes(body.detail) ? body.detail : 'unavailable'; // One of our three reasons
    throw Object.assign(new Error(`Search answered ${response.status}`), { reason }); // An error with that reason
  } // End of the problem check
  return response.json(); // The answer, turned from text into JavaScript values
} // End of askBackend

// Look up an address and return its location, or null if nothing was found.
// "export" lets other files (like main.js) use this function.
// "async" means the function can wait for the internet without freezing the page.
export async function geocode(address) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(address)}`; // The request; encodeURIComponent safely encodes spaces and letters like ø or é
  const answer = await askBackend(url); // Ask and wait, e.g. {found: true, lat: 34.09, lon: -117.43, name: "Fontana, CA, ..."}
  if (!answer.found) return null; // Nothing found: "null" is JavaScript's way of saying "nothing"
  return { lng: answer.lon, lat: answer.lat, name: answer.name }; // Position (longitude, latitude) and the full matched name
} // End of the geocode function

// The opposite lookup ("reverse geocoding"): turn a latitude and longitude into a town name, e.g. "Fontana".
// Returns null when there's no town there (open sea, desert, ice), so the caller can use a fallback wording.
export async function reverseGeocode(lat, lng) {
  const url = `${PLACE_NAME_URL}?lat=${lat}&lon=${lng}`; // The request: the spot to name
  const answer = await askBackend(url); // Ask and wait, e.g. {name: "Fontana"} or {name: null}
  return answer.name; // The town's name, or null (errors pass on to the caller, which then shows coordinates)
} // End of the reverseGeocode function
