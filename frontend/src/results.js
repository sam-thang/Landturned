// The result panel: the reveal sentence, the stats rows, and the notes, filled in from the backend's answer.

// Less than this many hectares of colored change in total counts as "little changed"
const LITTLE_CHANGE_HA = 1;

// Turn hectares into text with one decimal, e.g. 17.93 → "17.9"
function formatHa(hectares) {
  return hectares.toFixed(1); // toFixed(1) rounds to one decimal place
} // End of formatHa

// Make a highlighted number for the reveal sentence, e.g. "17.9 hectares" in orange.
// Built as an element (not as HTML text), so nothing in it can ever run as code.
function highlight(hectares, colorVar) {
  const b = document.createElement('b'); // A new <b> (bold) element
  b.textContent = `${formatHa(hectares)} hectares`; // Its text, e.g. "17.9 hectares"
  b.style.color = `var(${colorVar})`; // Its color, e.g. var(--built) for orange
  return b; // Hand back the finished element
} // End of highlight

// Make the place name for the reveal sentence, underlined like in the mockup.
// The name may be typed by the user, so it only ever goes in as plain text (textContent), never as HTML.
function placeName(name) {
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

// Fill in the result panel for a place. "change" is the backend's answer, or null if there is none.
// "export" lets main.js use it.
export function showResults(place, change, coordsText) {
  const heading = document.getElementById('result-name'); // The big heading (the reveal sentence)
  const stats = document.getElementById('stats'); // The list of four stat rows
  const greenLost = document.getElementById('green-lost'); // The "green space lost in total" line
  const note = document.getElementById('result-note'); // The small print at the bottom

  if (!change) { // No change data (the backend failed or has nothing here):
    document.getElementById('result-kicker').textContent = coordsText; // Just the coordinates, no years
    heading.textContent = place.name; // The heading is simply the place name
    stats.hidden = true; // Hide the stat rows
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

  greenLost.textContent = `Green space lost in total: ${formatHa(s.green_lost)} ha, including land now built on or under water.`; // The overall green-loss figure
  greenLost.hidden = false; // Show it

  let noteText = `Estimates from 10 m land-cover maps (Impact Observatory, ${from} and ${to}), compared pixel by pixel. Area: the 2 × 2 km square outlined on the map.`; // The standard small print
  if (s.no_data > 0) noteText += ` No data (e.g. clouds) for ${formatHa(s.no_data)} ha of it.`; // Mention gaps, if there are any
  note.textContent = noteText; // Put it in
} // End of showResults
