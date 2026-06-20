import { defineConfig } from 'vite'

// The app runs inside the Even Hub phone WebView (and the simulator points at
// this dev server). `host: true` exposes it on the LAN so a phone can reach it.
export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
