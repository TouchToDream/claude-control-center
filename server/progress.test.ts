import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseTestOutput } from './progress.ts'
import { findOutputFile } from './testWatch.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('phpunit summary with a failure, from real output', () => {
  const parsed = parseTestOutput(fixture('phpunit-failed.txt'))

  assert.deepEqual(
    [parsed?.runner, parsed?.total, parsed?.done, parsed?.failed, parsed?.isFinal],
    ['phpunit', 4, 4, 1, true],
  )
})

test('phpunit rows give live counts and failures', () => {
  const output = [
    'PHPUnit 12.5.37 by Sebastian Bergmann and contributors.',
    '',
    '...............................................................  63 / 200 ( 31%)',
    '......F.....E..................................................  126 / 200 ( 63%)',
    '.......',
  ].join('\n')
  const parsed = parseTestOutput(output)

  assert.deepEqual(
    [parsed?.total, parsed?.done, parsed?.failed, parsed?.isFinal],
    [200, 133, 2, false],
  )
})

test('paratest rows read the same way', () => {
  const output = ['ParaTest v7.20.0 upon PHPUnit 12.5.30', '', '....F  5 / 40 ( 12%)'].join('\n')
  const parsed = parseTestOutput(output)

  assert.deepEqual([parsed?.total, parsed?.done, parsed?.failed], [40, 5, 1])
})

test('a passing phpunit summary has no failures', () => {
  const parsed = parseTestOutput('PHPUnit 12\n\n....  4 / 4 (100%)\n\nOK (4 tests, 9 assertions)\n')

  assert.deepEqual([parsed?.total, parsed?.failed, parsed?.isFinal], [4, 0, true])
})

test('errors and failures add up', () => {
  const parsed = parseTestOutput('Tests: 10, Assertions: 20, Errors: 2, Failures: 3.\n')

  assert.equal(parsed?.failed, 5)
})

test('the agent JSON of laravel/pao, from real output', () => {
  const parsed = parseTestOutput(fixture('pao-failed.txt'))

  assert.deepEqual(
    [parsed?.runner, parsed?.total, parsed?.failed, parsed?.isFinal],
    ['phpunit', 4, 1, true],
  )
})

test('collision output with colors, from real output', () => {
  const parsed = parseTestOutput(fixture('collision-passed.txt'))

  assert.deepEqual(
    [parsed?.runner, parsed?.total, parsed?.done, parsed?.failed, parsed?.isFinal],
    ['artisan', 3, 3, 0, true],
  )
  assert.equal(parsed?.suites[0]?.name, 'MoneyTest')
})

test('collision counts tests while it runs, the total is unknown', () => {
  const output = [
    '   PASS  Tests\\Unit\\FooTest',
    '  ✓ first',
    '  ✓ second',
    '   FAIL  Tests\\Unit\\BarTest',
    '  ⨯ broken',
  ].join('\n')
  const parsed = parseTestOutput(output)

  assert.deepEqual([parsed?.total, parsed?.done, parsed?.failed, parsed?.isFinal], [0, 3, 1, false])
  assert.deepEqual(parsed?.suites.map(suite => suite.name), ['BarTest', 'FooTest'])
})

test('collision summary with a failure', () => {
  const parsed = parseTestOutput('  ⨯ broken\n\n  Tests:    1 failed, 3 passed (9 assertions)\n')

  assert.deepEqual([parsed?.total, parsed?.failed, parsed?.isFinal], [4, 1, true])
})

test('jest summary, from real output', () => {
  const parsed = parseTestOutput(fixture('jest-passed.txt'))

  assert.deepEqual(
    [parsed?.runner, parsed?.unit, parsed?.total, parsed?.failed, parsed?.isFinal],
    ['jest', 'tests', 2, 0, true],
  )
})

test('jest counts files while it runs', () => {
  const parsed = parseTestOutput('PASS src/a.test.ts\nFAIL src/b.test.tsx\nPASS src/c.spec.ts\n')

  assert.deepEqual(
    [parsed?.unit, parsed?.done, parsed?.failed, parsed?.isFinal],
    ['files', 3, 1, false],
  )
})

test('output of other tools is not progress', () => {
  assert.equal(parseTestOutput('compiling\nall good\n'), null)
  assert.equal(parseTestOutput(''), null)
})

test('the newest output of the session is chosen, stale files are not', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccc-watch-'))
  const tasks = join(root, 'project', 'session-1', 'tasks')
  const now = Date.now()

  mkdirSync(tasks, { recursive: true })

  for (const [name, age] of [['old.output', 60_000], ['fresh.output', 0], ['other.txt', 0]] as const) {
    writeFileSync(join(tasks, name), 'x')
    utimesSync(join(tasks, name), new Date(now - age), new Date(now - age))
  }

  assert.equal(findOutputFile('session-1', now - 5000, [root]), join(tasks, 'fresh.output'))
  assert.equal(findOutputFile('session-2', now - 5000, [root]), null)
  assert.equal(findOutputFile('session-1', now + 60_000, [root]), null)
})
