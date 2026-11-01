import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const READ_LIMIT = 8 * 1024 * 1024
const CLOCK_SKEW_MS = 2000

function claudeRoots(): string[] {
  const uid = process.getuid?.() ?? 0

  return [...new Set([`/private/tmp/claude-${uid}`, `/tmp/claude-${uid}`, join(tmpdir(), `claude-${uid}`)])]
}

function listDirectory(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

export function findOutputFile(sessionId: string, startedAt: number, roots = claudeRoots()): string | null {
  let newest: { path: string; mtimeMs: number } | null = null

  for (const root of roots) {
    for (const project of listDirectory(root)) {
      const tasks = join(root, project, sessionId, 'tasks')

      for (const name of listDirectory(tasks)) {
        if (!name.endsWith('.output')) {
          continue
        }

        const path = join(tasks, name)

        try {
          const { mtimeMs } = statSync(path)

          if (mtimeMs >= startedAt - CLOCK_SKEW_MS && (newest === null || mtimeMs > newest.mtimeMs)) {
            newest = { path, mtimeMs }
          }
        } catch {
          continue
        }
      }
    }
  }

  return newest?.path ?? null
}

export function readOutput(path: string): string | null {
  try {
    const file = openSync(path, 'r')

    try {
      const { size } = fstatSync(file)
      const length = Math.min(size, READ_LIMIT)
      const buffer = Buffer.alloc(length)

      readSync(file, buffer, 0, length, size - length)

      return buffer.toString('utf8')
    } finally {
      closeSync(file)
    }
  } catch {
    return null
  }
}
