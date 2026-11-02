import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextSelection } from './selection.ts'

test('a request opens its session when nothing is typed', () => {
  assert.equal(nextSelection('a', 'b', true, ''), 'b')
  assert.equal(nextSelection(null, 'b', true, ''), 'b')
})

test('a typed draft keeps the current session when only-if-no-draft', () => {
  assert.equal(nextSelection('a', 'b', true, 'half a prompt'), 'a')
})

test('whitespace alone is not a draft', () => {
  assert.equal(nextSelection('a', 'b', true, '  \n'), 'b')
})

test('a click opens the session even with a draft', () => {
  assert.equal(nextSelection('a', 'b', false, 'half a prompt'), 'b')
})

test('no request keeps the current session', () => {
  assert.equal(nextSelection('a', null, false, ''), 'a')
  assert.equal(nextSelection(null, null, true, ''), null)
})
