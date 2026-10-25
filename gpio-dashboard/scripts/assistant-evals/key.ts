// Where the API key comes from (SPEC 3.3): the .env file in the main checkout, read into this
// process's memory and handed on as a function. It is never put in process.env, never printed and
// never written to a file. Plain Node, no Vite: cli.ts and proxyTest.ts both import it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** The .env file in the main checkout, or the one named by --key-file. */
export function envFile(root: string, argv: string[]): string | null {
  const given = argv.indexOf('--key-file')
  if (given >= 0 && argv[given + 1]) return resolve(argv[given + 1]!)
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: root,
        encoding: 'utf8'
      }
    ).trim()
    return resolve(dirname(common), '.env')
  } catch {
    return null
  }
}

/** ANTHROPIC_API_KEY from the file, or null when there is none. */
export function loadKey(root: string, argv: string[]): (() => string) | null {
  const file = envFile(root, argv)
  if (!file || !existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    let value = match[1]!
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    return value ? () => value : null
  }
  return null
}

/** Text with anything shaped like a key, and the key itself, replaced. */
export function redact(text: string, key: (() => string) | null): string {
  const exact = key?.()
  const cleaned = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
  return exact ? cleaned.split(exact).join('[redacted]') : cleaned
}
