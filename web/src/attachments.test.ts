import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeMessage, previewUrl, restoreAttachments, shortLabel, splitAttachments } from './attachments.ts'

const SHOT = '/Users/me/.claude-control-center/uploads/abc-1/m1-ff00aa-Знімок_екрана.png'
const LOG = '/Users/me/.claude-control-center/uploads/abc-1/m2-00ffaa-server.log'

test('attachments follow the text as one line each', () => {
  assert.equal(composeMessage('  глянь на помилку ', [SHOT, LOG]), `глянь на помилку\n\n[Вкладення: ${SHOT}]\n[Вкладення: ${LOG}]`)
  assert.equal(composeMessage('', [SHOT]), `[Вкладення: ${SHOT}]`)
  assert.equal(composeMessage('просто текст', []), 'просто текст')
})

test('a message splits back into its text and attachments', () => {
  assert.deepEqual(splitAttachments(composeMessage('глянь', [SHOT, LOG])), { text: 'глянь', paths: [SHOT, LOG] })
  assert.deepEqual(splitAttachments('без вкладень'), { text: 'без вкладень', paths: [] })
})

test('only images inside the uploads folder get a preview', () => {
  assert.equal(previewUrl(SHOT), `/api/panel/uploads/abc-1/${encodeURIComponent('m1-ff00aa-Знімок_екрана.png')}`)
  assert.equal(previewUrl(LOG), null)
  assert.equal(previewUrl('/etc/passwd.png'), null)
})

test('a queued message is labelled by its text and the number of attachments', () => {
  assert.equal(shortLabel(composeMessage('глянь на помилку', [SHOT, LOG]), 5), 'глянь · вкладень: 2')
  assert.equal(shortLabel('просто текст', 100), 'просто текст')
})

test('paths become ready attachments again when a queued message is edited', () => {
  assert.deepEqual(restoreAttachments([SHOT, LOG]), [
    { key: SHOT, name: 'm1-ff00aa-Знімок_екрана.png', status: 'ready', path: SHOT, url: previewUrl(SHOT), isImage: true, error: null },
    { key: LOG, name: 'm2-00ffaa-server.log', status: 'ready', path: LOG, url: null, isImage: false, error: null },
  ])
})
