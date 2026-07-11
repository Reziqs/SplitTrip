import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/SplitTrip/',
  server: {
    host: '0.0.0.0', // REQUIRED for Codespaces
    port: 5173,
    hmr: {
      clientPort: 443 // Ensures hot-reloading works through the browser proxy
    }
  }
})