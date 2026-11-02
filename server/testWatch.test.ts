import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { outputTarget } from './testWatch.ts'

const TESTS = ['phpunit', 'paratest', 'npm test']

test('the file a check writes its output to is found', () => {
  assert.equal(outputTarget('git log -1 && php vendor/bin/paratest --processes=6 > /tmp/suite.log 2>&1; tail -3 /tmp/suite.log', '/work/core', TESTS), '/tmp/suite.log')
  assert.equal(outputTarget('npm test 2>&1 | tee out/test.log', '/work/app', TESTS), '/work/app/out/test.log')
  assert.equal(outputTarget('vendor/bin/phpunit >> "logs/my run.log" 2>&1', '/work/api', TESTS), '/work/api/logs/my run.log')
  assert.equal(outputTarget('phpunit &> ~/suite.log', '/work/api', TESTS), join(homedir(), 'suite.log'))
})

test('a check that prints to the terminal has no file', () => {
  assert.equal(outputTarget('php vendor/bin/phpunit --filter X 2>&1 | tail -5', '/work/api', TESTS), null)
  assert.equal(outputTarget('echo hi > /tmp/x.log; phpunit', '/work/api', TESTS), null)
  assert.equal(outputTarget('git status > /tmp/x.log', '/work/api', TESTS), null)
})
