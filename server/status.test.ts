import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankSession } from './ingest.ts'
import { computeStage, computeStatus, isTestCommand } from './status.ts'
import type { Ask, SessionState } from './types.ts'

const NOW = 10_000_000
const RULES = { idleMinutes: 10, offlineSeconds: 20 }
const COMMANDS = ['npm test', 'vitest', 'phpunit', 'php artisan test', 'go test', 'pytest']

function session(changes: Partial<SessionState> = {}): SessionState {
  return { ...blankSession('s1', NOW - 60_000), lastSeenAt: NOW, ...changes }
}

function pendingAsk(sessionId = 's1'): Ask {
  return { id: 'a', sessionId, kind: 'permission', tool: 'Bash', summary: '', detail: '', agentId: null, answerable: true, blockedBy: null, status: 'pending', answer: null, createdAt: NOW, updatedAt: NOW }
}

const running = { id: 't', sessionId: 's1', repoRoot: '', command: 'npm test', expectedMs: null, startedAt: NOW, endedAt: null, failed: null, progress: null }

test('a session without heartbeat is offline, even with an open ask', () => {
  assert.equal(computeStatus(session({ lastSeenAt: NOW - 21_000 }), [pendingAsk()], NOW, RULES), 'offline')
})

test('an ended session is offline', () => {
  assert.equal(computeStatus(session({ endedAt: NOW }), [], NOW, RULES), 'offline')
})

test('an open ask outranks running work', () => {
  assert.equal(computeStatus(session({ turnId: 't', tests: running }), [pendingAsk()], NOW, RULES), 'ask')
})

test('an ask of another session does not change this one', () => {
  assert.equal(computeStatus(session(), [pendingAsk('other')], NOW, RULES), 'chat')
})

test('running tests outrank plain work', () => {
  assert.equal(computeStatus(session({ turnId: 't', tests: running }), [], NOW, RULES), 'tests')
})

test('an open turn is work', () => {
  assert.equal(computeStatus(session({ turnId: 't' }), [], NOW, RULES), 'work')
})

test('failed tests stay fail after the turn', () => {
  const tests = { ...running, endedAt: NOW, failed: true }

  assert.equal(computeStatus(session({ tests }), [], NOW, RULES), 'fail')
})

test('a turn that ended with an error is fail', () => {
  assert.equal(computeStatus(session({ turnError: true }), [], NOW, RULES), 'fail')
})

test('idle after ten quiet minutes, not before', () => {
  const touched = { lastTurnEndAt: NOW - 9 * 60_000, startedAt: NOW - 3_600_000 }

  assert.equal(computeStatus(session(touched), [], NOW, RULES), 'chat')
  assert.equal(computeStatus(session({ ...touched, lastTurnEndAt: NOW - 11 * 60_000 }), [], NOW, RULES), 'idle')
})

test('recent edits mean waiting, talk alone means chat', () => {
  assert.equal(computeStatus(session({ recentWork: [false, true] }), [], NOW, RULES), 'waiting')
  assert.equal(computeStatus(session({ recentWork: [false, false] }), [], NOW, RULES), 'chat')
})

test('work older than the last three turns no longer counts', () => {
  assert.equal(computeStatus(session({ recentWork: [true, false, false, false] }), [], NOW, RULES), 'chat')
})

function cycle(changes: Partial<SessionState['cycle']>): Pick<SessionState, 'cycle'> {
  return { cycle: { ...blankSession('c', NOW).cycle, ...changes } }
}

test('a task with no changes yet is planning', () => {
  assert.equal(computeStage(session(cycle({ reads: 12, last: 'read' })), 'work'), 'plan')
})

test('an approved plan moves on to code before the first edit', () => {
  assert.equal(computeStage(session(cycle({ hasPlan: true })), 'work'), 'code')
})

test('changes while working are code, while tests are the last action they are tests', () => {
  assert.equal(computeStage(session(cycle({ changes: 3, last: 'change' })), 'work'), 'code')
  assert.equal(computeStage(session(cycle({ changes: 3, last: 'test' })), 'work'), 'tests')
})

test('running tests are tests whatever came before', () => {
  assert.equal(computeStage(session({ tests: running, ...cycle({ reads: 1 }) }), 'tests'), 'tests')
})

test('finished work waiting for the person is review, failed tests are not', () => {
  assert.equal(computeStage(session(cycle({ changes: 3, tests: 'passed' })), 'waiting'), 'review')
  assert.equal(computeStage(session(cycle({ changes: 3, tests: 'failed' })), 'waiting'), 'tests')
})

test('a committed task is done', () => {
  assert.equal(computeStage(session(cycle({ changes: 3, isCommitted: true })), 'waiting'), 'done')
})

test('test commands are found inside compound lines', () => {
  for (const command of [
    'npm test',
    'npm test -- --watch=false',
    'cd api && php artisan test --filter Foo',
    'php vendor/bin/phpunit --filter Foo',
    'CI=1 npx vitest run',
    'go test ./...',
    'FOO=1 BAR=2 pytest -q',
  ]) {
    assert.equal(isTestCommand(command, COMMANDS), true, command)
  }
})

test('other commands are not tests', () => {
  for (const command of ['npm install', 'cat vitest.config.ts', 'grep phpunit composer.json', 'git commit -m "go test"']) {
    assert.equal(isTestCommand(command, COMMANDS), false, command)
  }
})
