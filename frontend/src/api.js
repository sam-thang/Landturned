// Talking to our own backend (the FastAPI server in backend/).
// Addresses start with /api, which the Vite proxy forwards to the backend (see vite.config.js).

// Ask the backend how the land changed in the 2 × 2 km square around a point: the whole analysis in one answer.
// Returns a Promise with { years: { from, to, available }, changes, location }: "changes" holds one comparison per later
// year (first year -> that year), oldest first, each with its years, stats in hectares, and change picture with corners.
// The last one is the main result; the others are the year slider's stops. "export" lets main.js use it.
export async function fetchAnalysis(lat, lon) {
  const params = new URLSearchParams({ lat, lon }); // Build the "?lat=...&lon=..." part safely
  const response = await fetch(`/api/analysis?${params}`); // Send the request and wait for the reply (instant for squares analysed before)
  if (!response.ok) { // Not a success (e.g. 404 "no data here", or 502 because the backend isn't running)?
    throw new Error(`Analysis request failed: ${response.status}`); // Stop with an error, including the status number for the console
  } // End of the error check
  return response.json(); // Read the reply as JSON and hand it back
} // End of fetchAnalysis

// Ask the backend for sharp "before" and "after" imagery from Esri's archive (Wayback): the archive photos taken closest to
// the first and the last land-cover year. Returns a Promise with { years, before, after }; each photo is
// { date, source, resolution_m, tiles } or null. The first answer for a neighbourhood can take up to a minute, then it's instant.
export async function fetchWayback(lat, lon) {
  const params = new URLSearchParams({ lat, lon }); // No years: the backend looks them up (the app doesn't know them yet when it asks)
  const response = await fetch(`/api/wayback?${params}`); // Send the request and wait for the reply
  if (!response.ok) { // Not a success?
    throw new Error(`Archive imagery request failed: ${response.status}`); // Stop with an error, including the status number for the console
  } // End of the error check
  return response.json(); // Read the reply as JSON and hand it back
} // End of fetchWayback

// Esri's metadata service: for any point it says which piece of photo World Imagery shows there, and when it was taken.
const ESRI_IDENTIFY = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify';
// The longest we wait for Esri's photo date, in milliseconds. It usually answers in under a second; when it doesn't,
// the app goes on without the date rather than waiting.
const PHOTO_DATE_TIMEOUT_MS = 3000;

// Ask Esri when the map's photo at a point was taken. Returns a Promise with the date as "YYYY-MM-DD", or null if unknown.
// World Imagery is a patchwork of photos from different dates, so the date differs from place to place.
export async function fetchPhotoDate(lat, lon) {
  const d = 0.005; // Half the size of the little box around the point that the service needs, in degrees (about 500 m)
  const params = new URLSearchParams({ // The question, in the service's own terms:
    geometry: `${lon},${lat}`, // The point (longitude first)
    geometryType: 'esriGeometryPoint', // It's a single point
    sr: '4326', // In longitude/latitude
    layers: 'all:0', // Layer 0, "World Imagery": the photo actually drawn at street level
    tolerance: '0', // Exactly at the point
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`, // A small map box around it (the service needs one)
    imageDisplay: '400,400,96', // ...and a pretend screen size for that box
    returnGeometry: 'false', // We don't need the photo's outline
    f: 'json', // Answer in JSON
  }); // End of the question
  let response; // Esri's reply (filled in below)
  try { // Esri's service sometimes hangs for 25 s or more, so give up after PHOTO_DATE_TIMEOUT_MS:
    response = await fetch(`${ESRI_IDENTIFY}?${params}`, { signal: AbortSignal.timeout(PHOTO_DATE_TIMEOUT_MS) }); // Send it straight to Esri (it allows browsers to ask); the "signal" cancels the request when the time is up
  } catch { // Timed out, or no connection:
    return null; // No date (the app carries on without it)
  } // End of the timeout check
  if (!response.ok) return null; // A problem: no date
  const answer = await response.json(); // Read the reply
  const raw = answer.results?.[0]?.attributes?.['DATE (YYYYMMDD)']; // e.g. "20260523" ("?." stops quietly if a part is missing)
  if (!/^\d{8}$/.test(raw ?? '')) return null; // Not eight digits: no usable date
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`; // "2026-05-23"
} // End of fetchPhotoDate
