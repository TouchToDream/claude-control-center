import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTypingIn } from './focus.ts'

test('nothing focused is not typing', () => {
  assert.equal(isTypingIn(null), false)
  assert.equal(isTypingIn({ tagName: 'BODY' }), false)
})

test('a focused button or link is not typing', () => {
  assert.equal(isTypingIn({ tagName: 'BUTTON' }), false)
  assert.equal(isTypingIn({ tagName: 'A' }), false)
})

test('a textarea and a text input are typing', () => {
  assert.equal(isTypingIn({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTypingIn({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(isTypingIn({ tagName: 'INPUT', type: 'search' }), true)
})

test('a checkbox or file picker is not typing', () => {
  assert.equal(isTypingIn({ tagName: 'INPUT', type: 'checkbox' }), false)
  assert.equal(isTypingIn({ tagName: 'INPUT', type: 'file' }), false)
})

test('an editable block is typing', () => {
  assert.equal(isTypingIn({ tagName: 'DIV', isContentEditable: true }), true)
})
