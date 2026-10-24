// npm run evals:proxy
//
// Runs the ignored live test of the Rust proxy (src-tauri/src/anthropic.rs,
// live_count_tokens_through_the_real_proxy_path) with the key in that test process's environment
// and nowhere else. The test binary is built first, with no key in anything's environment; this
// script then starts that one binary with the key. The test injects it through its key-provider
// seam and never touches the Keychain.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { loadKey, redact } from './key.ts'

const root = resolve(import.meta.dirname, '../..')
const crate = resolve(root, 'src-tauri')
const argv = process.argv.slice(2)
const TEST = 'live_count_tokens_through_the_real_proxy_path'

const key = loadKey(root, argv)
if (!key) {
  console.log('No ANTHROPIC_API_KEY was found, so the live proxy test was not run.')
  process.exit(2)
}

// Build without the key: cargo, rustc and every build script see an environment that lacks it.
const built = spawnSync('cargo', ['test', '--no-run', '--message-format=json'], {
  cwd: crate,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024
})
if (built.status !== 0) {
  console.log(`cargo test --no-run failed:\n${redact(built.stderr, key)}`)
  process.exit(1)
}
const binary = built.stdout
  .split('\n')
  .flatMap((line) => {
    try {
      const message = JSON.parse(line) as {
        executable?: string | null
        profile?: { test?: boolean }
        target?: { name?: string; kind?: string[] }
      }
      return message.executable &&
        message.profile?.test &&
        message.target?.name === 'gpio-dashboard'
        ? [message.executable]
        : []
    } catch {
      return []
    }
  })
  .at(-1)
if (!binary) {
  console.log('Could not find the compiled test binary in cargo output.')
  process.exit(1)
}

const ran = spawnSync(binary, [TEST, '--ignored', '--nocapture', '--test-threads=1'], {
  cwd: crate,
  encoding: 'utf8',
  env: { ...process.env, ANTHROPIC_API_KEY: key() }
})
console.log(redact(`${ran.stdout}${ran.stderr}`, key).trim())
console.log(`\ntest process exit status: ${ran.status}`)
process.exit(ran.status ?? 1)
