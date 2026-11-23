// The hotspot places shown as glowing dots on the globe and as buttons under the search box.
// They are verified, not guessed: backend/scripts/rank_places.py ran the app's own analysis (first year vs latest
// year, 2 x 2 km square) around about 40 candidates, nudged each square to where the change is, and we checked
// every winner's change picture by eye. The coordinates below are those best squares' centers, and the
// hectares in the teasers are the analysis results (2017 -> 2024, re-measured 2026-11-21 when 2024 became available), so clicking a place shows the same numbers.
// They were updated on 2026-11-19 when the analysis started removing edge noise (changes narrower than 30 m);
// if the analysis changes again, re-check every place's numbers against /api/analysis (its last comparison) and update them here.
// Each place is an object with:
//   id     - a short unique name for use in code
//   name   - the name shown to people; the buttons show only the part before the first comma
//   lon    - longitude (east-west position; negative = west of Greenwich)
//   lat    - latitude (north-south position; negative = south of the equator)
//   type   - the main kind of change: 'built', 'loss' (green space cleared), 'gain' (green space gained) or 'water'
//   teaser - a short "before → after" line with the real number, shown when hovering
// The order of this list doesn't matter: the button order is set by BUTTON_ORDER at the bottom of this file.
// "export" lets globe.js and main.js use this list.
export const PLACES = [
  { id: 'ontario_ranch', name: 'Ontario Ranch, California', lon: -117.5962, lat: 33.9785, type: 'built', teaser: 'Dairy farms → suburbs · 193 ha built' }, // Inland Empire, our main test area
  { id: 'gerd', name: 'Renaissance Dam, Ethiopia', lon: 35.093, lat: 11.2015, type: 'water', teaser: 'River valley → reservoir · 257 ha new water' }, // Blue Nile reservoir, filled 2020-2023
  { id: 'giga_berlin', name: 'Giga Berlin, Germany', lon: 13.792, lat: 52.396, type: 'built', teaser: 'Pine forest → car factory · 164 ha built' }, // Tesla factory, built 2020-2022
  { id: 'kilauea', name: 'Kīlauea, Hawaiʻi', lon: -154.8943, lat: 19.48, type: 'loss', teaser: 'Rainforest → lava field · 78 ha cleared' }, // The 2018 lower Puna eruption buried forest and farmland under lava: green -> bare ground, and nothing is built on it. Our red place since 2026-11-21 (mines and building sites mostly count as built or water in this data; checked by eye: red sits on fresh lava)
  { id: 'egypt_capital', name: 'New Capital, Egypt', lon: 31.7256, lat: 30.015, type: 'built', teaser: 'Desert → new capital city · 279 ha built' }, // Egypt's New Administrative Capital
  { id: 'marker_wadden', name: 'Marker Wadden, Netherlands', lon: 5.3822, lat: 52.585, type: 'gain', teaser: 'Open lake → new green islands · 93 ha' }, // Islands built from lake sand, now covered in reeds
  { id: 'giga_texas', name: 'Giga Texas, Austin', lon: -97.617, lat: 30.222, type: 'built', teaser: 'Farmland → car factory · 265 ha built' }, // Tesla factory, built 2020-2022
  { id: 'hasankeyf', name: 'Hasankeyf, Turkey', lon: 41.427, lat: 37.71, type: 'water', teaser: 'Ancient town → reservoir · 189 ha new water' }, // Flooded by the Ilisu Dam in 2020
  { id: 'weda_bay', name: 'Weda Bay, Indonesia', lon: 127.9625, lat: 0.4835, type: 'built', teaser: 'Rainforest → nickel industry · 94 ha built' }, // Nickel mining and smelters on Halmahera island. Until 2026-11-21 this was the red (cleared) place, 2017 -> 2023; with 2024 data the cleared land here is mostly built on (93.7 ha built, 23.1 ha cleared), so it's orange now (user's choice)
  { id: 'hcmc_east', name: 'Ho Chi Minh City, Vietnam', lon: 106.84, lat: 10.84, type: 'built', teaser: 'Fields → high-rise district · 224 ha built' }, // New districts in the city's east (Thu Duc)
  { id: 'hidroituango', name: 'Hidroituango, Colombia', lon: -75.6864, lat: 7.0865, type: 'water', teaser: 'River canyon → reservoir · 151 ha new water' }, // Colombia's largest dam; its reservoir flooded the forested Cauca canyon from 2018. Replaced Cajamar (Brazil, only 14% of the square changed) on 2026-11-23
  { id: 'western_sydney', name: 'Western Sydney, Australia', lon: 150.72, lat: -33.88, type: 'built', teaser: 'Farmland → new airport · 84 ha built' }, // Western Sydney International Airport, built 2018-2026
]; // End of the places list

// The order of the place buttons under the search box: the most impressive change first, because on a phone only
// the first two or three buttons show without scrolling. Ranked on 2026-11-23 by measuring each place (changed share
// of the square, how much one change type dominates, how solid its patches are, minus clouds and label flicker) and
// checking each before/after swipe by eye. To change the order, just move the ids around in this list.
// A place missing from this list still gets a button, at the end.
export const BUTTON_ORDER = [
  'egypt_capital', // 73% of the square changed: desert to city, one solid block
  'giga_texas', // 71% changed: farmland to factory
  'hcmc_east', // 59% changed: fields to high-rise district
  'gerd', // 66% changed: valley to reservoir (blue)
  'hasankeyf', // 47% changed: town to lake (blue)
  'giga_berlin', // 41% changed: forest to factory, one clean block
  'ontario_ranch', // 53% changed: farms to suburbs, a few mislabeled roofs
  'hidroituango', // 38% changed: forested canyon to reservoir, one solid blue band
  'western_sydney', // 31% changed: the new airport, colors scattered
  'kilauea', // 21% changed: dramatic lava photos, labels waver (our only red place)
  'marker_wadden', // 24% changed: the islands are already there in the before photo
  'weda_bay', // 34% changed but scattered and messy
]; // End of the button order
