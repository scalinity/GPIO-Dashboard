import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Vitest runs the TypeScript tests; the existing bridge tests (*.test.js) stay on node --test.
export default defineConfig({
  resolve: {
    alias: { '@renderer': resolve('src/renderer/src') }
  },
  test: {
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    environment: 'node'
  }
})
