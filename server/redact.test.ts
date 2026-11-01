import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clip, redact } from '../mod/hooks/redact.ts'

const sample = (...parts: string[]) => parts.join('')

const SECRETS = [
  sample('sk-ant-', 'api03-', 'abcdefghijklmnopqrstuvwxyz012345'),
  sample('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
  sample('AK', 'IA', 'IOSFODNN7', 'EXAMPLE'),
  sample('xo', 'xb-', '123456789012-abcdefghijkl'),
  sample('123456789', ':', 'AA', 'Fabcdefghijklmnopqrstuvwxyz0123456'),
  sample('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcdefghijklmnop'),
]

test('known key formats are hidden', () => {
  for (const secret of SECRETS) {
    const masked = redact(`value ${secret} tail`)

    assert.equal(masked.includes(secret), false, secret)
    assert.equal(masked.includes('tail'), true)
  }
})

test('assignments keep the name and hide the value', () => {
  assert.equal(redact('API_KEY=abcdef123456'), 'API_KEY=[приховано]')
  assert.equal(redact('"password": "hunter2hunter2"'), '"password": "[приховано]"')
})

test('bearer headers and passwords in URLs are hidden', () => {
  assert.equal(redact('Authorization: Bearer abcdefghijklmnop123'), 'Authorization: Bearer [приховано]')
  assert.equal(redact('postgres://user:s3cretpass@localhost:5442/db'), 'postgres://user:[приховано]@localhost:5442/db')
})

test('private key blocks are hidden whole', () => {
  const block = sample('-----BEGIN RSA PRIVATE', ' KEY-----\nabc\ndef\n-----END RSA PRIVATE', ' KEY-----')

  assert.equal(redact(`before ${block} after`), 'before [приховано] after')
})

test('ordinary text is left alone', () => {
  const text = 'Правлю файл app/Http/Controllers/TokenController.php, тести пройшли'

  assert.equal(redact(text), text)
})

test('clip says how much it cut', () => {
  assert.equal(clip('abc', 5), 'abc')
  assert.equal(clip('abcdefgh', 5), 'abcde\n… обрізано 3 симв.')
})
