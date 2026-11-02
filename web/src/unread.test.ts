import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unreadSessions } from './unread.ts'

test('sessions with unread alerts, limit alerts left out', () => {
  const alerts = [
    { id: 'a', sessionId: 's1', event: 'done' as const, title: '', body: '', createdAt: 1 },
    { id: 'b', sessionId: null, event: 'limit' as const, title: '', body: '', createdAt: 2 },
  ]

  assert.deepEqual([...unreadSessions(alerts)], ['s1'])
})

test('an older service without alerts gives an empty set', () => {
  assert.equal(unreadSessions(undefined).size, 0)
})
