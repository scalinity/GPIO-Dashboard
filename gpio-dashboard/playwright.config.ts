// End-to-end tests (SPEC 18): Chromium against the Vite dev server, on localhost only. They use
// their own port, so a running `tauri dev` (5173) is never mistaken for the server under test.
import { defineConfig, devices } from '@playwright/test'

const PORT = 5193

export default defineConfig({
  testDir: 'e2e',
  // out/ is git-ignored.
  outputDir: 'out/e2e',
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      // The full Chromium build in new headless mode draws on the GPU, with WebGPU; the default
      // headless shell renders WebGL2 in software and has no WebGPU adapter.
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: 1280, height: 800 }
      }
    }
  ],
  webServer: {
    command: `npm run web:dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false
  }
})
