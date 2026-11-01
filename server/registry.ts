import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RegistryEntry = {
  pid: number
  sessionId: string
  cwd: string
  name: string | null
  nameSource: string | null
  kind: string | null
  entrypoint: string | null
  status: string | null
  startedAt: number
  isAlive: boolean
}

export function readRegistry(directory = join(homedir(), '.claude', 'sessions')): RegistryEntry[] {
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch {
    return []
  }

  return names.flatMap(name => {
    if (!/^\d+\.json$/.test(name)) {
      return []
    }

    return parseEntry(join(directory, name))
  })
}

function parseEntry(path: string): RegistryEntry[] {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

    if (typeof raw.sessionId !== 'string' || typeof raw.pid !== 'number') {
      return []
    }

    return [
      {
        pid: raw.pid,
        sessionId: raw.sessionId,
        cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
        name: typeof raw.name === 'string' ? raw.name : null,
        nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : null,
        kind: typeof raw.kind === 'string' ? raw.kind : null,
        entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : null,
        status: typeof raw.status === 'string' ? raw.status : null,
        startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
        isAlive: isAlive(raw.pid),
      },
    ]
  } catch {
    return []
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
