import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { absolutePath, ideArguments, isSafePath, readDiff } from './changes.ts'

function repository(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ccc-diff-')))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args])

  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'app', 'a.php'), 'one\ntwo\n')
  run('init', '-q')
  run('add', '-A')
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')

  return root
}

test('a tracked change gives its diff, also from a subfolder', async () => {
  const root = repository()

  writeFileSync(join(root, 'app', 'a.php'), 'one\nthree\n')

  const file = { path: 'app/a.php', added: 1, removed: 1, isNew: false }

  for (const cwd of [root, join(root, 'app')]) {
    const result = await readDiff(cwd, file)

    assert.match(result?.diff ?? '', /-two\n\+three/)
  }
})

test('a new file shows as added', async () => {
  const root = repository()

  writeFileSync(join(root, 'new.txt'), 'hello\n')

  const result = await readDiff(root, { path: 'new.txt', added: 0, removed: 0, isNew: true })

  assert.match(result?.diff ?? '', /\+hello/)
})

test('secrets in a diff are hidden', async () => {
  const root = repository()

  writeFileSync(join(root, 'app', 'a.php'), 'one\nAPI_KEY=abcdef123456\n')

  const result = await readDiff(root, { path: 'app/a.php', added: 1, removed: 1, isNew: false })

  assert.equal(result?.diff.includes('abcdef123456'), false)
  assert.match(result?.diff ?? '', /API_KEY=\[приховано\]/)
})

test('a broken folder gives no diff instead of a crash', async () => {
  const result = await readDiff('/nonexistent/folder', { path: 'a', added: 0, removed: 0, isNew: false })

  assert.equal(result, null)
})

test('paths resolve from the repository root or the session folder', async () => {
  const root = repository()

  assert.equal(await absolutePath(join(root, 'app'), { path: 'app/a.php', added: 0, removed: 0, isNew: false }), join(root, 'app', 'a.php'))
  assert.equal(await absolutePath(join(root, 'app'), { path: 'b.php', added: 0, removed: 0, isNew: true }), join(root, 'app', 'b.php'))
})

test('unsafe paths are refused', () => {
  assert.equal(isSafePath('../secret'), false)
  assert.equal(isSafePath('app/../../secret'), false)
  assert.equal(isSafePath('/etc/passwd'), false)
  assert.equal(isSafePath(''), false)
  assert.equal(isSafePath('app/a..b.php'), true)
})

test('the IDE is taken from the session terminal', () => {
  assert.deepEqual(ideArguments('PhpStorm', '/a.php', 12), ['-nb', 'com.jetbrains.PhpStorm', '--args', '--line', '12', '/a.php'])
  assert.deepEqual(ideArguments('WebStorm', '/a.ts', null), ['-nb', 'com.jetbrains.WebStorm', '--args', '/a.ts'])
  assert.deepEqual(ideArguments('vscode', '/a.ts', 3), ['-b', 'com.microsoft.VSCode', '/a.ts'])
  assert.deepEqual(ideArguments('iTerm.app', '/a.ts', 3), ['/a.ts'])
  assert.deepEqual(ideArguments(null, '/a.ts', null), ['/a.ts'])
})
