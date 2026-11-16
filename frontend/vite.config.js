// Settings for Vite (the development server and build tool)
import { defineConfig } from 'vite'; // A helper that gives editors hints about which settings exist

// Export the settings so Vite can read them when it starts
export default defineConfig({
  server: { // Settings for the development server (npm run dev)
    watch: { // How Vite notices that files have changed
      usePolling: true, // Check the files ourselves at a fixed rhythm, because Windows sometimes fails to report changes
      interval: 300, // Check every 300 milliseconds (0.3 seconds)
    }, // End of the watch settings
  }, // End of the server settings
}); // End of the settings
