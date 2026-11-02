import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { WebSocket } from 'ws'
import { createApp } from './app.ts'
import type { App } from './app.ts'
import type { RegistryEntry } from './registry.ts'
import { Store } from './store.ts'
import { TelegramError } from './telegram.ts'
import type { Settings } from './types.ts'

const KEY = 'a'.repeat(64)
const settings: Settings = { port: 0, key: KEY, idleMinutes: 10, offlineSeconds: 20, modDir: null, testCommands: ['npm test'] }

let app: App
let store: Store
let base: string
let port: number
let registryEntries: RegistryEntry[] = []
const resumed: string[][] = []
const stopped: string[][] = []
const telegramSent: string[] = []
const opened: unknown[][] = []
let savedToken: string | null = null
const uploadsRoot = mkdtempSync(join(tmpdir(), 'ccc-uploads-'))

before(async () => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ccc-')), 'test.sqlite'))
  app = createApp({ store, settings, webRoot: '/nonexistent', registry: () => registryEntries, uploadsRoot, uploadLimit: 1024,
    resume: async (cwd, sessionId) => {
      resumed.push([cwd, sessionId])

      return { id: sessionId.slice(0, 8), output: 'backgrounded', error: null }
    },
    stop: async (cwd, sessionId) => {
      stopped.push([cwd, sessionId])

      return { id: null, output: 'stopped', error: null }
    },
    telegram: {
      getBotName: async token => {
        if (token.startsWith('401')) {
          throw new TelegramError('Unauthorized')
        }

        return 'my_bot'
      },
      findChats: async () => [{ id: '-100', title: 'Claude', type: 'supergroup' }],
      send: async (_token, chatId, text) => {
        telegramSent.push(`${chatId}: ${text}`)
      },
    },
    openFile: async (terminal, path, line) => {
      opened.push([terminal, path, line])

      return true
    },
    secrets: {
      readToken: async () => savedToken,
      writeToken: async token => {
        savedToken = token
      },
      deleteToken: async () => {
        savedToken = null
      },
    },
  })
  port = await app.listen()
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  await app.close()
  store.close()
})

const mod = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { 'x-ccc-key': KEY, 'content-type': 'application/json', ...init.headers } })

const panel = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { cookie: `ccc_key=${KEY}`, origin: base, 'content-type': 'application/json', ...init.headers },
  })

const events = (sessionId: string, list: object[]) =>
  mod('/api/mod/events', { method: 'POST', body: JSON.stringify({ sessionId, events: list }) })

const hello = (sessionId: string) =>
  events(sessionId, [{ t: 'hello', at: Date.now(), cwd: '/work/repo', repoRoot: '/work/repo', model: 'm', surfaces: ['terminal'] }])

async function createAsk(sessionId: string, id: string, blockedBy: string | null = null) {
  await hello(sessionId)

  return mod('/api/mod/asks', {
    method: 'POST',
    body: JSON.stringify({ id, sessionId, kind: 'permission', tool: 'Bash', summary: 'ls', detail: 'ls', agentId: null, blockedBy }),
  })
}

test('the mod API refuses a missing or wrong key', async () => {
  assert.equal((await fetch(`${base}/api/mod/poll?session=x`)).status, 401)
  assert.equal((await fetch(`${base}/api/mod/poll?session=x`, { headers: { 'x-ccc-key': 'b'.repeat(64) } })).status, 401)
})

test('the panel API refuses without the cookie', async () => {
  assert.equal((await fetch(`${base}/api/panel/state`)).status, 401)
})

test('the panel API refuses a request from another origin', async () => {
  await hello('origin')

  const response = await panel('/api/panel/sessions/origin/messages', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ text: 'hi' }),
  })

  assert.equal(response.status, 401)
})

test('a foreign Host header is refused', async () => {
  const response = await new Promise<number>((done, fail) => {
    import('node:http').then(({ request }) => {
      const call = request({ host: '127.0.0.1', port, path: '/api/panel/state', headers: { host: 'evil.example' } }, res => done(res.statusCode ?? 0))

      call.on('error', fail)
      call.end()
    })
  })

  assert.equal(response, 403)
})

test('the page sets an HttpOnly cookie for a valid key and refuses without one', async () => {
  const refused = await fetch(`${base}/`)
  const granted = await fetch(`${base}/?key=${KEY}`, { redirect: 'manual' })

  assert.equal(refused.status, 401)
  assert.equal(granted.status, 303)
  assert.match(granted.headers.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict/)
  assert.equal(granted.headers.get('location'), '/')
})

test('the WebSocket refuses a wrong origin and accepts the panel', async () => {
  const connect = (origin: string) =>
    new Promise<string>(done => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `ccc_key=${KEY}`, origin } })

      socket.on('open', () => {
        socket.close()
        done('open')
      })
      socket.on('error', () => done('refused'))
    })

  assert.equal(await connect('https://evil.example'), 'refused')
  assert.equal(await connect(base), 'open')
})

test('a panel message reaches the session once, in order', async () => {
  await hello('order')

  for (const text of ['one', 'two']) {
    await panel('/api/panel/sessions/order/messages', { method: 'POST', body: JSON.stringify({ text }) })
  }

  const poll = async () => ((await (await mod('/api/mod/poll?session=order')).json()) as { commands: { text: string }[] }).commands

  assert.deepEqual((await poll()).map(item => item.text), ['one'])
  assert.deepEqual((await poll()).map(item => item.text), ['two'])
  assert.deepEqual(await poll(), [])
})

test('an empty panel message is refused', async () => {
  await hello('empty')

  const response = await panel('/api/panel/sessions/empty/messages', { method: 'POST', body: JSON.stringify({ text: '   ' }) })

  assert.equal(response.status, 422)
})

test('a dropped message keeps its reason', async () => {
  await hello('drop')
  await panel('/api/panel/sessions/drop/messages', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })

  const { commands } = (await (await mod('/api/mod/poll?session=drop')).json()) as { commands: { id: string }[] }

  await mod(`/api/mod/commands/${commands[0]?.id}`, { method: 'POST', body: JSON.stringify({ status: 'dropped', reason: 'stopped' }) })

  const { outbox } = (await (await panel('/api/panel/sessions/drop/rows')).json()) as { outbox: { status: string; reason: string }[] }

  assert.deepEqual([outbox[0]?.status, outbox[0]?.reason], ['dropped', 'stopped'])
})

const poll = async (session: string, idle: string) =>
  ((await (await mod(`/api/mod/poll?session=${session}${idle}`)).json()) as { commands: { id: string; kind: string; text: string }[] }).commands

test('a message waits on the server while the session is busy', async () => {
  await hello('busy')
  await panel('/api/panel/sessions/busy/messages', { method: 'POST', body: JSON.stringify({ text: 'wait' }) })

  assert.deepEqual(await poll('busy', '&idle=0'), [])
  assert.equal(store.outboxFor('busy', 1)[0]?.status, 'queued')
  assert.deepEqual((await poll('busy', '&idle=1')).map(item => item.text), ['wait'])
})

test('a heartbeat without claiming keeps the session alive and hands out nothing', async () => {
  await hello('beat')
  await panel('/api/panel/sessions/beat/messages', { method: 'POST', body: JSON.stringify({ text: 'later' }) })

  const session = store.sessions.get('beat') as { lastSeenAt: number }

  session.lastSeenAt = 1

  assert.deepEqual(await poll('beat', '&idle=1&claim=0'), [])
  assert.notEqual(session.lastSeenAt, 1)
  assert.equal(store.outboxFor('beat', 1)[0]?.status, 'queued')
  assert.deepEqual((await poll('beat', '&idle=1&claim=1')).map(item => item.text), ['later'])
})

test('an abort does not wait for a free session', async () => {
  await hello('stopping')
  await panel('/api/panel/sessions/stopping/abort', { method: 'POST', body: '{}' })

  assert.deepEqual((await poll('stopping', '&idle=0')).map(item => item.kind), ['abort'])
})

test('a queued message can be cancelled, one on its way cannot', async () => {
  await hello('cancel')

  const queued = (await (await panel('/api/panel/sessions/cancel/messages', { method: 'POST', body: JSON.stringify({ text: 'a' }) })).json()) as { item: { id: string } }

  await panel('/api/panel/sessions/cancel/messages', { method: 'POST', body: JSON.stringify({ text: 'b' }) })

  assert.equal((await panel(`/api/panel/outbox/${queued.item.id}/cancel`, { method: 'POST', body: '{}' })).status, 200)
  assert.deepEqual((await poll('cancel', '&idle=1')).map(item => item.text), ['b'])

  const taken = store.outboxFor('cancel', 1)[0]

  assert.equal((await panel(`/api/panel/outbox/${taken?.id}/cancel`, { method: 'POST', body: '{}' })).status, 409)
})

for (const mode of ['inject', 'interrupt']) {
  test(`a forced message (${mode}) does not wait and goes first`, async () => {
    const id = `force-${mode}`

    await hello(id)
    await panel(`/api/panel/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'first' }) })

    const forced = (await (await panel(`/api/panel/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'urgent' }) })).json()) as { item: { id: string } }

    await panel(`/api/panel/outbox/${forced.item.id}/force`, { method: 'POST', body: JSON.stringify({ mode }) })

    assert.deepEqual((await poll(id, '&idle=0')).map(item => [item.kind, item.text]), [[mode, 'urgent']])
    assert.deepEqual(await poll(id, '&idle=0'), [])
  })
}

test('an older mod never receives a forced message and keeps its old behaviour', async () => {
  await hello('oldmod')

  const forced = (await (await panel('/api/panel/sessions/oldmod/messages', { method: 'POST', body: JSON.stringify({ text: 'x' }) })).json()) as { item: { id: string } }

  await panel(`/api/panel/outbox/${forced.item.id}/force`, { method: 'POST', body: JSON.stringify({ mode: 'interrupt' }) })

  assert.deepEqual(await poll('oldmod', ''), [])

  await panel('/api/panel/sessions/oldmod/messages', { method: 'POST', body: JSON.stringify({ text: 'plain' }) })

  assert.deepEqual((await poll('oldmod', '')).map(item => item.text), ['plain'])
})

test('a bad force mode is refused', async () => {
  await hello('badforce')

  const item = store.enqueue('badforce', 'message', 'x', Date.now())

  assert.equal((await panel(`/api/panel/outbox/${item.id}/force`, { method: 'POST', body: JSON.stringify({ mode: 'now' }) })).status, 422)
})

test('the session commands are stored and returned', async () => {
  const list = [{ name: 'code-style', description: 'Project conventions', source: 'skill' }]

  await events('slash', [{ t: 'commands', at: Date.now(), list }])

  const { commands } = (await (await panel('/api/panel/sessions/slash/commands')).json()) as { commands: unknown }

  assert.deepEqual(commands, list)
})

test('diff and open work only for files on the changed list', async () => {
  await hello('files')
  await events('files', [{ t: 'git', at: Date.now(), branch: 'main', files: [{ path: 'a.txt', added: 0, removed: 0, isNew: true }] }])

  const outside = await panel('/api/panel/sessions/files/diff?path=../../etc/passwd')
  const openOutside = await panel('/api/panel/sessions/files/open', { method: 'POST', body: JSON.stringify({ path: 'other.txt' }) })
  const openListed = await panel('/api/panel/sessions/files/open', { method: 'POST', body: JSON.stringify({ path: 'a.txt', line: 7 }) })

  assert.equal(outside.status, 404)
  assert.equal(openOutside.status, 404)
  assert.equal(openListed.status, 200)
  assert.deepEqual(opened.at(-1), [null, '/work/repo/a.txt', 7])
})

test('a dropped message can be dismissed, a delivered one cannot', async () => {
  await hello('dismiss')
  await panel('/api/panel/sessions/dismiss/messages', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })

  const { commands } = (await (await mod('/api/mod/poll?session=dismiss')).json()) as { commands: { id: string }[] }
  const id = commands[0]?.id
  const dismiss = () => panel(`/api/panel/outbox/${id}/dismiss`, { method: 'POST', body: '{}' })

  await mod(`/api/mod/commands/${id}`, { method: 'POST', body: JSON.stringify({ status: 'delivered' }) })

  assert.equal((await dismiss()).status, 409)

  await mod(`/api/mod/commands/${id}`, { method: 'POST', body: JSON.stringify({ status: 'dropped', reason: 'stopped' }) })

  assert.equal((await dismiss()).status, 200)
  assert.equal(store.outboxFor('dismiss', 1)[0]?.status, 'dismissed')
  assert.equal((await dismiss()).status, 409)
})

test('a repeated row is stored once', async () => {
  const row = { t: 'row', at: Date.now(), uuid: 'same', door: 'prompt', role: 'user', blocks: [{ type: 'text', text: 'hello' }] }

  await events('dedupe', [row])
  await events('dedupe', [row])

  const { rows } = (await (await panel('/api/panel/sessions/dedupe/rows')).json()) as { rows: unknown[] }

  assert.equal(rows.length, 1)
})

test('a slash command row becomes a short notice, its output is skipped', async () => {
  const at = Date.now()

  await events('command', [
    { t: 'row', at, uuid: 'c1', door: 'command', role: 'user', blocks: [{ type: 'text', text: '<command-name>/clear</command-name><command-args></command-args>' }] },
    { t: 'row', at, uuid: 'c2', door: 'command', role: 'user', blocks: [{ type: 'text', text: '<local-command-stdout></local-command-stdout>' }] },
  ])

  const { rows } = (await (await panel('/api/panel/sessions/command/rows')).json()) as { rows: { kind: string; text: string }[] }

  assert.deepEqual(rows.map(row => [row.kind, row.text]), [['notice', '/clear']])
})

test('engine notes that reach the conversation are not shown as messages between sessions', async () => {
  const delivery = (uuid: string, text: string) => ({ t: 'row', at: Date.now(), uuid, door: 'delivery', role: 'user', blocks: [{ type: 'text', text }] })

  await events('notes', [
    delivery('n1', '<system-reminder>\n<task-notification>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>\n</system-reminder>'),
    delivery('n2', '<system-reminder>The user sent a new message</system-reminder>'),
    delivery('n3', '<cross-session-message from-name="a">hi</cross-session-message>'),
    delivery('n4', 'plain delivery'),
  ])

  const { rows } = (await (await panel('/api/panel/sessions/notes/rows')).json()) as { rows: { kind: string; text: string }[] }

  assert.deepEqual(rows.map(row => [row.kind, row.text]), [
    ['notice', 'Фонове завдання: Background command "x" completed (exit code 0)'],
    ['peer', 'plain delivery'],
  ])
})

test('a task notification that starts a turn is a quiet line, not a message from the person', async () => {
  const text = '<task-notification>\n<task-id>x</task-id>\n<summary>Background command "y" completed</summary>\n</task-notification>'

  await events('tasknote', [
    { t: 'prompt', at: Date.now(), text, origin: 'task-notification' },
    { t: 'row', at: Date.now(), uuid: 'tn', door: 'prompt', role: 'user', blocks: [{ type: 'text', text }] },
  ])

  const { rows } = (await (await panel('/api/panel/sessions/tasknote/rows')).json()) as { rows: { kind: string; text: string }[] }
  const session = store.sessions.get('tasknote')

  assert.deepEqual(rows.map(row => [row.kind, row.text]), [['notice', 'Фонове завдання: Background command "y" completed']])
  assert.deepEqual([session?.firstPrompt, session?.lastUserAt], [null, null])
})

test('tests stopped by the person are not reported as failed', async () => {
  const at = Date.now()

  await events('stopped-tests', [
    { t: 'turn_start', at, turnId: 'x' },
    { t: 'tool_start', at: at + 1, id: 's1', tool: 'Bash', summary: 'npm test' },
    { t: 'tool_end', at: at + 2, id: 's1', tool: 'Bash', summary: 'npm test', isError: true, denied: false },
    { t: 'turn_complete', at: at + 3, reason: 'aborted' },
  ])

  const session = store.sessions.get('stopped-tests')

  assert.deepEqual([session?.tests?.failed, session?.work.testFailures, session?.cycle.tests], [null, 0, null])
})

test('tests that really failed stay failed when the turn is stopped later', async () => {
  const at = Date.now()

  await events('real-fail', [
    { t: 'turn_start', at, turnId: 'x' },
    { t: 'tool_start', at: at + 1, id: 'f1', tool: 'Bash', summary: 'npm test' },
    { t: 'tool_end', at: at + 2, id: 'f1', tool: 'Bash', summary: 'npm test', isError: true, denied: false, tail: 'Tests: 4, Assertions: 4, Failures: 1.\n' },
    { t: 'turn_complete', at: at + 3, reason: 'aborted' },
  ])

  assert.equal(store.sessions.get('real-fail')?.tests?.failed, true)
})

test('a long poll wakes as soon as the panel answers', async () => {
  await createAsk('wait', 'ask-wait')

  const waiting = mod('/api/mod/asks/ask-wait/wait?ms=5000').then(response => response.json()) as Promise<{ ask: { status: string; answer: { decision: string } } }>

  await panel('/api/panel/asks/ask-wait/answer', { method: 'POST', body: JSON.stringify({ decision: 'allow' }) })

  const { ask } = await waiting

  assert.deepEqual([ask.status, ask.answer.decision], ['answered', 'allow'])
})

test('a second answer gets 409', async () => {
  await createAsk('twice', 'ask-twice')
  await panel('/api/panel/asks/ask-twice/answer', { method: 'POST', body: JSON.stringify({ decision: 'deny' }) })

  const response = await panel('/api/panel/asks/ask-twice/answer', { method: 'POST', body: JSON.stringify({ decision: 'allow' }) })

  assert.equal(response.status, 409)
})

test('the panel cannot answer an ask a settings rule raised', async () => {
  await createAsk('rule', 'ask-rule', 'Bash(rm:*)')

  const response = await panel('/api/panel/asks/ask-rule/answer', { method: 'POST', body: JSON.stringify({ decision: 'allow' }) })

  assert.equal(response.status, 403)
  assert.equal(store.ask('ask-rule')?.status, 'pending')
})

test('the end of a main turn closes its open asks', async () => {
  await createAsk('turn', 'ask-turn')
  await events('turn', [{ t: 'turn_complete', at: Date.now(), reason: 'answer' }])

  assert.equal(store.ask('ask-turn')?.status, 'terminal')
})

test('test commands drive the run, a failing exit marks it failed', async () => {
  const at = Date.now()

  await events('tests', [{ t: 'tool_start', at, id: 't1', tool: 'Bash', summary: 'npm test' }])

  const running = store.sessions.get('tests')

  assert.equal(running?.tests?.endedAt, null)

  await events('tests', [{ t: 'tool_end', at: at + 5, id: 't1', tool: 'Bash', summary: 'npm test', isError: true, denied: false }])

  assert.deepEqual([store.sessions.get('tests')?.tests?.failed, store.testRuns(50).some(run => run.id === 't1')], [true, true])
})

test('the result of a piped test command still counts as failed', async () => {
  const at = Date.now()
  const tail = '{"tool":"phpunit","result":"failed","tests":4,"passed":3,"failed":1}'

  await events('piped', [{ t: 'tool_start', at, id: 'p1', tool: 'Bash', summary: 'npm test' }])
  await events('piped', [{ t: 'tool_end', at: at + 5, id: 'p1', tool: 'Bash', summary: 'npm test', isError: false, denied: false, tail }])

  const run = store.sessions.get('piped')?.tests

  assert.deepEqual([run?.failed, run?.progress?.total, run?.progress?.failed], [true, 4, 1])
})

test('a repeated test command expects the duration of the previous run', async () => {
  const at = Date.now()

  await hello('repeat')
  await events('repeat', [{ t: 'tool_start', at, id: 'e1', tool: 'Bash', summary: 'npm test' }])
  await events('repeat', [{ t: 'tool_end', at: at + 4000, id: 'e1', tool: 'Bash', summary: 'npm test', isError: false, denied: false }])
  await events('repeat', [{ t: 'tool_start', at: at + 5000, id: 'e2', tool: 'Bash', summary: 'npm test' }])

  assert.equal(store.sessions.get('repeat')?.tests?.expectedMs, 4000)
})

const tool = (id: string, name: string, summary: string, at: number, extra: object = {}) => [
  { t: 'tool_start', at, id, tool: name, summary },
  { t: 'tool_end', at: at + 1, id, tool: name, summary, isError: false, denied: false, ...extra },
]

test('work is counted and a commit closes the task until the next request', async () => {
  const at = Date.now()

  await events('cycle', [
    ...tool('r', 'Read', 'a.php', at),
    ...tool('e', 'Edit', 'a.php', at),
    ...tool('e2', 'Edit', 'a.php', at),
    ...tool('w', 'Write', 'b.php', at),
    ...tool('l', 'Bash', 'ls', at, { isReadOnly: true }),
    ...tool('b', 'Bash', 'composer install', at, { isReadOnly: false }),
  ])

  const before = store.sessions.get('cycle')

  assert.deepEqual([before?.work.reads, before?.work.edits, before?.work.editedPaths.length, before?.work.commands], [1, 3, 2, 1])
  assert.deepEqual([before?.cycle.changes, before?.cycle.isCommitted], [4, false])

  await events('cycle', tool('c', 'Bash', "git add -A && git commit -m 'Add rules'", at, { isReadOnly: false }))

  const committed = store.sessions.get('cycle')

  assert.deepEqual([committed?.work.commits, committed?.work.lastCommit?.message, committed?.cycle.isCommitted], [1, 'Add rules', true])

  await events('cycle', [{ t: 'prompt', at: at + 10, text: 'наступне завдання', origin: 'composer' }])

  const next = store.sessions.get('cycle')

  assert.deepEqual([next?.cycle.changes, next?.cycle.isCommitted, next?.work.edits], [0, false, 3])
})

test('a commit with a failed exit does not close the task', async () => {
  const at = Date.now()

  await events('nocommit', [
    { t: 'tool_start', at, id: 'c', tool: 'Bash', summary: 'git commit -m x' },
    { t: 'tool_end', at, id: 'c', tool: 'Bash', summary: 'git commit -m x', isError: true, denied: false },
  ])

  assert.equal(store.sessions.get('nocommit')?.cycle.isCommitted, false)
})

test('a pull request link is kept', async () => {
  await events('pr', tool('p', 'Bash', 'gh pr create --fill', Date.now(), { tail: 'https://github.com/o/r/pull/12\n' }))

  const session = store.sessions.get('pr')

  assert.deepEqual([session?.work.pullRequests, session?.cycle.isCommitted], [['https://github.com/o/r/pull/12'], true])
})

test('failed test runs are counted', async () => {
  const at = Date.now()

  await events('runs', [
    { t: 'tool_start', at, id: 't1', tool: 'Bash', summary: 'npm test' },
    { t: 'tool_end', at: at + 1, id: 't1', tool: 'Bash', summary: 'npm test', isError: true, denied: false },
    { t: 'tool_start', at: at + 2, id: 't2', tool: 'Bash', summary: 'npm test' },
    { t: 'tool_end', at: at + 3, id: 't2', tool: 'Bash', summary: 'npm test', isError: false, denied: false },
  ])

  const session = store.sessions.get('runs')

  assert.deepEqual([session?.work.testRuns, session?.work.testFailures, session?.cycle.tests], [2, 1, 'passed'])
})

test('the model choice stays on the server and reaches the session with its poll', async () => {
  await hello('picker')

  const saved = await panel('/api/panel/sessions/picker/model', { method: 'POST', body: JSON.stringify({ model: 'sonnet', effort: 'high' }) })
  const { override } = (await (await mod('/api/mod/poll?session=picker')).json()) as { override: unknown }

  assert.equal(saved.status, 200)
  assert.deepEqual(override, { model: 'sonnet', effort: 'high' })
})

test('an unknown model or effort is refused', async () => {
  await hello('badpick')

  for (const body of [{ model: 'gpt' }, { effort: 'turbo' }]) {
    assert.equal((await panel('/api/panel/sessions/badpick/model', { method: 'POST', body: JSON.stringify(body) })).status, 422)
  }

  assert.deepEqual(store.sessions.get('badpick')?.override, { model: null, effort: null })
})

test('the session reports the model it really uses', async () => {
  await events('used', [{ t: 'model', at: Date.now(), model: 'claude-sonnet-5-5', effort: 'high' }])

  const session = store.sessions.get('used')

  assert.deepEqual([session?.model, session?.effort], ['claude-sonnet-5-5', 'high'])
})

test('rename changes the panel name at once and sends the slash command, on one line', async () => {
  await hello('rename')

  const response = await panel('/api/panel/sessions/rename/rename', {
    method: 'POST',
    body: JSON.stringify({ name: '  Правки\n панелі ' }),
  })
  const { commands } = (await (await mod('/api/mod/poll?session=rename')).json()) as { commands: { kind: string; text: string }[] }

  assert.equal(response.status, 200)
  assert.equal(store.sessions.get('rename')?.name, 'Правки панелі')
  assert.deepEqual([commands[0]?.kind, commands[0]?.text], ['message', '/rename Правки панелі'])
})

function registryEntry(pid: number, sessionId: string, status: string): RegistryEntry {
  return { pid, sessionId, cwd: '', name: null, nameSource: null, kind: null, entrypoint: null, status, startedAt: 0, isAlive: true }
}

test('a refused exit ends a free session through its process, checked against the registry', async () => {
  const child = spawn('sleep', ['30'])
  const exited = new Promise(done => child.once('exit', (_code, signal) => done(signal)))

  registryEntries = [registryEntry(child.pid as number, 'stopped', 'idle')]

  await hello('stopped')
  await panel('/api/panel/sessions/stopped/close', { method: 'POST', body: '{}' })

  const { commands } = (await (await mod('/api/mod/poll?session=stopped')).json()) as { commands: { id: string }[] }

  await mod(`/api/mod/commands/${commands[0]?.id}`, { method: 'POST', body: JSON.stringify({ status: 'dropped', reason: 'stopped' }) })

  assert.equal(await exited, 'SIGTERM')
  assert.equal(store.outboxFor('stopped', 1)[0]?.status, 'delivered')

  registryEntries = []
})

for (const [label, status, turn] of [
  ['the registry says it is busy', 'busy', false],
  ['a turn is running', 'idle', true],
] as const) {
  test(`a refused exit leaves the session alone when ${label}`, async () => {
    const child = spawn('sleep', ['30'])
    const id = `busy-${status}`

    registryEntries = [registryEntry(child.pid as number, id, status)]

    await hello(id)

    if (turn) {
      await events(id, [{ t: 'turn_start', at: Date.now(), turnId: 'running' }])
    }

    await panel(`/api/panel/sessions/${id}/close`, { method: 'POST', body: '{}' })

    const { commands } = (await (await mod(`/api/mod/poll?session=${id}`)).json()) as { commands: { id: string }[] }

    await mod(`/api/mod/commands/${commands[0]?.id}`, { method: 'POST', body: JSON.stringify({ status: 'dropped', reason: 'old mod' }) })
    await new Promise(done => setTimeout(done, 100))

    assert.equal(child.exitCode === null && child.signalCode === null, true)
    assert.deepEqual([store.outboxFor(id, 1)[0]?.status, store.outboxFor(id, 1)[0]?.reason], ['dropped', 'old mod'])

    child.kill()
    registryEntries = []
  })
}

test('a refused ordinary message never ends a session', async () => {
  const child = spawn('sleep', ['30'])

  registryEntries = [registryEntry(child.pid as number, 'keep', 'idle')]

  await hello('keep')
  await panel('/api/panel/sessions/keep/messages', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })

  const { commands } = (await (await mod('/api/mod/poll?session=keep')).json()) as { commands: { id: string }[] }

  await mod(`/api/mod/commands/${commands[0]?.id}`, { method: 'POST', body: JSON.stringify({ status: 'dropped', reason: 'stopped' }) })
  await new Promise(done => setTimeout(done, 100))

  assert.equal(child.exitCode === null && child.signalCode === null, true)

  child.kill()
  registryEntries = []
})

test('an empty or too long name is refused', async () => {
  await hello('badname')

  for (const name of ['   ', 'x'.repeat(81)]) {
    const response = await panel('/api/panel/sessions/badname/rename', { method: 'POST', body: JSON.stringify({ name }) })

    assert.equal(response.status, 422)
  }

  const { commands } = (await (await mod('/api/mod/poll?session=badname')).json()) as { commands: unknown[] }

  assert.deepEqual(commands, [])
})

test('close reaches the session as the exit command', async () => {
  await hello('close')

  await panel('/api/panel/sessions/close/close', { method: 'POST', body: '{}' })

  const { commands } = (await (await mod('/api/mod/poll?session=close')).json()) as { commands: { text: string }[] }

  assert.equal(commands[0]?.text, '/exit')
})

test('a closed session resumes in its own folder under its own id', async () => {
  await hello('resume-me')
  await events('resume-me', [{ t: 'session_end', at: Date.now(), reason: 'prompt_input_exit' }])

  const response = await panel('/api/panel/sessions/resume-me/resume', { method: 'POST', body: '{}' })
  const result = (await response.json()) as { id: string }

  assert.equal(response.status, 200)
  assert.equal(result.id, 'resume-m')
  assert.deepEqual(resumed.at(-1), ['/work/repo', 'resume-me'])
})

test('a session that is still open is not resumed a second time', async () => {
  await hello('open-one')

  registryEntries = [{ pid: 1, sessionId: 'open-one', cwd: '', name: null, nameSource: null, kind: null, entrypoint: null, status: 'idle', startedAt: 0, isAlive: true }]

  const before = resumed.length
  const response = await panel('/api/panel/sessions/open-one/resume', { method: 'POST', body: '{}' })

  registryEntries = []

  assert.equal(response.status, 409)
  assert.equal(resumed.length, before)
})

test('a background session closes through claude stop, not through a queued exit', async () => {
  await hello('background')

  registryEntries = [{ pid: 1, sessionId: 'background', cwd: '', name: null, nameSource: null, kind: 'bg', entrypoint: null, status: 'idle', startedAt: 0, isAlive: true }]

  const response = await panel('/api/panel/sessions/background/close', { method: 'POST', body: '{}' })
  const { commands } = (await (await mod('/api/mod/poll?session=background')).json()) as { commands: unknown[] }

  registryEntries = []

  assert.equal(response.status, 200)
  assert.deepEqual(stopped.at(-1), ['/work/repo', 'background'])
  assert.deepEqual(commands, [])
})

const TOKEN = '123456789:AAFabcdefghijklmnopqrstuvwxyz0123456'

const telegramPost = (action: string, body: object = {}) =>
  panel(`/api/panel/telegram/${action}`, { method: 'POST', body: JSON.stringify(body) })

test('telegram refuses a bad token and never saves it', async () => {
  const malformed = await telegramPost('token', { token: 'nonsense' })
  const unknown = await telegramPost('token', { token: TOKEN.replace('123456789', '401000000') })

  assert.equal(malformed.status, 422)
  assert.equal(unknown.status, 502)
  assert.equal(savedToken, null)
})

test('the main switch stays off until a bot and a chat are set', async () => {
  const response = await telegramPost('settings', { enabled: true })
  const state = (await response.json()) as { enabled: boolean }

  assert.equal(state.enabled, false)
})

test('telegram goes from a token to a test message, and the token never comes back', async () => {
  const saved = await telegramPost('token', { token: TOKEN })
  const found = (await (await telegramPost('chats')).json()) as { chats: { id: string; title: string }[] }

  await telegramPost('chat', { chatId: found.chats[0]?.id, chatTitle: found.chats[0]?.title })

  const enabled = (await (await telegramPost('settings', { enabled: true })).json()) as { enabled: boolean; isReady: boolean }

  await telegramPost('test')

  const page = await (await panel('/api/panel/telegram')).text()
  const state = await (await panel('/api/panel/state')).text()

  assert.equal(saved.status, 200)
  assert.equal(savedToken, TOKEN)
  assert.deepEqual([enabled.enabled, enabled.isReady], [true, true])
  assert.match(telegramSent.at(-1) ?? '', /^-100: Центр керування: тестове/)
  assert.equal(page.includes(TOKEN), false)
  assert.equal(state.includes(TOKEN), false)
})

test('a project switch is stored per project', async () => {
  await telegramPost('project', { repoKey: '/work/one', enabled: true })
  await telegramPost('project', { repoKey: '/work/two', enabled: true })

  const state = (await (await telegramPost('project', { repoKey: '/work/one', enabled: false })).json()) as { projects: string[] }

  assert.deepEqual(state.projects, ['/work/two'])
})

test('a chat id must be a number', async () => {
  assert.equal((await telegramPost('chat', { chatId: '@public' })).status, 422)
})

test('telegram settings need the panel cookie', async () => {
  const response = await fetch(`${base}/api/panel/telegram/test`, { method: 'POST', body: '{}' })

  assert.equal(response.status, 401)
})

test('forgetting the bot removes the token and turns everything off', async () => {
  await telegramPost('token', { token: TOKEN })

  const state = (await (await telegramPost('forget')).json()) as { enabled: boolean; botName: string | null; chatId: string | null }

  assert.equal(savedToken, null)
  assert.deepEqual([state.enabled, state.botName, state.chatId], [false, null, null])
})

test('there is no help route any more', async () => {
  await hello('nohelp')

  const response = await panel('/api/panel/sessions/nohelp/help', { method: 'POST', body: JSON.stringify({ helperId: 'x', text: 'y' }) })

  assert.equal(response.status, 404)
})

test('a background session starts only in a known folder', async () => {
  const response = await panel('/api/panel/background-sessions', {
    method: 'POST',
    body: JSON.stringify({ cwd: '/etc', prompt: 'hello' }),
  })

  assert.equal(response.status, 422)
})

type AlertMessage = { type: string; alert?: { id: string; sessionId: string | null; event: string } }

function openSocket(): Promise<{ socket: WebSocket; messages: AlertMessage[] }> {
  return new Promise((done, fail) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `ccc_key=${KEY}`, origin: base } })
    const messages: AlertMessage[] = []

    socket.on('message', data => messages.push(JSON.parse(String(data)) as AlertMessage))
    socket.on('open', () => done({ socket, messages }))
    socket.on('error', fail)
  })
}

async function waitFor<T>(read: () => Promise<T> | T, isDone: (value: T) => boolean, ms = 4000): Promise<T> {
  const started = Date.now()
  let value = await read()

  while (!isDone(value) && Date.now() - started < ms) {
    await new Promise(done => setTimeout(done, 50))
    value = await read()
  }

  return value
}

const waitForTick = () => new Promise(done => setTimeout(done, 1100))

const macAlerts = async () =>
  (await (await panel('/api/panel/mac-alerts')).json()) as { enabled: boolean; events: Record<string, boolean>; isAppRunning: boolean }

const unreadAlerts = async () =>
  ((await (await panel('/api/panel/state')).json()) as { alerts: { id: string; sessionId: string | null }[] }).alerts

test('the mac app says hello and the panel sees it running', async () => {
  const { socket } = await openSocket()

  assert.equal((await macAlerts()).isAppRunning, false)

  socket.send(JSON.stringify({ type: 'hello', client: 'mac-app' }))
  assert.equal((await waitFor(macAlerts, view => view.isAppRunning)).isAppRunning, true)

  socket.close()
  assert.equal((await waitFor(macAlerts, view => !view.isAppRunning)).isAppRunning, false)
})

test('a new ask reaches the socket as an alert and stays unread', async () => {
  const { socket, messages } = await openSocket()

  socket.send('not json')
  await waitForTick()
  await createAsk('alerted', 'ask-alerted')

  const found = await waitFor(
    () => messages.find(message => message.type === 'alert' && message.alert?.sessionId === 'alerted'),
    message => message !== undefined,
  )

  assert.equal(found?.alert?.event, 'permission')
  assert.ok((await unreadAlerts()).some(alert => alert.id === found?.alert?.id))
  socket.close()
})

test('a session in view raises no alert and its old alerts are read', async () => {
  const { socket, messages } = await openSocket()

  socket.send(JSON.stringify({ type: 'viewing', sessionId: 'viewed', isVisible: true }))
  await new Promise(done => setTimeout(done, 100))
  await createAsk('viewed', 'ask-viewed')
  await createAsk('later', 'ask-later')

  await waitFor(
    () => messages.find(message => message.alert?.sessionId === 'later'),
    message => message !== undefined,
  )
  assert.equal(messages.some(message => message.alert?.sessionId === 'viewed'), false)

  socket.send(JSON.stringify({ type: 'viewing', sessionId: 'later', isVisible: true }))

  const unread = await waitFor(unreadAlerts, list => !list.some(alert => alert.sessionId === 'later'))

  assert.equal(unread.some(alert => alert.sessionId === 'later'), false)
  socket.close()
})

test('mac alert settings keep only known switches', async () => {
  const response = await panel('/api/panel/mac-alerts', {
    method: 'POST',
    body: JSON.stringify({ events: { done: false, nope: true, limit: 'yes' } }),
  })
  const view = (await response.json()) as { events: Record<string, unknown> }

  assert.equal(response.status, 200)
  assert.equal(view.events.done, false)
  assert.equal(view.events.limit, false)
  assert.equal('nope' in view.events, false)

  await panel('/api/panel/mac-alerts', { method: 'POST', body: JSON.stringify({ events: { done: true } }) })
})

const uploadHeaders = { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('Знімок екрана.png') }

test('an uploaded file is saved for the session and served back', async () => {
  await hello('upload')

  const response = await panel('/api/panel/sessions/upload/uploads', { method: 'POST', body: 'png bytes', headers: uploadHeaders })
  const { upload } = (await response.json()) as { upload: { path: string; url: string; isImage: boolean; name: string } }
  const served = await panel(upload.url)

  assert.equal(response.status, 200)
  assert.equal(upload.path.startsWith(join(uploadsRoot, 'upload') + '/'), true)
  assert.equal(upload.name, 'Знімок_екрана.png')
  assert.equal(upload.isImage, true)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(await served.text(), 'png bytes')
  assert.equal((await fetch(`${base}${upload.url}`)).status, 401)
})

test('uploads over the limit, of unknown sessions or outside the folder are refused', async () => {
  await hello('upload')

  const big = await panel('/api/panel/sessions/upload/uploads', { method: 'POST', body: 'x'.repeat(2048), headers: uploadHeaders })
  const unknown = await panel('/api/panel/sessions/nobody/uploads', { method: 'POST', body: 'x', headers: uploadHeaders })
  const escape = await panel('/api/panel/uploads/upload/..%2F..%2Fconfig.json')

  assert.equal(big.status, 413)
  assert.equal(unknown.status, 404)
  assert.equal(escape.status, 404)
})

const helloWithMod = (sessionId: string, modVersion: string) =>
  events(sessionId, [{ t: 'hello', at: Date.now(), cwd: '/work/repo', repoRoot: '/work/repo', model: 'm', surfaces: ['terminal'], modVersion }])

const sendText = (sessionId: string, text: string) =>
  panel(`/api/panel/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })

const pollCommands = async (sessionId: string, idle: 0 | 1) =>
  ((await (await mod(`/api/mod/poll?session=${sessionId}&idle=${idle}`)).json()) as { commands: { kind: string; text: string }[] }).commands

test('a message that starts with ! goes out as a shell command once the session is free', async () => {
  await helloWithMod('shell', '0.8.0')

  const response = await sendText('shell', '!  ls -la ')
  const { item } = (await response.json()) as { item: { kind: string; text: string } }

  assert.equal(response.status, 200)
  assert.deepEqual([item.kind, item.text], ['bash', 'ls -la'])
  assert.deepEqual(await pollCommands('shell', 0), [])
  assert.deepEqual((await pollCommands('shell', 1)).map(command => [command.kind, command.text]), [['bash', 'ls -la']])
})

test('shell commands keep their place among messages', async () => {
  await helloWithMod('shell-order', '0.8.0')
  await sendText('shell-order', 'first')
  await sendText('shell-order', '!git status')

  assert.deepEqual((await pollCommands('shell-order', 1)).map(command => command.kind), ['message'])
  assert.deepEqual((await pollCommands('shell-order', 1)).map(command => command.kind), ['bash'])
})

test('a shell command to an older mod or without a command is refused', async () => {
  await helloWithMod('shell-old', '0.7.0')

  const old = await sendText('shell-old', '!ls')
  const empty = await sendText('shell', '!   ')

  assert.equal(old.status, 409)
  assert.deepEqual(await old.json(), { error: 'mod_outdated' })
  assert.equal(empty.status, 422)
  assert.deepEqual(await empty.json(), { error: 'empty_command' })
})
