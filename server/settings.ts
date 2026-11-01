import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from './types.ts'

const DEFAULTS: Omit<Settings, 'key'> = {
  port: 47821,
  idleMinutes: 10,
  offlineSeconds: 20,
  modDir: null,
  testCommands: [
    'npm test',
    'npm run test',
    'pnpm test',
    'yarn test',
    'npx vitest',
    'vitest',
    'npx jest',
    'jest',
    'pytest',
    'phpunit',
    'php artisan test',
    'go test',
    'cargo test',
  ],
}

export function homeDirectory(): string {
  return process.env.CCC_HOME ?? join(homedir(), '.claude-control-center')
}

export function loadSettings(home: string): Settings {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(home, 0o700)

  const path = join(home, 'config.json')
  const stored = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>)
    : {}
  const known = Object.entries(stored).filter(([name]) => name in DEFAULTS)
  const settings: Settings = {
    ...DEFAULTS,
    ...Object.fromEntries(known),
    key: stored.key ?? randomBytes(32).toString('hex'),
  }

  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)

  return settings
}
