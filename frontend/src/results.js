// The result panel: the reveal sentence, the stats rows, and the notes, filled in from the backend's answer.

// Less than this many hectares of colored change in total counts as "little changed"
const LITTLE_CHANGE_HA = 1;

// Turn hectares into text with one decimal, e.g. 17.93 → "17.9"
function formatHa(hectares) {
  return hectares.toFixed(1); // toFixed(1) rounds to one decimal place
} // End of formatHa

// Make a highlighted number for the reveal sentence, e.g. "17.9 hectares" in orange
// (the same color as that change on the map). Built as an element (not as HTML text), so nothing in it can ever run as code.
function highlight(hectares, colorVar) {
  const b = document.createElement('b'); // A new <b> (bold) element
  b.textContent = `${formatHa(hectares)} hectares`; // Its text, e.g. "17.9 hectares"
  b.style.color = `var(${colorVar})`; // Its color, e.g. var(--built) for orange
  return b; // Hand back the finished element
} // End of highlight

// Make the place name for the reveal sentence, underlined like in the mockup.
// The name may be typed by the user, so it only ever goes in as plain text (textContent), never as HTML.
// A place with no town name (null) becomes the plain words "this area", without an underline, since it isn't a name.
function placeName(name) {
  if (!name) return 'this area'; // No name: plain text, e.g. "Between 2017 and 2023, this area turned …"
  const em = document.createElement('em'); // A new <em> element (styled with an underline in style.css)
  em.textContent = name.split(',')[0]; // Just the part before the first comma, e.g. "Eastvale"
  return em; // Hand back the finished element
} // End of placeName

// Build the reveal sentence: it tells the biggest of the four changes.
// Returns a list of pieces (plain text and elements), which heading.replaceChildren(...) puts in order.
function revealPieces(name, change) {
  const s = change.stats_ha; // The stats, in hectares
  const start = `Between ${change.years.from} and ${change.years.to}, `; // e.g. "Between 2017 and 2023, "
  const n = placeName(name); // The place name element

  // The four change types with their hectares; we pick the biggest
  const options = [ // Each: which stat, how big it is
    { key: 'built', ha: s.built }, // Orange
    { key: 'cleared', ha: s.cleared }, // Red
    { key: 'gained', ha: s.gained }, // Green
    { key: 'water', ha: s.water }, // Blue
  ]; // End of the options
  const total = options.reduce((sum, o) => sum + o.ha, 0); // All colored change added up ("reduce" walks the list, carrying a running sum)
  if (total < LITTLE_CHANGE_HA) { // Hardly anything changed: say so honestly
    return [start, 'little changed around ', n, ': less than 1 hectare.']; // e.g. "Between 2017 and 2023, little changed around Fontana: less than 1 hectare."
  } // End of the little-change check
  const biggest = options.reduce((a, b) => (b.ha > a.ha ? b : a)); // Keep whichever option has more hectares, all the way down the list

  if (biggest.key === 'built') return [start, n, ' turned ', highlight(s.built, '--built'), ' of land into buildings.']; // Orange story
  if (biggest.key === 'cleared') return [start, n, ' lost ', highlight(s.cleared, '--loss'), ' of green space to bare ground.']; // Red story
  if (biggest.key === 'gained') return [start, n, ' gained ', highlight(s.gained, '--gain'), ' of green space.']; // Green story
  return [start, highlight(s.water, '--water'), ' around ', n, ' became water.']; // Blue story (the only one left)
} // End of revealPieces

// Turn "2026-05-23" into "23 May 2026". The "T00:00" makes the browser read it as a local date, so it can't slip a day.
function readableDate(isoDate) {
  return new Date(`${isoDate}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); // Day, month name, year
} // End of readableDate

// The imagery line of the small print: whose satellite imagery it is, when it was taken, and why the coloured areas may not
// line up with it. "photoDate" is "YYYY-MM-DD" from Esri's metadata (current or archive imagery), or null when unknown.
function photoLine(photoDate) {
  return photoDate // With a date:
    ? `Satellite imagery: Esri, ${readableDate(photoDate)}, a different date than the land-cover maps, so the coloured areas may not line up exactly with the buildings and fields you see.` // e.g. "Satellite imagery: Esri, 23 May 2026, …"
    : "Satellite imagery: Esri, usually taken on a different date than the land-cover maps, so the coloured areas may not line up exactly with the buildings and fields you see."; // Without a date
} // End of photoLine

// Show when the map's satellite imagery was taken ("YYYY-MM-DD", or null when unknown) in the small print's second line.
// Separate from showResults, because the date can change after the result is shown (when the archive imagery arrives),
// and the year slider re-fills the result often without touching the imagery. "export" lets main.js use it.
export function showImageryDate(isoDate) {
  document.getElementById('photo-note').textContent = photoLine(isoDate); // The imagery line, with or without a date
} // End of showImageryDate

// Fill in the result panel for a place. "change" is the backend's answer, or null if there is none. "export" lets main.js use it.
// Every year shown comes from "change", so when a year slider changes the years, the text follows automatically.
export function showResults(place, change, coordsText) {
  const heading = document.getElementById('result-name'); // The big heading (the reveal sentence)
  const stats = document.getElementById('stats'); // The list of four stat rows
  const greenLost = document.getElementById('green-lost'); // The "green space lost in total" line
  const note = document.getElementById('result-note'); // Small print, line 1: the land cover and what Landturn does

  if (!change) { // No change data (the backend failed or has nothing here):
    document.getElementById('result-kicker').textContent = coordsText; // Just the coordinates, no years
    heading.textContent = place.name ?? coordsText; // The heading is simply the place name, or its coordinates if it has none
    stats.hidden = true; // Hide the stat rows
    document.getElementById('stats-label').hidden = true; // ...and their "Show on map" label
    greenLost.hidden = true; // Hide the total line
    note.textContent = "Change data isn't available for this place right now. The map still shows the satellite image."; // Explain
    return; // Nothing more to fill in
  } // End of the no-data case

  const s = change.stats_ha; // The stats, in hectares
  const { from, to } = change.years; // The two years compared ("destructuring": take these two values out of the object)
  document.getElementById('result-kicker').textContent = `${coordsText} · ${from} → ${to}`; // e.g. "33.9747° N, 117.5665° W · 2017 → 2023"
  heading.replaceChildren(...revealPieces(place.name, change)); // Replace the heading's contents with the sentence pieces ("..." spreads the list out)

  document.getElementById('stat-built').textContent = `${formatHa(s.built)} ha`; // Orange row
  document.getElementById('stat-cleared').textContent = `${formatHa(s.cleared)} ha`; // Red row
  document.getElementById('stat-gained').textContent = `${formatHa(s.gained)} ha`; // Green row
  document.getElementById('stat-water').textContent = `${formatHa(s.water)} ha`; // Blue row
  stats.hidden = false; // Show the rows
  document.getElementById('stats-label').hidden = false; // ...and their "Show on map" label

  greenLost.textContent = `Green space lost in total: ${formatHa(s.green_lost)} ha, including land now built on or under water.`; // The overall green-loss figure
  greenLost.hidden = false; // Show it

  let noteText = `Land cover: Impact Observatory’s 10 m maps of ${from} and ${to}. Landturn compares them pixel by pixel and counts the changes; changes narrower than 30 m are left out.`; // Who made the labels, and what Landturn does with them; the 30 m rule matches remove_thin_changes in backend/app/landcover.py (" " is a non-breaking space: a number never gets split from its unit)
  if (s.no_data > 0) noteText += ` No data (clouds) for ${formatHa(s.no_data)} ha of the square.`; // Mention gaps, if there are any
  note.textContent = `${noteText} Estimates, not a survey.`; // Always end by saying what kind of numbers these are
} // End of showResults

// ---------- The colour switches (the stats rows) ----------

// Make the four stats rows work as on/off switches for the map's colours. "onChange" is called after every press with the
// change types that are switched on, e.g. ['built', 'gained'] ("export" lets main.js use it).
export function setUpColourSwitches(onChange) {
  const switches = [...document.querySelectorAll('.stat-switch')]; // The four row buttons ("[...]" turns the found list into a normal array)
  for (const button of switches) { // For each row:
    button.addEventListener('click', () => { // When it's pressed (click, tap, or Enter/Space on the keyboard):
      const on = button.getAttribute('aria-pressed') === 'true'; // Is it on right now?
      button.setAttribute('aria-pressed', on ? 'false' : 'true'); // Flip it: the look (style.css) and what screen readers say follow this
      onChange(shownChanges()); // Report which colours are on now
    }); // End of the click listener
  } // End of the rows loop
} // End of setUpColourSwitches

// The change types whose switch is on, e.g. ['built', 'cleared', 'gained', 'water'] when all are on ("export" lets main.js use it)
export function shownChanges() {
  return [...document.querySelectorAll('.stat-switch[aria-pressed="true"]')].map((button) => button.dataset.change); // "dataset.change" reads data-change
} // End of shownChanges

// Switch all four back on (for a new place)
export function resetColourSwitches() {
  for (const button of document.querySelectorAll('.stat-switch')) button.setAttribute('aria-pressed', 'true'); // Every row on
} // End of resetColourSwitches
