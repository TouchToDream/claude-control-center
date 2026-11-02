import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkKind, checkVerdict, describeCheck, parseCheckProgress, summarizeCheck, toolName } from './checks.ts'
import { loadSettings } from './settings.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const settings = loadSettings(mkdtempSync(join(tmpdir(), 'ccc-checks-')))

test('commands are sorted into tests, lint and code analysis', () => {
  const kinds = [
    'php vendor/bin/phpunit --filter VehicleTest',
    'npm test',
    'vendor/bin/pint --test',
    'vendor/bin/pint --dirty',
    'npx expo lint',
    'composer analyse',
    './vendor/bin/phpstan analyse --memory-limit=1G',
    'npx tsc --noEmit',
    'composer analyse && vendor/bin/pint --test',
    'git status',
  ].map(command => checkKind(command, settings))

  assert.deepEqual(kinds, ['tests', 'tests', 'lint', 'lint', 'lint', 'analysis', 'analysis', 'analysis', 'analysis', null])
})

test('the tool is named after the command', () => {
  assert.equal(toolName('php vendor/bin/phpunit --filter X'), 'PHPUnit')
  assert.equal(toolName('php artisan test'), 'artisan test')
  assert.equal(toolName('npx jest src'), 'Jest')
  assert.equal(toolName('vendor/bin/pint --test'), 'Pint')
  assert.equal(toolName('npx expo lint'), 'ESLint')
  assert.equal(toolName('composer analyse'), 'PHPStan')
  assert.equal(toolName('npx tsc --noEmit'), 'TypeScript')
  assert.equal(toolName('npm run typecheck'), 'TypeScript')
  assert.equal(toolName('make check'), 'make')
})

test('a short summary says what was found', () => {
  assert.equal(summarizeCheck('PHPStan', ' 120/120 [▓▓▓▓] 100%\n\n [ERROR] Found 5 errors\n'), 'помилок: 5')
  assert.equal(summarizeCheck('PHPStan', ' [OK] No errors\n'), 'без помилок')
  assert.equal(summarizeCheck('Pint', '  FAIL   ......................... 120 files, 2 style issues\n'), 'порушень стилю: 2')
  assert.equal(summarizeCheck('Pint', '  FIXED   ........................ 120 files, 3 style issues fixed\n'), 'виправлено: 3')
  assert.equal(summarizeCheck('Pint', '  PASS   ......................... 120 files\n'), 'без порушень')
  assert.equal(summarizeCheck('TypeScript', 'src/a.ts(1,2): error TS2322: x\nsrc/b.ts(3,4): error TS2345: y\n'), 'помилок: 2')
  assert.equal(summarizeCheck('TypeScript', 'Found 7 errors in 3 files.\n'), 'помилок: 7')
  assert.equal(summarizeCheck('ESLint', '✖ 5 problems (3 errors, 2 warnings)\n'), 'проблем: 5')
  assert.equal(summarizeCheck('make', 'whatever'), null)
})

test('PHPStan progress is read from its own bar', () => {
  const output = ' 45/120 [▓▓▓░░░░░░░]  37%\r 90/120 [▓▓▓▓▓▓▓░░░]  75%'

  assert.deepEqual(parseCheckProgress('PHPStan', output), { runner: 'PHPStan', unit: 'files', total: 120, done: 90, failed: 0, suites: [] })
  assert.equal(parseCheckProgress('Pint', output), null)
  assert.equal(parseCheckProgress('PHPStan', 'Note: Using configuration file'), null)
})

test('a chain is named after the part that made it a check', () => {
  assert.deepEqual(describeCheck('cd ~/x && npm run -s typecheck && npm test > out.txt 2>&1; tail -3 out.txt', settings), { kind: 'tests', tool: 'npm test' })
  assert.deepEqual(describeCheck('composer analyse && vendor/bin/pint --test', settings), { kind: 'analysis', tool: 'PHPStan' })
  assert.deepEqual(describeCheck('grep -n redis /etc/hosts; php vendor/bin/phpunit --filter MutexTest', settings), { kind: 'tests', tool: 'PHPUnit' })
  assert.equal(describeCheck('git status', settings), null)
})

test('ParaTest is a test runner', () => {
  assert.deepEqual(describeCheck('php vendor/bin/paratest --processes=6', settings), { kind: 'tests', tool: 'ParaTest' })
})

test('stored command lists gain new defaults and keep their own entries', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccc-settings-'))

  writeFileSync(join(home, 'config.json'), JSON.stringify({ testCommands: ['phpunit', 'make test'] }))

  const loaded = loadSettings(home)

  assert.equal(loaded.testCommands.includes('paratest'), true)
  assert.equal(loaded.testCommands.includes('make test'), true)
  assert.equal(loaded.lintCommands.includes('pint'), true)
})

test('a final verdict is read from the output of a finished check', () => {
  assert.deepEqual(checkVerdict('PHPStan', ' [ERROR] Found 5 errors\n'), { failed: true, summary: 'помилок: 5' })
  assert.deepEqual(checkVerdict('PHPStan', ' [OK] No errors\n'), { failed: false, summary: 'без помилок' })
  assert.deepEqual(checkVerdict('Pint', '  FAIL   .... 120 files, 2 style issues\n'), { failed: true, summary: 'порушень стилю: 2' })
  assert.deepEqual(checkVerdict('Pint', '  FIXED   .... 120 files, 3 style issues fixed\n'), { failed: false, summary: 'виправлено: 3' })
  assert.equal(checkVerdict('PHPStan', ' 45/120 [▓▓▓░░░]  37%'), null)
  assert.equal(checkVerdict('TypeScript', ''), null)
})

test('composer test runs the test suite', () => {
  assert.deepEqual(describeCheck('composer test', settings), { kind: 'tests', tool: 'composer test' })
  assert.deepEqual(describeCheck('php -d memory_limit=2G vendor/bin/phpstan analyse', settings), { kind: 'analysis', tool: 'PHPStan' })
})
