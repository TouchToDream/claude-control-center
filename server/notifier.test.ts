import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'
import { blankSession } from './ingest.ts'
import { Notifier } from './notifier.ts'
import type { SessionWithStatus } from './notifier.ts'
import { Store } from './store.ts'
import { chatsFromUpdates, TelegramError } from './telegram.ts'
import type { TelegramApi } from './telegram.ts'
import type { Ask, RateLimit, SessionState, Status } from './types.ts'

const NOW = 100_000_000
const REPO = '/work/my-api'
const WAIT = 45_000

type Sent = { chatId: string; text: string; isSilent: boolean }

let sent: Sent[]
let store: Store
let notifier: Notifier
let failWith: Error | null

const api: TelegramApi = {
  getBotName: async () => 'bot',
  findChats: async () => [],
  send: async (_token, chatId, text, isSilent) => {
    if (failWith !== null) {
      throw failWith
    }

    sent.push({ chatId, text, isSilent })
  },
}

function session(status: Status, changes: Partial<SessionState> = {}): SessionWithStatus {
  return {
    ...blankSession('s1', NOW),
    repoRoot: REPO,
    repoName: 'my-api',
    name: 'Панель',
    branch: 'TASK-1',
    status,
    ...changes,
  }
}

function ask(id: string, tool = 'Bash', kind: Ask['kind'] = 'permission'): Ask {
  return { id, sessionId: 's1', kind, tool, summary: '', detail: '', agentId: null, answerable: true, blockedBy: null, status: 'pending', answer: null, createdAt: NOW, updatedAt: NOW }
}

async function settle(): Promise<void> {
  await new Promise(done => setImmediate(done))
}

async function tick(at: number, sessions: SessionWithStatus[], asks: Ask[] = [], limits: RateLimit[] = []): Promise<void> {
  notifier.tick(at, sessions, asks, limits)
  await settle()
}

beforeEach(() => {
  sent = []
  failWith = null
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ccc-notify-')), 'test.sqlite'))
  notifier = new Notifier({
    store,
    api,
    secrets: { readToken: async () => 'token', writeToken: async () => {}, deleteToken: async () => {} },
  })
  notifier.update({ enabled: true, chatId: '-100', botName: 'bot', projects: [REPO] })
})

const longTurn = { lastTurnStartAt: NOW - 12 * 60_000, lastTurnEndAt: NOW, turnEndReason: 'answer' }

test('a long finished turn is sent quietly after the wait, in the agreed form', async () => {
  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('waiting', { ...longTurn, files: [{ path: 'a', added: 1, removed: 0, isNew: false }] })])

  assert.equal(sent.length, 0)

  await tick(NOW + 1000 + WAIT, [session('waiting', longTurn)])

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.isSilent, true)
  assert.equal(
    sent[0]?.text,
    'Проєкт: my-api\nСесія: Панель\nСтатус: завершила роботу\nГілка TASK-1 · працювала 12 хв · змінено файлів: 1',
  )
})

test('a short turn is not worth a message', async () => {
  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('chat', { lastTurnStartAt: NOW - 30_000, lastTurnEndAt: NOW, turnEndReason: 'answer' })])
  await tick(NOW + 2000 + WAIT, [session('chat')])

  assert.deepEqual(sent, [])
})

test('a finished turn is dropped when the person already went on', async () => {
  await tick(NOW, [session('work')])

  const finished = session('waiting', longTurn)

  await tick(NOW + 1000, [finished])

  finished.turnId = 'next'

  await tick(NOW + 1000 + WAIT, [finished])

  assert.deepEqual(sent, [])
})

test('an ask is loud and waits, so an answer in time sends nothing', async () => {
  const pending = store.createAsk({ ...ask('a1'), answerable: true }, NOW)
  const answered = store.createAsk({ ...ask('a2'), answerable: true }, NOW)

  await tick(NOW, [session('chat')])
  await tick(NOW + 1000, [session('ask')], [pending, answered])

  store.closeAsk('a2', 'answered', { decision: 'allow' }, NOW + 2000)

  await tick(NOW + 1000 + WAIT, [session('ask')], [pending])

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.isSilent, false)
  assert.match(sent[0]?.text ?? '', /Статус: чекає на відповідь \(дозвіл на Bash\)/)
})

test('questions and plans have their own words', async () => {
  const question = store.createAsk({ ...ask('q', 'AskUserQuestion', 'question'), answerable: true }, NOW)
  const plan = store.createAsk({ ...ask('p', 'ExitPlanMode'), answerable: false }, NOW)

  await tick(NOW, [session('chat')])
  await tick(NOW + 1000, [session('ask')], [question, plan])
  await tick(NOW + 1000 + WAIT, [session('ask')], [question, plan])

  assert.match(sent[0]?.text ?? '', /\(питання\)/)
  assert.match(sent[0]?.text ?? '', /\(план\)/)
})

test('events due together arrive as one message, loud if any is loud', async () => {
  const run = { id: 'r1', sessionId: 's1', repoRoot: REPO, command: 'npm test', expectedMs: null, startedAt: NOW, endedAt: NOW + 5000, failed: true, progress: null }

  await tick(NOW, [session('tests', { tests: { ...run, endedAt: null, failed: null } })])
  await tick(NOW + 6000, [session('fail', { tests: run, turnError: true })])

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.isSilent, false)
  assert.match(sent[0]?.text ?? '', /тести впали/)
  assert.match(sent[0]?.text ?? '', /хід завершився помилкою/)
})

test('test results carry their counts', async () => {
  const progress = { runner: 'phpunit', unit: 'tests' as const, total: 200, done: 200, failed: 3, suites: [], updatedAt: NOW }
  const running = { id: 'r2', sessionId: 's1', repoRoot: REPO, command: 'phpunit', expectedMs: null, startedAt: NOW, endedAt: null, failed: null, progress: null }

  await tick(NOW, [session('tests', { tests: running })])
  await tick(NOW + 90_000, [session('fail', { tests: { ...running, endedAt: NOW + 90_000, failed: true, progress } })])

  assert.match(sent[0]?.text ?? '', /Статус: тести впали \(упало 3 з 200\)/)
  assert.match(sent[0]?.text ?? '', /працювала 2 хв/)
})

test('passed tests are quiet', async () => {
  const running = { id: 'r3', sessionId: 's1', repoRoot: REPO, command: 'phpunit', expectedMs: null, startedAt: NOW, endedAt: null, failed: null, progress: null }

  await tick(NOW, [session('tests', { tests: running })])
  await tick(NOW + 5000, [session('chat', { tests: { ...running, endedAt: NOW + 5000, failed: false } })])

  assert.equal(sent[0]?.isSilent, true)
})

test('a process lost during work is reported, a quiet close is not', async () => {
  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('offline', { endedAt: NOW + 1000, endReason: 'process_gone' })])

  assert.match(sent[0]?.text ?? '', /сесія несподівано закрилася/)

  sent = []
  notifier = new Notifier({ store, api, secrets: { readToken: async () => 't', writeToken: async () => {}, deleteToken: async () => {} } })

  await tick(NOW, [session('chat')])
  await tick(NOW + 1000, [session('offline', { endedAt: NOW + 1000, endReason: 'process_gone' })])

  assert.deepEqual(sent, [])
})

test('nothing is sent while the main switch is off', async () => {
  notifier.update({ enabled: false })

  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('fail', { turnError: true })])

  assert.deepEqual(sent, [])
})

test('nothing is sent for a project without the switch, even if it was queued before', async () => {
  const pending = store.createAsk({ ...ask('a3'), answerable: true }, NOW)

  await tick(NOW, [session('chat')])
  await tick(NOW + 1000, [session('ask')], [pending])

  notifier.setProject(REPO, false)

  await tick(NOW + 1000 + WAIT, [session('ask')], [pending])

  assert.deepEqual(sent, [])
})

test('a project is off until it is switched on', async () => {
  notifier.update({ projects: [] })

  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('fail', { turnError: true })])

  assert.deepEqual(sent, [])
})

test('an event type can be switched off', async () => {
  const { events } = notifier.settings()

  notifier.update({ events: { ...events, turnError: false } })

  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('fail', { turnError: true })])

  assert.deepEqual(sent, [])
})

test('what happened before the service started is not news', async () => {
  const pending = store.createAsk({ ...ask('old'), answerable: true }, NOW)

  await tick(NOW, [session('ask', { turnError: true })], [pending])
  await tick(NOW + WAIT + 1000, [session('ask', { turnError: true })], [pending])

  assert.deepEqual(sent, [])
})

test('a limit reports each level once per window', async () => {
  const limit = (percentUsed: number, resetsAt = 'w1'): RateLimit[] => [{ kind: 'five_hour', percentUsed, resetsAt }]

  await tick(NOW, [], [], limit(10))
  await tick(NOW + 1000, [], [], limit(82))
  await tick(NOW + 2000, [], [], limit(83))
  await tick(NOW + 3000, [], [], limit(96))
  await tick(NOW + 4000, [], [], limit(97))
  await tick(NOW + 5000, [], [], limit(81, 'w2'))

  assert.deepEqual(sent.map(item => item.text), [
    'Ліміт 5 годин: використано 82%',
    'Ліміт 5 годин: використано 96%',
    'Ліміт 5 годин: використано 81%',
  ])
})

test('a refused send keeps the reason and waits as Telegram asks', async () => {
  failWith = new TelegramError('Too Many Requests', 30)

  await tick(NOW, [session('work')])
  await tick(NOW + 1000, [session('fail', { turnError: true })])

  assert.equal(notifier.view().lastError, 'Too Many Requests')

  failWith = null

  await tick(NOW + 2000, [session('fail', { turnError: true })])

  assert.deepEqual(sent, [])

  await tick(NOW + 32_000, [session('fail', { turnError: true })])

  assert.equal(sent.length, 1)
  assert.equal(notifier.view().lastError, null)
})

test('chats are read from every kind of update', () => {
  const chats = chatsFromUpdates([
    { update_id: 1, message: { chat: { id: 5, first_name: 'Oleksii', type: 'private' } } },
    { update_id: 2, my_chat_member: { chat: { id: -100, title: 'Claude', type: 'supergroup' } } },
    { update_id: 3, channel_post: { chat: { id: -200, title: 'Канал', type: 'channel' } } },
    { update_id: 4, message: { chat: { id: 5, first_name: 'Oleksii', type: 'private' } } },
  ])

  assert.deepEqual(chats, [
    { id: '5', title: 'Oleksii', type: 'private' },
    { id: '-100', title: 'Claude', type: 'supergroup' },
    { id: '-200', title: 'Канал', type: 'channel' },
  ])
})
