import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseButtons } from './buttons.ts'

test('buttons keep a trimmed label, the text to send and the confirm switch', () => {
  assert.deepEqual(
    parseButtons([
      { id: 'b1', label: '  CR High ', text: ' /code-review high ', confirm: false },
      { id: 'b2', label: 'MR', text: 'Зроби коміт, пуш і MR', confirm: true },
      { id: 'b3', label: 'Pull', text: '!git pull' },
    ]),
    [
      { id: 'b1', label: 'CR High', text: '/code-review high', confirm: false },
      { id: 'b2', label: 'MR', text: 'Зроби коміт, пуш і MR', confirm: true },
      { id: 'b3', label: 'Pull', text: '!git pull', confirm: false },
    ],
  )
})

test('a broken set is refused as a whole', () => {
  const ok = { id: 'b', label: 'Pull', text: '!git pull', confirm: false }

  assert.equal(parseButtons('nope'), null)
  assert.equal(parseButtons([{ ...ok, label: '  ' }]), null)
  assert.equal(parseButtons([{ ...ok, text: '' }]), null)
  assert.equal(parseButtons([{ ...ok, label: 'x'.repeat(25) }]), null)
  assert.equal(parseButtons([{ ...ok, text: 'x'.repeat(4001) }]), null)
  assert.equal(parseButtons([{ ...ok, id: '' }]), null)
  assert.equal(parseButtons([ok, ok]), null)
  assert.equal(parseButtons(Array.from({ length: 13 }, (_, index) => ({ ...ok, id: `b${index}` }))), null)
  assert.deepEqual(parseButtons([]), [])
})
