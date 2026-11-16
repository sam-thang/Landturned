// The hand-picked places shown as glowing hotspots on the globe.
// Each place is an object with:
//   id     - a short unique name for use in code
//   name   - the name shown to people
//   lon    - longitude (east-west position; negative = west of Greenwich)
//   lat    - latitude (north-south position; negative = south of the equator)
//   type   - the main kind of change: 'built', 'loss' (green space lost), 'gain' (green space gained) or 'water'
//   teaser - a short "before → after" line shown when hovering
// "export" lets globe.js (and later other files) use this list.
export const PLACES = [
  { id: 'fontana', name: 'Fontana, California', lon: -117.435, lat: 34.092, type: 'built', teaser: 'Farmland → warehouses' }, // Inland Empire: our main test location
  { id: 'vegas', name: 'Las Vegas, Nevada', lon: -115.14, lat: 36.17, type: 'built', teaser: 'Desert → suburbs' }, // Suburbs spreading into the desert
  { id: 'dubai', name: 'Dubai, UAE', lon: 55.14, lat: 25.11, type: 'built', teaser: 'Sea and sand → city' }, // Artificial islands and new districts
  { id: 'shenzhen', name: 'Shenzhen, China', lon: 114.06, lat: 22.54, type: 'built', teaser: 'Fields → megacity' }, // Grew from small towns to a huge city
  { id: 'rondonia', name: 'Rondônia, Brazil', lon: -62.9, lat: -10.4, type: 'loss', teaser: 'Rainforest → pasture' }, // Amazon deforestation in a "fishbone" pattern along roads
  { id: 'gorges', name: 'Three Gorges, China', lon: 110.98, lat: 30.82, type: 'water', teaser: 'Valley → reservoir' }, // River valley flooded by the Three Gorges Dam
  { id: 'stavanger', name: 'Stavanger, Norway', lon: 5.73, lat: 58.97, type: 'built', teaser: 'Quiet, steady growth' }, // Our second test location: cloudy, subtle change
]; // End of the places list
