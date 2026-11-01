import { execFile } from 'node:child_process'

export type BackgroundResult = {
  id: string | null
  output: string
  error: string | null
}

const TIMEOUT_MS = 20_000

export function startBackgroundSession(
  cwd: string,
  prompt: string,
  modDir: string | null,
): Promise<BackgroundResult> {
  return run(cwd, ['--bg', ...(modDir === null ? [] : ['--plugin-dir', modDir]), prompt])
}

export function resumeBackgroundSession(cwd: string, sessionId: string): Promise<BackgroundResult> {
  return run(cwd, ['--bg', '--resume', sessionId])
}

export function stopBackgroundSession(cwd: string, sessionId: string): Promise<BackgroundResult> {
  return run(cwd, ['stop', sessionId.slice(0, 8)])
}

function run(cwd: string, args: string[]): Promise<BackgroundResult> {
  return new Promise(done => {
    execFile('claude', args, { cwd, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim()

      done({
        id: /\b[0-9a-f]{6,}(?:-[0-9a-f-]+)?\b/.exec(stdout)?.[0] ?? null,
        output,
        error: error === null ? null : error.message,
      })
    })
  })
}
