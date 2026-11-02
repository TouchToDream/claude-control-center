import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isContinued, latestOf } from './succession.ts'

const sessions = [
  { id: 'a', continuedFrom: null },
  { id: 'b', continuedFrom: 'a' },
  { id: 'c', continuedFrom: 'b' },
  { id: 'x', continuedFrom: null },
]

test('a cleared session leads to its latest continuation', () => {
  assert.equal(latestOf(sessions, 'a'), 'c')
  assert.equal(latestOf(sessions, 'c'), 'c')
  assert.equal(latestOf(sessions, 'x'), 'x')
  assert.equal(latestOf(sessions, null), null)
})

test('a session that went on as another one is hidden from the list', () => {
  assert.deepEqual(sessions.filter(session => !isContinued(sessions, session.id)).map(session => session.id), ['c', 'x'])
})

test('a loop in the links does not hang', () => {
  assert.notEqual(latestOf([{ id: 'p', continuedFrom: 'q' }, { id: 'q', continuedFrom: 'p' }], 'p'), null)
})
