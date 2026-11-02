import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'
import { EventDetector } from './events.ts'
import type { DetectedEvent, SessionWithStatus } from './events.ts'
import { blankSession } from './ingest.ts'
import { Store } from './store.ts'
import type { Ask, SessionState, Status } from './types.ts'

const NOW = 100_000_000

let store: Store
let detector: EventDetector

beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), 'ccc-events-')), 'test.sqlite'))
  detector = new EventDetector(store, 'testLimits')
})

function session(status: Status, changes: Partial<SessionState> = {}): SessionWithStatus {
  return { ...blankSession('s1', NOW), repoRoot: '/work/api', repoName: 'api', name: 'Панель', status, ...changes }
}

function ask(id: string): Ask {
  return { id, sessionId: 's1', kind: 'permission', tool: 'Bash', summary: '', detail: '', agentId: null, answerable: true, blockedBy: null, status: 'pending', answer: null, createdAt: NOW, updatedAt: NOW }
}

const kinds = (events: DetectedEvent[]) => events.map(event => event.kind)

test('a short finished turn is still a done event', () => {
  detector.tick(NOW, [session('work', { lastTurnStartAt: NOW - 10_000, turnId: 't1' })], [], [])

  const events = detector.tick(
    NOW + 1000,
    [session('chat', { lastTurnStartAt: NOW - 10_000, lastTurnEndAt: NOW, turnEndReason: 'answer' })],
    [],
    [],
  )

  assert.deepEqual(kinds(events), ['done'])
  assert.equal(events[0]?.kind === 'done' ? events[0].workedMs : null, 10_000)
})

test('a stopped turn is not done', () => {
  detector.tick(NOW, [session('work', { lastTurnStartAt: NOW - 10_000, turnId: 't1' })], [], [])

  const events = detector.tick(
    NOW + 1000,
    [session('chat', { lastTurnStartAt: NOW - 10_000, lastTurnEndAt: NOW, turnEndReason: 'interrupted' })],
    [],
    [],
  )

  assert.deepEqual(kinds(events), [])
})

test('a busy session that goes silent is lost, a closed one is not', () => {
  const lost = new EventDetector(store, 'a')
  const closed = new EventDetector(store, 'b')
  const crashed = new EventDetector(store, 'c')

  for (const each of [lost, closed, crashed]) {
    each.tick(NOW, [session('work')], [], [])
  }

  assert.deepEqual(kinds(lost.tick(NOW + 1000, [session('offline')], [], [])), ['lost'])
  assert.deepEqual(kinds(closed.tick(NOW + 1000, [session('offline', { endedAt: NOW + 1, endReason: 'exit' })], [], [])), [])
  assert.deepEqual(
    kinds(crashed.tick(NOW + 1000, [session('offline', { endedAt: NOW + 1, endReason: 'process_gone' })], [], [])),
    ['crashed'],
  )
})

test('the first tick reports no old asks and no limits', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 85, resetsAt: 'x' }]

  assert.deepEqual(kinds(detector.tick(NOW, [session('ask')], [ask('a1')], limits)), [])
  assert.deepEqual(kinds(detector.tick(NOW + 1000, [session('ask')], [ask('a1'), ask('a2')], [])), ['ask'])
})

test('limit marks are kept per channel', () => {
  const first = new EventDetector(store, 'a')
  const second = new EventDetector(store, 'b')
  const limits = [{ kind: 'five_hour', percentUsed: 85, resetsAt: 'x' }]

  for (const each of [first, second]) {
    each.tick(NOW, [], [], [])

    const events = each.tick(NOW + 1000, [], [], limits)

    assert.deepEqual(kinds(events), ['limit'])
    assert.equal(events[0]?.kind === 'limit' ? events[0].level : null, 80)
  }
})

test('waking from sleep does not make busy sessions lost', () => {
  const asleep = NOW + 10 * 60_000

  detector.tick(NOW, [session('work')], [], [])

  assert.deepEqual(kinds(detector.tick(asleep, [session('offline')], [], [])), [])
  assert.deepEqual(kinds(detector.tick(asleep + 2000, [session('work')], [], [])), [])
  assert.deepEqual(kinds(detector.tick(asleep + 3000, [session('offline')], [], [])), [])
})

test('a session still silent after the wake grace is lost', () => {
  const asleep = NOW + 10 * 60_000

  const quiet: string[] = []

  detector.tick(NOW, [session('work')], [], [])

  for (let at = asleep; at < asleep + 30_000; at += 1000) {
    quiet.push(...kinds(detector.tick(at, [session('offline')], [], [])))
  }

  assert.deepEqual(quiet, [])
  assert.deepEqual(kinds(detector.tick(asleep + 30_000, [session('offline')], [], [])), ['lost'])
})
