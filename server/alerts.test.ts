import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'
import { MacAlerts } from './alerts.ts'
import type { Viewing } from './alerts.ts'
import type { SessionWithStatus } from './events.ts'
import { blankSession } from './ingest.ts'
import { Store } from './store.ts'
import type { Ask, ChangedFile, RateLimit, SessionState, Status } from './types.ts'

const NOW = 100_000_000
const DAY = 24 * 60 * 60 * 1000
const NOBODY: Viewing = { sessionIds: new Set(), isAnyPanelVisible: false }

let store: Store
let alerts: MacAlerts

beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ccc-alerts-')), 'test.sqlite'))
  alerts = new MacAlerts(store)
})

function session(status: Status, changes: Partial<SessionState> = {}): SessionWithStatus {
  return { ...blankSession('s1', NOW), repoRoot: '/work/my-api', repoName: 'my-api', name: 'Панель', status, ...changes }
}

function ask(id: string, kind: Ask['kind'] = 'permission', tool = 'Bash'): Ask {
  return { id, sessionId: 's1', kind, tool, summary: '', detail: '', agentId: null, answerable: true, blockedBy: null, status: 'pending', answer: null, createdAt: NOW, updatedAt: NOW }
}

function file(path: string): ChangedFile {
  return { path, added: 1, removed: 0, isNew: false }
}

const finished = (changes: Partial<SessionState> = {}) =>
  session('chat', { lastTurnStartAt: NOW - 5000, lastTurnEndAt: NOW, turnEndReason: 'answer', ...changes })

function finishTurn(viewing: Viewing = NOBODY, changes: Partial<SessionState> = {}) {
  alerts.tick(NOW - 1000, [session('work', { lastTurnStartAt: NOW - 5000 })], [], [], viewing)

  return alerts.tick(NOW + 1000, [finished(changes)], [], [], viewing)
}

test('defaults: on, every event but limits', () => {
  assert.deepEqual(alerts.settings(), {
    enabled: true,
    events: { question: true, permission: true, done: true, turnError: true, testsFailed: true, gone: true, limit: false },
  })
})

test('a question and a permission are separate events', () => {
  alerts.tick(NOW, [session('work')], [], [], NOBODY)

  const question = alerts.tick(NOW + 1000, [session('ask')], [ask('q1', 'question', 'AskUserQuestion')], [], NOBODY).created
  const permission = alerts.tick(NOW + 2000, [session('ask')], [ask('q1', 'question', 'AskUserQuestion'), ask('p1')], [], NOBODY).created

  assert.deepEqual(question.map(alert => [alert.event, alert.title, alert.body, alert.askId]), [['question', 'my-api · Панель', 'питає тебе', 'q1']])
  assert.deepEqual(permission.map(alert => [alert.event, alert.body]), [['permission', 'чекає на відповідь (дозвіл на Bash)']])
})

test('a finished turn alerts at once, whatever its length', () => {
  const { created, changed } = finishTurn()

  assert.deepEqual(created.map(alert => [alert.event, alert.body, alert.createdAt]), [['done', 'завершила роботу', NOW + 1000]])
  assert.equal(changed, true)
  assert.deepEqual(alerts.unread().map(alert => alert.event), ['done'])
})

test('a switched-off event or the main switch makes no alert', () => {
  alerts.update({ events: { done: false } })
  assert.deepEqual(finishTurn().created, [])

  alerts.update({ enabled: false, events: { done: true } })
  assert.deepEqual(finishTurn().created, [])
})

test('a session in view gets no alert', () => {
  assert.deepEqual(finishTurn({ sessionIds: new Set(['s1']), isAnyPanelVisible: true }).created, [])
  assert.deepEqual(alerts.unread(), [])
})

test('viewing a session reads its alerts, a visible panel reads limit alerts', () => {
  const limits: RateLimit[] = [{ kind: 'five_hour', percentUsed: 85, resetsAt: 'x' }]

  alerts.update({ events: { limit: true } })
  finishTurn()
  alerts.tick(NOW + 2000, [finished()], [], limits, NOBODY)
  assert.deepEqual(alerts.unread().map(alert => [alert.event, alert.title, alert.body]), [
    ['limit', 'Ліміт 5 годин', 'використано 85%'],
    ['done', 'my-api · Панель', 'завершила роботу'],
  ])

  assert.equal(alerts.markViewed({ sessionIds: new Set(['s1']), isAnyPanelVisible: false }, NOW + 3000), true)
  assert.deepEqual(alerts.unread().map(alert => alert.event), ['limit'])

  assert.equal(alerts.markViewed({ sessionIds: new Set(), isAnyPanelVisible: true }, NOW + 4000), true)
  assert.deepEqual(alerts.unread(), [])
  assert.equal(alerts.markViewed({ sessionIds: new Set(), isAnyPanelVisible: true }, NOW + 5000), false)
})

test('a new turn reads the alerts of its session', () => {
  finishTurn()

  const { changed } = alerts.tick(NOW + 5000, [session('work', { lastTurnStartAt: NOW + 4000 })], [], [], NOBODY)

  assert.equal(changed, true)
  assert.deepEqual(alerts.unread(), [])
})

test('an ask closed anywhere reads its alert', () => {
  alerts.tick(NOW, [session('work')], [], [], NOBODY)
  alerts.tick(NOW + 1000, [session('ask')], [ask('p1')], [], NOBODY)
  assert.equal(alerts.unread().length, 1)

  alerts.tick(NOW + 2000, [session('work')], [], [], NOBODY)
  assert.deepEqual(alerts.unread(), [])
})

test('an alert of a session that is gone from the store is read', () => {
  finishTurn()
  alerts.tick(NOW + 2000, [], [], [], NOBODY)

  assert.deepEqual(alerts.unread(), [])
})

test('a session that dies while busy is gone', () => {
  alerts.tick(NOW, [session('work')], [], [], NOBODY)

  const { created } = alerts.tick(NOW + 1000, [session('offline')], [], [], NOBODY)

  assert.deepEqual(created.map(alert => [alert.event, alert.body]), [['gone', 'сесія зникла під час роботи']])
})

test('title and body name the changed files', () => {
  const { created } = finishTurn(NOBODY, { files: [file('a.php'), file('b.php')] })

  assert.equal(created[0]?.body, 'завершила роботу, змінено файлів: 2')
})

test('alerts older than 14 days are pruned', () => {
  finishTurn()
  store.prune(NOW + 15 * DAY)

  assert.deepEqual(alerts.unread(), [])
})
