import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadDraft, saveDraft } from './drafts.ts'
import type { KeyValueStore } from './drafts.ts'

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()

  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  }
}

test('a draft survives and an empty one is removed', () => {
  const store = memory()

  saveDraft(store, 's1', 'привіт')

  assert.equal(loadDraft(store, 's1'), 'привіт')
  assert.equal(loadDraft(store, 's2'), '')
  assert.equal(store.data.get('ccc.draft.s1'), 'привіт')

  saveDraft(store, 's1', '')

  assert.equal(store.data.has('ccc.draft.s1'), false)
})

test('a broken storage gives an empty draft and does not throw', () => {
  const fail = () => {
    throw new Error('denied')
  }
  const broken: KeyValueStore = { getItem: fail, setItem: fail, removeItem: fail }

  assert.doesNotThrow(() => saveDraft(broken, 's1', 'x'))
  assert.equal(loadDraft(broken, 's1'), '')
  assert.equal(loadDraft(null, 's1'), '')
  assert.doesNotThrow(() => saveDraft(null, 's1', 'x'))
})
