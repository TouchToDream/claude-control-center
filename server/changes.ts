import { execFile } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { redact } from '../mod/hooks/redact.ts'
import type { ChangedFile } from './types.ts'

const DIFF_LIMIT = 512 * 1024
const GIT_TIMEOUT_MS = 10_000
const JETBRAINS_APPS = /^(PhpStorm|WebStorm|goland|intellij|pycharm|rubymine|clion|rider|datagrip)$/i

export type FileDiff = {
  diff: string
  isTruncated: boolean
}

function git(cwd: string, args: string[]): Promise<{ stdout: string; failed: boolean }> {
  return new Promise(done => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * DIFF_LIMIT }, (error, stdout) => {
      const isDifferenceExit = (error as { code?: unknown } | null)?.code === 1

      done({ stdout, failed: error !== null && !isDifferenceExit })
    })
  })
}

export function isSafePath(path: string): boolean {
  return path !== '' && !isAbsolute(path) && !path.split('/').includes('..')
}

export async function readDiff(cwd: string, file: ChangedFile): Promise<FileDiff | null> {
  const args = file.isNew
    ? ['diff', '--no-color', '--no-index', '--', '/dev/null', file.path]
    : ['diff', '--no-color', 'HEAD', '--', `:/${file.path}`]
  const { stdout, failed } = await git(cwd, args)

  if (failed) {
    return null
  }

  const isTruncated = stdout.length > DIFF_LIMIT

  return { diff: redact(isTruncated ? stdout.slice(0, DIFF_LIMIT) : stdout), isTruncated }
}

export async function absolutePath(cwd: string, file: ChangedFile): Promise<string | null> {
  if (file.isNew) {
    return join(cwd, file.path)
  }

  const { stdout, failed } = await git(cwd, ['rev-parse', '--show-toplevel'])

  return failed ? null : join(stdout.trim(), file.path)
}

export function ideArguments(terminal: string | null, path: string, line: number | null): string[] {
  if (terminal !== null && JETBRAINS_APPS.test(terminal)) {
    return ['-nb', `com.jetbrains.${terminal}`, '--args', ...(line === null ? [] : ['--line', String(line)]), path]
  }

  return terminal === 'vscode' ? ['-b', 'com.microsoft.VSCode', path] : [path]
}

export function openInIde(terminal: string | null, path: string, line: number | null): Promise<boolean> {
  return new Promise(done => {
    execFile('open', ideArguments(terminal, path, line), { timeout: GIT_TIMEOUT_MS }, error => done(error === null))
  })
}
