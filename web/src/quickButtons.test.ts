import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buttonKind, moveButton } from './quickButtons.ts'

test('a button is a command, a terminal command or a prompt by its text', () => {
  assert.equal(buttonKind('/code-review high'), 'command')
  assert.equal(buttonKind('  !git pull'), 'shell')
  assert.equal(buttonKind('Зроби коміт, пуш і MR'), 'prompt')
})

test('buttons move up and down and stay put at the edges', () => {
  const list = ['a', 'b', 'c']

  assert.deepEqual(moveButton(list, 1, -1), ['b', 'a', 'c'])
  assert.deepEqual(moveButton(list, 1, 1), ['a', 'c', 'b'])
  assert.deepEqual(moveButton(list, 0, -1), ['a', 'b', 'c'])
  assert.deepEqual(moveButton(list, 2, 1), ['a', 'b', 'c'])
})
