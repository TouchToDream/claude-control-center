import { execFile, spawn } from 'node:child_process'

const SERVICE = 'claude-control-center-telegram'
const TOKEN_FORMAT = /^\d{5,}:[A-Za-z0-9_-]{20,}$/

export type Secrets = {
  readToken: () => Promise<string | null>
  writeToken: (token: string) => Promise<void>
  deleteToken: () => Promise<void>
}

export function isTokenFormat(token: string): boolean {
  return TOKEN_FORMAT.test(token)
}

export function createKeychain(account: string): Secrets {
  const quotedAccount = `"${account.replaceAll('"', '')}"`

  return {
    readToken: () =>
      new Promise(done => {
        execFile('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], (error, stdout) => {
          done(error === null ? stdout.trim() : null)
        })
      }),
    writeToken: token =>
      new Promise((done, fail) => {
        const shell = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] })

        shell.once('error', fail)
        shell.once('close', code => (code === 0 ? done() : fail(new Error('keychain write failed'))))
        shell.stdin.end(`add-generic-password -U -s ${SERVICE} -a ${quotedAccount} -w "${token}"\n`)
      }),
    deleteToken: () =>
      new Promise(done => {
        execFile('security', ['delete-generic-password', '-s', SERVICE, '-a', account], () => done())
      }),
  }
}
