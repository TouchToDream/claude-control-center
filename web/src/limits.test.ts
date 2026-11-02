import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resetLabel } from './limits.ts'

const NOW = Date.parse('2026-11-02T12:00:00Z')

test('a reset within a day is counted down', () => {
  assert.equal(resetLabel('2026-11-02T12:40:00Z', NOW, 'Europe/Kyiv'), 'оновиться через 40 хв')
  assert.equal(resetLabel('2026-11-02T14:10:00Z', NOW, 'Europe/Kyiv'), 'оновиться через 2 год 10 хв')
  assert.equal(resetLabel('2026-11-02T15:00:00Z', NOW, 'Europe/Kyiv'), 'оновиться через 3 год')
})

test('a later reset shows the day and the local time', () => {
  assert.equal(resetLabel('2026-11-09T07:00:00Z', NOW, 'Europe/Kyiv'), 'оновиться пн о 09:00')
})

test('an unknown or past reset says nothing', () => {
  assert.equal(resetLabel(undefined, NOW, 'Europe/Kyiv'), null)
  assert.equal(resetLabel('2026-11-02T11:00:00Z', NOW, 'Europe/Kyiv'), null)
  assert.equal(resetLabel('nonsense', NOW, 'Europe/Kyiv'), null)
})
