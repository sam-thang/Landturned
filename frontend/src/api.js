// Talking to our own backend (the FastAPI server in backend/).
// Addresses start with /api, which the Vite proxy forwards to the backend (see vite.config.js).

// Ask the backend how the land changed in the 2 × 2 km square around a point.
// Returns a Promise with the backend's answer: years, stats in hectares, and the change picture with its corners.
// "export" lets main.js use it.
export async function fetchChange(lat, lon) {
  const params = new URLSearchParams({ lat, lon }); // Build the "?lat=...&lon=..." part safely
  const response = await fetch(`/api/change?${params}`); // Send the request and wait for the reply
  if (!response.ok) { // Not a success (e.g. 404 "no data here", or 502 because the backend isn't running)?
    throw new Error(`Change request failed: ${response.status}`); // Stop with an error, including the status number for the console
  } // End of the error check
  return response.json(); // Read the reply as JSON and hand it back
} // End of fetchChange

// Ask the backend for the Sentinel-2 photo of the area (6 × 6 km around the point) in the latest land-cover year.
// Returns a Promise with the answer: the picture, its corners, the date it was taken, and its credit line.
export async function fetchPhoto(lat, lon) {
  const params = new URLSearchParams({ lat, lon }); // Build the "?lat=...&lon=..." part; no year, so the backend uses the latest one
  const response = await fetch(`/api/imagery?${params}`); // Send the request and wait for the reply
  if (!response.ok) { // Not a success (e.g. 404 "no image", or the backend isn't running)?
    throw new Error(`Photo request failed: ${response.status}`); // Stop with an error, including the status number for the console
  } // End of the error check
  return response.json(); // Read the reply as JSON and hand it back
} // End of fetchPhoto
