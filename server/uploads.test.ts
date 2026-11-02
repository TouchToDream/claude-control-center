import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { mediaType, pruneUploads, safeFileName, saveUpload, uploadPath } from './uploads.ts'

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

const root = () => mkdtempSync(join(tmpdir(), 'ccc-uploads-'))

test('a file name keeps letters and digits, everything else becomes an underscore', () => {
  assert.equal(safeFileName('Знімок екрана 2026-11-02 о 14.10.png'), 'Знімок_екрана_2026-11-02_о_14.10.png')
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('.env'), 'env')
  assert.equal(safeFileName(''), 'file')
  assert.equal(safeFileName('a'.repeat(200) + '.log').length <= 84, true)
  assert.match(safeFileName('a'.repeat(200) + '.log'), /\.log$/)
})

test('an upload lands in the session folder and is found again', () => {
  const folder = root()
  const upload = saveUpload(folder, 's-1', 'Знімок екрана.png', Buffer.from('png bytes'), NOW)

  assert.equal(upload.path.startsWith(join(folder, 's-1') + '/'), true)
  assert.equal(readFileSync(upload.path, 'utf8'), 'png bytes')
  assert.equal(upload.isImage, true)
  assert.equal(upload.size, 9)
  assert.match(basename(upload.path), /Знімок_екрана\.png$/)
  assert.equal(upload.url, `/api/panel/uploads/s-1/${encodeURIComponent(basename(upload.path))}`)
  assert.equal(uploadPath(folder, 's-1', basename(upload.path)), upload.path)
  assert.notEqual(saveUpload(folder, 's-1', 'Знімок екрана.png', Buffer.from('x'), NOW).path, upload.path)
})

test('unsafe upload paths are refused', () => {
  const folder = root()
  const upload = saveUpload(folder, 's-1', 'a.txt', Buffer.from('x'), NOW)

  assert.equal(uploadPath(folder, 's-1', '../a.txt'), null)
  assert.equal(uploadPath(folder, '../s-1', basename(upload.path)), null)
  assert.equal(uploadPath(folder, 's-1', 'missing.txt'), null)
  assert.throws(() => saveUpload(folder, '../escape', 'a.txt', Buffer.from('x'), NOW))
})

test('media types follow the extension', () => {
  assert.equal(mediaType('a.PNG'), 'image/png')
  assert.equal(mediaType('a.jpeg'), 'image/jpeg')
  assert.equal(mediaType('a.pdf'), 'application/pdf')
  assert.equal(mediaType('a.log'), 'application/octet-stream')
})

test('old uploads are pruned, fresh ones stay', () => {
  const folder = root()
  const old = saveUpload(folder, 's-1', 'old.png', Buffer.from('x'), NOW)
  const fresh = saveUpload(folder, 's-2', 'fresh.png', Buffer.from('x'), NOW)
  const oldTime = (NOW - 20 * DAY) / 1000

  utimesSync(old.path, oldTime, oldTime)
  writeFileSync(join(folder, 'stray.txt'), 'x')

  assert.equal(pruneUploads(folder, NOW - 14 * DAY), 1)
  assert.equal(existsSync(old.path), false)
  assert.equal(existsSync(join(folder, 's-1')), false)
  assert.equal(existsSync(fresh.path), true)
  assert.equal(pruneUploads(join(folder, 'missing'), NOW), 0)
})
