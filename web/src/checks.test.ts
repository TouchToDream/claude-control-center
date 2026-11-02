import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkNote, checkState, projectChecks, runningLabel } from './checks.ts'
import type { CheckView } from './checks.ts'

function run(changes: Partial<CheckView>): CheckView {
  return {
    id: 'r',
    sessionId: 's',
    repoRoot: '/work/api',
    command: 'composer analyse',
    expectedMs: null,
    startedAt: 1000,
    endedAt: 2000,
    failed: false,
    progress: null,
    kind: 'analysis',
    tool: 'PHPStan',
    summary: null,
    tail: null,
    ...changes,
  }
}

test('checks of the project come in a fixed order', () => {
  const checks = [
    run({ id: 'a', kind: 'analysis' }),
    run({ id: 'other', kind: 'tests', repoRoot: '/work/app' }),
    run({ id: 'l', kind: 'lint' }),
    run({ id: 't', kind: 'tests' }),
  ]

  assert.deepEqual(projectChecks(checks, '/work/api').map(check => check.id), ['t', 'l', 'a'])
  assert.deepEqual(projectChecks(undefined, '/work/api'), [])
})

test('a run is running, passed, failed or stopped', () => {
  assert.equal(checkState(run({ endedAt: null, failed: null })), 'running')
  assert.equal(checkState(run({ failed: false })), 'passed')
  assert.equal(checkState(run({ failed: true })), 'failed')
  assert.equal(checkState(run({ failed: null })), 'stopped')
})

test('the note counts failed tests or repeats the summary', () => {
  const progress = { runner: 'phpunit', unit: 'tests' as const, total: 120, done: 120, failed: 3, suites: [], updatedAt: 0 }

  assert.equal(checkNote(run({ kind: 'tests', failed: true, progress })), 'упало 3 з 120')
  assert.equal(checkNote(run({ kind: 'tests', progress: { ...progress, failed: 0 } })), 'тестів: 120')
  assert.equal(checkNote(run({ summary: 'помилок: 5' })), 'помилок: 5')
  assert.equal(checkNote(run({})), null)
})

test('a running check shows real counts, an estimate or the time so far', () => {
  const progress = { runner: 'paratest', unit: 'tests' as const, total: 1500, done: 480, failed: 0, suites: [], updatedAt: 0 }

  assert.deepEqual(runningLabel(run({ endedAt: null, failed: null, startedAt: 0, progress }), 60_000), { left: '480 з 1500 · 32%', right: 'залишилось ~2 хв 8 с' })
  assert.deepEqual(runningLabel(run({ endedAt: null, failed: null, startedAt: 0, expectedMs: 200_000 }), 90_000), { left: '≈45% за минулим прогоном', right: 'залишилось ~1 хв 50 с' })
  assert.deepEqual(runningLabel(run({ endedAt: null, failed: null, startedAt: 0 }), 65_000), { left: 'оцінка — з наступного прогону', right: 'минуло 1 хв 5 с' })
})
