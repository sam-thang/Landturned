// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, from globe.js
import { startGlobe } from './globe.js';

// Find the canvas with id="globe" in index.html and draw the globe on it
startGlobe(document.getElementById('globe'));
