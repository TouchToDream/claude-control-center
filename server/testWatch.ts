import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { matchesAnyCommand, splitCommand } from './status.ts'

const READ_LIMIT = 8 * 1024 * 1024
const CLOCK_SKEW_MS = 2000

const REDIRECT = /(?:^|\s)(?:[12]?>>?|&>>?)\s*("[^"]+"|'[^']+'|[^\s"'&|;<>]+)/g
const TEE = /^tee(?:\s+-a)?\s+("[^"]+"|'[^']+'|\S+)/

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, '$2')
}

export function outputTarget(command: string, cwd: string, patterns: readonly string[]): string | null {
  const parts = splitCommand(command)
  const index = parts.findIndex(part => matchesAnyCommand(part, patterns))

  if (index === -1) {
    return null
  }

  const redirect = [...(parts[index] as string).matchAll(REDIRECT)]
    .map(found => found[1] as string)
    .find(target => !target.startsWith('&'))
  const tee = TEE.exec(parts[index + 1] ?? '')?.[1]
  const target = redirect ?? tee

  if (target === undefined) {
    return null
  }

  const path = unquote(target)

  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(cwd, path)
}

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
