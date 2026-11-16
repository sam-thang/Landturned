// Bring in two tools from the MapLibre library: the map itself and the zoom/rotate buttons
import { MapLibreMap, NavigationControl } from 'maplibre-gl';
// Bring in MapLibre's own styles, which make the buttons and attribution text look right
import 'maplibre-gl/dist/maplibre-gl.css';
// Bring in our own styles from style.css (full-window map, dark background)
import './style.css';

// The web address pattern for Esri's satellite image tiles.
// {z} = zoom level, {y} = tile row, {x} = tile column. Note: Esri puts y before x.
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// The point the map starts centered on: between Ontario and Fontana, California.
// IMPORTANT: MapLibre wants [longitude, latitude], the reverse of how people usually say it.
// Longitude is negative here because the place is west of Greenwich, England (0°).
const START_CENTER = [-117.55, 34.07];

// How far in the map starts. 0 shows the whole world; each step up doubles the detail.
// 12 shows roughly a 20 km wide area on a laptop screen.
const START_ZOOM = 12;

// Create the map and keep a reference to it in a variable called "map"
const map = new MapLibreMap({
  container: 'map', // Draw the map inside the HTML element whose id is "map"
  center: START_CENTER, // Start at the point defined above
  zoom: START_ZOOM, // Start at the zoom level defined above
  style: { // The "style" describes what the map shows: its data sources and how to draw them
    version: 8, // The version of MapLibre's style format; 8 is the current one
    sources: { // A list of places the map can get data from
      satellite: { // Our one source, which we name "satellite"
        type: 'raster', // Raster = ready-made images (pixels), not shapes like roads or outlines
        tiles: [SATELLITE_TILES], // Where to download the image tiles from
        tileSize: 256, // Each tile is a 256 × 256 pixel square
        maxzoom: 19, // Esri has no sharper tiles past zoom 19; beyond that MapLibre enlarges zoom-19 tiles
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', // Credit line the imagery licence requires
      }, // End of the satellite source
    }, // End of the sources list
    layers: [ // The layers to draw, from bottom to top (just one for now)
      {
        id: 'satellite-layer', // A unique name for this layer
        type: 'raster', // Draw it as an image layer
        source: 'satellite', // Take the images from the "satellite" source above
      }, // End of the satellite layer
    ], // End of the layers list
  }, // End of the style
}); // End of creating the map

// Add the zoom-in, zoom-out, and compass buttons to the top-right corner of the map
map.addControl(new NavigationControl(), 'top-right');
