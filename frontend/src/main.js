// Bring in our styles from style.css (colors, fonts, layout)
import './style.css';
// Bring in the function that draws the globe, from globe.js
import { startGlobe } from './globe.js';

// Find the globe canvas and the teaser box in index.html, and start the globe with them
startGlobe(document.getElementById('globe'), document.getElementById('teaser'));
