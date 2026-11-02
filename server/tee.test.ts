import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withOutputCopy } from '../mod/hooks/tee.ts'

const FILE = '/tmp/ccc-t1.log'

test('a runner piped into tail also writes a copy of its output', () => {
  assert.equal(withOutputCopy('php -d memory_limit=1G vendor/bin/phpunit 2>&1 | tail -25', FILE), `php -d memory_limit=1G vendor/bin/phpunit 2>&1 | tee ${FILE} | tail -25`)
  assert.equal(withOutputCopy('cd api && npm test 2>&1 | grep -E "Tests|FAIL"', FILE), `cd api && npm test 2>&1 | tee ${FILE} | grep -E "Tests|FAIL"`)
  assert.equal(withOutputCopy('php vendor/bin/phpstan analyse --no-progress 2>&1 | tail -6', FILE), `php vendor/bin/phpstan analyse --no-progress 2>&1 | tee ${FILE} | tail -6`)
  assert.equal(withOutputCopy('php artisan test 2>&1 | tail -3', FILE), `php artisan test 2>&1 | tee ${FILE} | tail -3`)
})

test('commands that already show or keep their output are left alone', () => {
  assert.equal(withOutputCopy('php vendor/bin/phpunit', FILE), null)
  assert.equal(withOutputCopy('php vendor/bin/paratest > /tmp/suite.log 2>&1; tail -3 /tmp/suite.log', FILE), null)
  assert.equal(withOutputCopy('npm test 2>&1 | tee out.log | tail -5', FILE), null)
  assert.equal(withOutputCopy('grep -E "phpunit|paratest" .gitlab-ci.yml | head', FILE), null)
  assert.equal(withOutputCopy('git status | head -3', FILE), null)
})
