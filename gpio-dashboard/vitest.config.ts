import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Vitest runs the TypeScript tests; the existing bridge tests (*.test.js) stay on node --test.
export default defineConfig({
  resolve: {
    alias: { '@renderer': resolve('src/renderer/src') }
  },
  test: {
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    // The content registries expand import.meta.glob when their module is transformed, and the
    // on-disk transform cache keys on that module's text, not on the folder it lists. A new
    // content file would be silently missing from the next run, so the cache stays off.
    fsModuleCache: false,
    environment: 'node'
  }
})
