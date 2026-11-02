import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shellCommand } from './shell.ts'

test('text that starts with ! is a shell command without the !', () => {
  assert.equal(shellCommand('!ls -la'), 'ls -la')
  assert.equal(shellCommand('  ! git status  '), 'git status')
  assert.equal(shellCommand('!'), '')
})

test('anything else is a message', () => {
  assert.equal(shellCommand('ls -la'), null)
  assert.equal(shellCommand('скажи ! це'), null)
  assert.equal(shellCommand(''), null)
})
