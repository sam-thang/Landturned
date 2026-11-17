// Settings for Vite (the development server and build tool)
import { defineConfig } from 'vite'; // A helper that gives editors hints about which settings exist
import basicSsl from '@vitejs/plugin-basic-ssl'; // Official plugin that makes the dev server use https with a homemade ("self-signed") certificate

// Export the settings so Vite can read them when it starts
export default defineConfig({
  // https is needed for "locate me": browsers only share your location with secure pages (https, or localhost on
  // this computer). Phones open the dev server by its network address, so without https they'd refuse.
  // The first visit shows a "not private" warning, because nobody vouched for the homemade certificate: tap through it once.
  plugins: [basicSsl()], // Turn on the https plugin
  server: { // Settings for the development server (npm run dev)
    watch: { // How Vite notices that files have changed
      usePolling: true, // Check the files ourselves at a fixed rhythm, because Windows sometimes fails to report changes
      interval: 300, // Check every 300 milliseconds (0.3 seconds)
    }, // End of the watch settings
    proxy: { // Forward some requests to another server, so the browser only ever talks to Vite (no CORS problems)
      '/api': 'http://127.0.0.1:8000', // Any address starting with /api goes to the FastAPI backend running on this computer
    }, // End of the proxy settings
  }, // End of the server settings
}); // End of the settings
