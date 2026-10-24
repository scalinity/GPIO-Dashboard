import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation for SharedArrayBuffer (physics worker, Pyodide). `tauri dev` loads this
// server directly, so it must send the same headers as tauri.conf.json (SPEC 13.2). They are set
// on every response, 304s included: Vite's `server.headers` skips its 304 revalidation replies,
// and WKWebView then keeps a cached copy of the page whose headers predate isolation.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

function crossOriginIsolation() {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value)
        next()
      })
    }
  }
}

export default defineConfig({
  root: 'src/renderer',
  clearScreen: false,
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), crossOriginIsolation()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
})
