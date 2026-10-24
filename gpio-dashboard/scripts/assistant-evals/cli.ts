// Entry point for npm run evals and npm run evals:live. A plain Node script: it starts Vite's module
// runner so the app's own TypeScript (its ?raw and import.meta.glob imports included) loads
// unchanged, then hands over to main.ts.
//
// The API key is read only for --live (see key.ts), and reaches main.ts only as a function.
import { resolve } from 'node:path'
import { createServer, createServerModuleRunner } from 'vite'
import { loadKey } from './key.ts'

const root = resolve(import.meta.dirname, '../..')
const argv = process.argv.slice(2)

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'warn',
  clearScreen: false,
  resolve: { alias: { '@renderer': resolve(root, 'src/renderer/src') } },
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }
})
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false })
let code = 1
try {
  const main = (await runner.import('/scripts/assistant-evals/main.ts')) as typeof import('./main')
  code = await main.main({
    argv,
    key: argv.includes('--live') ? loadKey(root, argv) : null,
    root
  })
} finally {
  await runner.close()
  await server.close()
}
process.exit(code)
