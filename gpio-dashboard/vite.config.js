import { createReadStream, readFileSync } from 'fs'
import { join, resolve } from 'path'
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

// Pyodide runs from local files, never a CDN (SPEC 13.2). The worker bundles pyodide.mjs; these
// are the files loadPyodide fetches from its indexURL, served at /pyodide/ in dev and emitted
// into the build so the app embeds them.
const PYODIDE_DIR = resolve('node_modules/pyodide')
const PYODIDE_FILES = {
  'pyodide.asm.mjs': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json'
}

function pyodideAssets() {
  return {
    name: 'pyodide-assets',
    configureServer(server) {
      server.middlewares.use('/pyodide/', (req, res, next) => {
        const file = req.url.slice(1).split('?')[0]
        if (!(file in PYODIDE_FILES)) return next()
        res.setHeader('Content-Type', PYODIDE_FILES[file])
        createReadStream(join(PYODIDE_DIR, file)).pipe(res)
      })
    },
    generateBundle() {
      for (const file of Object.keys(PYODIDE_FILES)) {
        this.emitFile({
          type: 'asset',
          fileName: `pyodide/${file}`,
          source: readFileSync(join(PYODIDE_DIR, file))
        })
      }
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
  plugins: [react(), crossOriginIsolation(), pyodideAssets()],
  optimizeDeps: { exclude: ['pyodide'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
})
