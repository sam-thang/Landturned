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
// The order is the button order: colors are mixed so the first few buttons already show different kinds of change.
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
  { id: 'cajamar', name: 'Cajamar, Brazil', lon: -46.8747, lat: -23.3435, type: 'built', teaser: 'Pasture → warehouses · 48 ha built' }, // Logistics hub north of Sao Paulo
  { id: 'western_sydney', name: 'Western Sydney, Australia', lon: 150.72, lat: -33.88, type: 'built', teaser: 'Farmland → new airport · 84 ha built' }, // Western Sydney International Airport, built 2018-2026
]; // End of the places list
